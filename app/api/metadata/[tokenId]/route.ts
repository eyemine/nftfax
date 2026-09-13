/// GET /api/metadata/[tokenId]
///
/// Returns ERC-721 token metadata JSON for the NFTFaxCollectible contract
/// (0x0093D896E677831D4e1fe92F3E548Ca72D3CD5FE on Base). OpenSea and other
/// marketplaces fetch this URL to display token name, description, and image.
///
/// The contract's tokenURI(tokenId) returns baseURI + tokenId, so after
/// setBaseURI("https://fax.nftmail.box/api/metadata/") is called on-chain,
/// each token's URI resolves to this route.

import { NextRequest, NextResponse } from 'next/server';
import { BASE_FAX_COLLECTIBLE } from '../../../lib/contracts';
import { decodeFaxMintedLog, decodeSourceTokenId, readLogCache } from '../../../lib/fax-stats';

const RPC_URL = 'https://mainnet.base.org';
const FAX_MINTED_TOPIC = '0x20a7befda21edb48bdea9b5c9be274f9329f49476f8e64469506e5629bcb0e5c';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/// Envio HyperIndex GraphQL endpoint — same indexer the leaderboard uses.
/// Primary source for mint lookups: a single indexed query instead of
/// scanning the whole chain history on every marketplace metadata fetch.
const ENVIO_GRAPHQL_URL = process.env.ENVIO_GRAPHQL_URL || '';
/// Base's public RPC caps eth_getLogs at a 2,000-block range. This was
/// previously set to 10,000, so EVERY chunk request failed with
/// `-32614 eth_getLogs is limited to a 2,000 range`, the catch swallowed it,
/// and findFaxMinted always returned null — which made the on-chain baseURI
/// fallback serve generic collection art with no provenance for every token.
const LOG_CHUNK_SIZE = 2_000;
const MAX_CONCURRENT_CHUNKS = 4;

const COLLECTION_IMAGE = 'https://costumes.mypinata.cloud/ipfs/bafkreihl3q3aqf7njgqdv4swkglcuc633krvpxottun455ttll2zsqn42a';

/// Tier names based on chain depth (hop count), matching the CHAIN_GAME_DESIGN
/// spec: Dial Tone (1) → Dead Letter (11+). Used for prize draw eligibility.
const TIERS: { depth: number; name: string }[] = [
  { depth: 1, name: 'Dial Tone' },
  { depth: 2, name: 'Hop 2' },
  { depth: 3, name: 'Hop 3' },
  { depth: 4, name: 'Hop 4' },
  { depth: 5, name: 'Hop 5' },
  { depth: 6, name: 'Hop 6' },
  { depth: 7, name: 'Hop 7' },
  { depth: 8, name: 'Hop 8' },
  { depth: 9, name: 'Hop 9' },
  { depth: 10, name: 'Hop 10' },
  { depth: 11, name: 'Dead Letter' },
];

function tierForDepth(depth: number): string {
  if (depth < 1) return 'Dial Tone';
  if (depth >= 11) return 'Dead Letter';
  return TIERS[depth - 1]?.name ?? 'Dead Letter';
}

const COMMUNITY_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'CHONKS',
  2: 'DEADFELLAZ',
  3: 'POW NFT',
  4: 'NORMIES',
};

const COMMUNITY_PREFIXES: Record<number, string> = {
  1: 'chonk',
  2: 'dfz',
  3: 'atom',
  4: 'normie',
};

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

interface RpcResponse {
  result?: RpcLog[] | string;
  error?: { message: string };
}

/// Reads totalMinted() from the contract to validate tokenId range.
async function getTotalMinted(): Promise<number> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: BASE_FAX_COLLECTIBLE, data: '0xa2309ff8' }, 'latest'],
      }),
    });
    const json = (await res.json()) as RpcResponse;
    if (typeof json.result === 'string') return parseInt(json.result, 16);
  } catch { /* ignore */ }
  return 0;
}

interface MintInfo {
  community: number;
  sourceTokenId: number;
  trayId: string;
  toAddress: string;
}

/// Memo of resolved mints. This route runs as a long-lived Docker process,
/// and marketplaces refetch metadata often — a mint is immutable once
/// indexed, so there is no reason to look it up twice.
const mintInfoMemo = new Map<number, MintInfo>();

