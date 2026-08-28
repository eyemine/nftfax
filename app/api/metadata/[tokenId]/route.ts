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

const RPC_URL = 'https://mainnet.base.org';
const FAX_MINTED_TOPIC = '0x20a7befda21edb48bdea9b5c9be274f9329f49476f8e64469506e5629bcb0e5c';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

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

/// Fetches the FaxMinted event for a specific tokenId by scanning Transfer
/// logs (which include tokenId as topic[3]) then matching the FaxMinted log
/// in the same transaction. We search in 10k-block chunks from the deploy
/// block to current.
async function findFaxMinted(tokenId: number): Promise<{
  community: number;
  sourceTokenId: number;
  trayId: string;
  toAddress: string;
} | null> {
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
  // eth_getLogs at a 10,000-block range per call, so we chunk accordingly.
  // Chunks are queried in parallel to minimize latency.
  const chunks: { start: number; end: number }[] = [];
  for (let start = deployBlock; start <= currentBlock; start += 10000) {
    chunks.push({ start, end: Math.min(start + 9999, currentBlock) });
  }

  const chunkResults = await Promise.all(chunks.map(async ({ start, end }) => {
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
  }));

  const transferLog = chunkResults.find((l): l is RpcLog => l !== null);
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
      // Decode data: community (uint8), sourceTokenId (uint256), trayId (string)
      const data = faxMintedLog.data.slice(2);
      const community = parseInt(data.slice(0, 64), 16);
      const sourceTokenId = parseInt(data.slice(64, 128), 16);
      // trayId is a dynamic string at offset
      const strOffset = parseInt(data.slice(128, 192), 16) * 2; // offset in bytes from data start
      const strLen = parseInt(data.slice(strOffset, strOffset + 64), 16);
      const strHex = data.slice(strOffset + 64, strOffset + 64 + strLen * 2);
      const trayId = Buffer.from(strHex, 'hex').toString('utf8');
      return { community, sourceTokenId, trayId, toAddress };
    }
  } catch {
    // fall through to basic info below
  }
  // Transfer found but no FaxMinted — still return basic info
  return { community: 0, sourceTokenId: 0, trayId: '', toAddress };
}

/// Fetches the tray document to get the fax image (as base64 data URI) and
/// chain depth (for tier classification used in the prize draw).
async function getFaxData(trayId: string): Promise<{ image: string | null; chainDepth: number | null }> {
  if (!trayId) return { image: null, chainDepth: null };
  try {
    const res = await fetch(`https://fax.nftmail.box/api/tray/${trayId}`, { cache: 'no-store' });
    if (!res.ok) return { image: null, chainDepth: null };
    const doc = await res.json() as { dataBase64?: string; format?: string; chainDepth?: number };
    const image = doc.dataBase64
      ? `data:${doc.format === 'png' ? 'image/png' : 'image/jpeg'};base64,${doc.dataBase64}`
      : null;
    const chainDepth = typeof doc.chainDepth === 'number' ? doc.chainDepth : null;
    return { image, chainDepth };
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

  const communityName = mintInfo ? COMMUNITY_NAMES[mintInfo.community] ?? 'UNKNOWN' : 'FAX';
  const name = `FAX CHAIN #${tokenId}`;
  const description = mintInfo
    ? `NFTFax Collectible #${tokenId} — minted from ${communityName}${mintInfo.sourceTokenId ? ` #${mintInfo.sourceTokenId}` : ''}${mintInfo.trayId ? ` (fax ${mintInfo.trayId})` : ''}. A chain-letter fax machine collectible on Base.`
    : `NFTFax Collectible #${tokenId} — a chain-letter fax machine collectible on Base.`;

  const { image: faxImage, chainDepth } = await getFaxData(mintInfo?.trayId ?? '');
  const image = faxImage ?? COLLECTION_IMAGE;
  // Worker counts the initial send as depth 1, but the first send is not a hop.
  // First forward = hop 1 (Dial Tone). Subtract 1 to get actual hop count.
  const hopCount = chainDepth != null ? Math.max(0, chainDepth - 1) : null;
  const tier = hopCount != null ? tierForDepth(hopCount) : 'Dial Tone';

  const metadata = {
    name,
    description,
    image,
    external_url: `https://fax.nftmail.box/tray/${mintInfo?.trayId ?? ''}`,
    attributes: [
      { trait_type: 'Tier', value: tier },
      ...(hopCount != null ? [{ trait_type: 'Chain Depth', value: hopCount }] : []),
      ...(mintInfo && mintInfo.trayId ? [{ trait_type: 'Fax Tray ID', value: mintInfo.trayId }] : []),
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
