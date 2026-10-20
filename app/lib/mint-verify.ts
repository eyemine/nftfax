/// Server-side truth for Base mints: verify a mint transaction from its receipt,
/// check the contract's one-time `claimed` flag, and find the on-chain mint of a
/// tray via the Envio indexer. The off-chain tray record (worker
/// markTrayMinted) is only a cache of this; when the browser never reports a
/// mint (closed tab, RPC hiccup), these let the server record it itself.
import { encodeFunctionData, decodeFunctionResult, parseAbi } from 'viem';
import { BASE_CHAIN, BASE_FAX_COLLECTIBLE } from './contracts';
import { FAX_MINTED_TOPIC, decodeFaxMintedLog, decodeSourceTokenId, type RpcLog, type MintEntry } from './fax-stats';

const RPC_URL = process.env.BASE_RPC_URL || BASE_CHAIN.rpcUrl;
const ENVIO_GRAPHQL_URL = process.env.ENVIO_GRAPHQL_URL || '';
const CLAIMED_ABI = parseAbi(['function claimed(uint8 community, uint256 sourceTokenId) view returns (bool)']);

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: T; error?: unknown };
        if (!json.error) return json.result ?? null;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`Base RPC ${method} failed`);
}

export type MintVerdict =
  | { status: 'confirmed'; mint: MintEntry }
  | { status: 'pending' }
  | { status: 'invalid'; reason: string };

/// Confirms `txHash` is a successful FaxMinted on the collectible contract for
/// one of `trayIds`. 'pending' = not mined yet (or RPC unavailable).
export async function verifyMintTx(txHash: string, trayIds: string[]): Promise<MintVerdict> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { status: 'invalid', reason: 'Malformed transaction hash' };
  let receipt: { status?: string; logs?: (RpcLog & { address?: string })[] } | null;
  try {
    receipt = await rpc('eth_getTransactionReceipt', [txHash]);
  } catch {
    return { status: 'pending' };
  }
  if (!receipt) return { status: 'pending' };
  if (receipt.status !== '0x1') return { status: 'invalid', reason: 'Mint transaction reverted on-chain' };
  const log = (receipt.logs ?? []).find(
    (l) => l.address?.toLowerCase() === BASE_FAX_COLLECTIBLE.toLowerCase() && l.topics?.[0] === FAX_MINTED_TOPIC,
  );
  if (!log) return { status: 'invalid', reason: 'Transaction is not a FAX CHAIN mint' };
  const mint = decodeFaxMintedLog({ ...log, transactionHash: txHash });
  if (!trayIds.includes(mint.trayId)) return { status: 'invalid', reason: `Transaction minted tray ${mint.trayId}, not this fax` };
  return { status: 'confirmed', mint };
}

/// The contract's permanent one-claim flag. Chonks use the real token id (one
/// collectible per Chonk, ever); the other communities use a per-chain
/// composite id. Returns null when the chain can't be read.
export async function isClaimedOnChain(community: number, rawSourceTokenId: bigint): Promise<boolean | null> {
  try {
    const data = encodeFunctionData({ abi: CLAIMED_ABI, functionName: 'claimed', args: [community, rawSourceTokenId] });
    const result = await rpc<`0x${string}`>('eth_call', [{ to: BASE_FAX_COLLECTIBLE, data }, 'latest']);
    return result ? decodeFunctionResult({ abi: CLAIMED_ABI, functionName: 'claimed', data: result }) : null;
  } catch {
    return null;
  }
}

/// Finds the on-chain mint of `trayId` through the Envio indexer, if any.
export async function findMintByTray(trayId: string): Promise<MintEntry | null> {
  if (!ENVIO_GRAPHQL_URL) return null;
  try {
    const res = await fetch(ENVIO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query MintByTray($trayId: String!) {
          NFTFaxCollectibleV2_FaxMinted(where: { trayId: { _eq: $trayId } }, limit: 1) {
            mintedTokenId to community sourceTokenId trayId transactionHash
          }
        }`,
        variables: { trayId },
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { NFTFaxCollectibleV2_FaxMinted?: Record<string, string | number>[] } };
    const row = json.data?.NFTFaxCollectibleV2_FaxMinted?.[0];
    if (!row) return null;
    const community = Number(row.community);
    return {
      tokenId: Number(row.mintedTokenId),
      minter: String(row.to).toLowerCase(),
      community,
      sourceTokenId: decodeSourceTokenId(Number(row.sourceTokenId), community),
      trayId: String(row.trayId),
      txHash: row.transactionHash ? String(row.transactionHash) : undefined,
    };
  } catch {
    return null;
  }
}