/// Primary lookup: the Envio HyperIndex indexer. One indexed query, no
/// chain scan, and unaffected by the public RPC's block-range cap.
async function findFaxMintedViaEnvio(tokenId: number): Promise<MintInfo | null> {
  if (!ENVIO_GRAPHQL_URL) return null;
  try {
    const res = await fetch(ENVIO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query FaxMintedByToken($tokenId: numeric!) {
          NFTFaxCollectibleV2_FaxMinted(where: { mintedTokenId: { _eq: $tokenId } } limit: 1) {
            mintedTokenId to community sourceTokenId trayId
          }
        }`,
        variables: { tokenId },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: { NFTFaxCollectibleV2_FaxMinted?: { to: string; community: string | number; sourceTokenId: string | number; trayId: string }[] };
      errors?: unknown[];
    };
    const row = json.data?.NFTFaxCollectibleV2_FaxMinted?.[0];
    if (json.errors || !row) return null;
    const community = Number(row.community);
    return {
      community,
      // On-chain sourceTokenId is a composite (realId * 1e6 + chainSuffix)
      // for the Ethereum-native collections — decode back to the real ID.
      sourceTokenId: decodeSourceTokenId(Number(row.sourceTokenId), community),
      trayId: row.trayId,
      toAddress: row.to,
    };
  } catch {
    return null;
  }
}

/// Secondary lookup: the FaxMinted log cache the leaderboard route persists
/// to disk. Free (no network) and already mounted into this container.
function findFaxMintedViaLogCache(tokenId: number): MintInfo | null {
  const cache = readLogCache();
  if (!cache) return null;
  for (const log of cache.logs) {
    if (parseInt(log.topics[1] ?? '0x0', 16) !== tokenId) continue;
    try {
      const entry = decodeFaxMintedLog(log);
      return {
        community: entry.community,
        sourceTokenId: entry.sourceTokenId,
        trayId: entry.trayId,
        toAddress: entry.minter,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/// Last-resort lookup: scan Transfer logs (tokenId is topic[3]) then match
/// the FaxMinted log in the same transaction. Only runs if both the indexer
/// and the disk cache miss.
async function findFaxMintedViaRpc(tokenId: number): Promise<MintInfo | null> {
  const deployBlock = 50250138; // 0x2fec19a
  const tokenIdHex = '0x' + tokenId.toString(16).padStart(64, '0');

  // Get current block
  let currentBlock: number;
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const json = (await res.json()) as RpcResponse;
    currentBlock = typeof json.result === 'string' ? parseInt(json.result, 16) : deployBlock;
  } catch {
    return null;
  }

  // Search for Transfer logs with this tokenId. mainnet.base.org caps
  // eth_getLogs at a 2,000-block range per call, so we chunk accordingly.
  // Newest chunks first: a token being fetched is usually a recent mint, and
  // we stop as soon as a chunk hits.
  const chunks: { start: number; end: number }[] = [];
  for (let start = deployBlock; start <= currentBlock; start += LOG_CHUNK_SIZE) {
    chunks.push({ start, end: Math.min(start + LOG_CHUNK_SIZE - 1, currentBlock) });
  }
  chunks.reverse();

  const fetchChunk = async ({ start, end }: { start: number; end: number }) => {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
          params: [{
            address: BASE_FAX_COLLECTIBLE,
            fromBlock: '0x' + start.toString(16),
            toBlock: '0x' + end.toString(16),
            topics: [TRANSFER_TOPIC, null, null, tokenIdHex],
          }],
        }),
      });
      const json = (await res.json()) as RpcResponse;
      const logs = json.result;
      return Array.isArray(logs) && logs.length > 0 ? logs[0] : null;
    } catch {
      return null;
    }
  };

  // Bounded concurrency: the public RPC rate-limits large parallel bursts,
  // and firing every chunk at once is what made this scan unreliable.
  let transferLog: RpcLog | null = null;
  for (let i = 0; i < chunks.length && !transferLog; i += MAX_CONCURRENT_CHUNKS) {
    const batch = await Promise.all(chunks.slice(i, i + MAX_CONCURRENT_CHUNKS).map(fetchChunk));
    transferLog = batch.find((l): l is RpcLog => l !== null) ?? null;
  }
  if (!transferLog) return null;

  const txHash = transferLog.transactionHash;
  const toAddress = '0x' + transferLog.topics[2].slice(26);

  try {
    const receiptRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });
    const receiptJson = (await receiptRes.json()) as { result?: { logs: RpcLog[] } };
    const allLogs = receiptJson.result?.logs ?? [];
    const faxMintedLog = allLogs.find(
      (l) => l.topics[0]?.toLowerCase() === FAX_MINTED_TOPIC &&
             l.topics[1]?.toLowerCase() === tokenIdHex
    );
    if (faxMintedLog) {
      const entry = decodeFaxMintedLog(faxMintedLog);
      return {
        community: entry.community,
        sourceTokenId: entry.sourceTokenId,
        trayId: entry.trayId,
        toAddress,
      };
    }
  } catch {
    // fall through to basic info below
  }
  // Transfer found but no FaxMinted — still return basic info
  return { community: 0, sourceTokenId: 0, trayId: '', toAddress };
}

/// Resolves a token's mint record, cheapest source first:
/// Envio indexer → leaderboard disk log cache → chunked RPC scan.
/// Returning null here degrades the response to generic collection art with
/// no provenance, so each layer matters.
async function findFaxMinted(tokenId: number): Promise<MintInfo | null> {
  const memoized = mintInfoMemo.get(tokenId);
  if (memoized) return memoized;

  const resolved =
    await findFaxMintedViaEnvio(tokenId)
    ?? findFaxMintedViaLogCache(tokenId)
    ?? await findFaxMintedViaRpc(tokenId);

  // Only memoize a fully-resolved mint. A partial record (Transfer found but
  // no FaxMinted) may just mean a transient RPC miss, so leave it retryable.
  if (resolved && resolved.trayId) mintInfoMemo.set(tokenId, resolved);
  return resolved;
}

/// Fetches the tray document to get the fax image (as base64 data URI) and
/// chain depth (for tier classification used in the prize draw).
async function getFaxData(trayId: string): Promise<{ image: string | null; chainDepth: number | null; forwardedTrayId?: string }> {
  if (!trayId) return { image: null, chainDepth: null };
  try {
    const res = await fetch(`https://nftmail.box/api/tray/${trayId}`, { cache: 'no-store' });
    if (!res.ok) return { image: null, chainDepth: null };
    const doc = await res.json() as { dataBase64?: string; format?: string; chainDepth?: number; forwardedTrayId?: string };
    const image = doc.dataBase64
      ? `data:${doc.format === 'png' ? 'image/png' : 'image/jpeg'};base64,${doc.dataBase64}`
      : null;
    const chainDepth = typeof doc.chainDepth === 'number' ? doc.chainDepth : null;
    return { image, chainDepth, forwardedTrayId: doc.forwardedTrayId };
  } catch {
    return { image: null, chainDepth: null };
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId: tokenIdStr } = await params;
  const tokenId = parseInt(tokenIdStr, 10);

  if (!Number.isFinite(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 });
  }

  const totalMinted = await getTotalMinted();
  if (tokenId > totalMinted) {
    return NextResponse.json({ error: 'Token does not exist' }, { status: 404 });
  }

  const mintInfo = await findFaxMinted(tokenId);

  const { image: rawFaxImage, chainDepth, forwardedTrayId } = await getFaxData(mintInfo?.trayId ?? '');

  // The on-chain trayId is the RECEIVED fax (ownership/provenance), but the
  // artwork the collectible should represent is the FORWARDED fax (the
  // player's own composited hop). If the tray document has a
  // forwardedTrayId, fetch that tray's image and use it for display.
  const displayTrayId = forwardedTrayId || mintInfo?.trayId || '';
  let image = rawFaxImage ?? COLLECTION_IMAGE;
  if (forwardedTrayId) {
    const fwdData = await getFaxData(forwardedTrayId);
    if (fwdData.image) image = fwdData.image;
  }

  const communityName = mintInfo ? COMMUNITY_NAMES[mintInfo.community] ?? 'UNKNOWN' : 'FAX';
  const name = `FAX CHAIN #${tokenId}`;
  const description = mintInfo
    ? `NFTFax Collectible #${tokenId} — minted from ${communityName}${mintInfo.sourceTokenId ? ` #${mintInfo.sourceTokenId}` : ''}${displayTrayId ? ` (fax ${displayTrayId})` : ''}. A chain-letter fax machine collectible on Base.`
    : `NFTFax Collectible #${tokenId} — a chain-letter fax machine collectible on Base.`;

  // Worker counts the initial send as depth 1, but the first send is not a hop.
  // First forward = hop 1 (Dial Tone). Subtract 1 to get actual hop count.
  const hopCount = chainDepth != null ? Math.max(0, chainDepth - 1) : null;
  const tier = hopCount != null ? tierForDepth(hopCount) : 'Dial Tone';

  const metadata = {
    name,
    description,
    image,
    external_url: `https://nftmail.box/tray/${displayTrayId}`,
    attributes: [
      { trait_type: 'Tier', value: tier },
      ...(hopCount != null ? [{ trait_type: 'Chain Depth', value: hopCount }] : []),
      ...(displayTrayId ? [{ trait_type: 'Fax Tray ID', value: displayTrayId }] : []),
      { trait_type: 'Minting Collection', value: communityName },
      ...(mintInfo && mintInfo.sourceTokenId ? [{ trait_type: 'Minting Token ID', value: `${COMMUNITY_PREFIXES[mintInfo.community] ?? 'unknown'}.${mintInfo.sourceTokenId}` }] : []),
      { trait_type: 'Token ID', value: tokenId },
    ],
  };

  return NextResponse.json(metadata, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
