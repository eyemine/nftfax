/// Reads/writes for the on-chain prize draw (commit/reveal on a future
/// block hash) in NFTFaxCollectible.sol, plus a reference client-side
/// winner-selection algorithm used by the /verify page.
///
/// No web3 library dependency (matches the rest of app/lib/*.ts) — raw
/// JSON-RPC eth_call / eth_getLogs over fetch, and eth_sendTransaction via
/// window.ethereum for the two write calls players can trigger themselves
/// (captureDrawSeed is permissionless by design).

import { MINT_CONFIG, isPlaceholderAddress } from './contracts';

// ---- Function selectors (from `cast sig`, computed against the deployed
// NFTFaxCollectible ABI — see contracts/src/NFTFaxCollectible.sol) ----
const SELECTOR_CURRENT_ROUND = '0x8a19c8bc'; // currentRound()
const SELECTOR_DRAWS = '0x0cc36c36'; // draws(uint256)
const SELECTOR_OWNER = '0x8da5cb5b'; // owner()
const SELECTOR_COMMIT_DRAW_BLOCK = '0xfdbfd371'; // commitDrawBlock(uint256)
const SELECTOR_CAPTURE_DRAW_SEED = '0x4023282d'; // captureDrawSeed(uint256)
const SELECTOR_TOKEN_URI = '0xc87b56dd'; // tokenURI(uint256)

// ---- Event topics (from `cast sig-event`) ----
const TOPIC_FAX_MINTED = '0x20a7befda21edb48bdea9b5c9be274f9329f49476f8e64469506e5629bcb0e5c';
const TOPIC_PRIZE_SENT = '0x53c7089a2c251ccbccd7be6bc38f96fb212155b3f9d93c719541e9386f49621c';
const TOPIC_PRIZES_DISTRIBUTED = '0xd10327254c357884a263c151f156a53648861251df3ad9033153d5300a133d24';

export const FAX_CONTRACT = MINT_CONFIG.contract;
export const FAX_RPC_URL = MINT_CONFIG.chain.rpcUrl;
export const FAX_CONTRACT_DEPLOYED = !isPlaceholderAddress(FAX_CONTRACT);

function encodeUint256(val: string | number | bigint): string {
  return BigInt(val).toString(16).padStart(64, '0');
}

interface RpcResponse<T = string> {
  result?: T;
  error?: { message?: string };
}

async function ethCall(data: string, rpcUrl: string = FAX_RPC_URL, contract: string = FAX_CONTRACT): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: contract, data }, 'latest'],
    }),
  });
  const json = (await res.json()) as RpcResponse;
  if (json.error) throw new Error(json.error.message ?? 'eth_call failed');
  return json.result ?? '0x';
}

export async function getBlockNumber(rpcUrl: string = FAX_RPC_URL): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const json = (await res.json()) as RpcResponse;
  return json.result ? parseInt(json.result, 16) : 0;
}

export async function getCurrentRound(): Promise<number> {
  const result = await ethCall(SELECTOR_CURRENT_ROUND);
  return Number(BigInt(result));
}

export async function getOwner(): Promise<string> {
  const result = await ethCall(SELECTOR_OWNER);
  return `0x${result.slice(-40)}`.toLowerCase();
}

export interface DrawRoundData {
  round: number;
  blockNumber: number;
  seed: string;
  seedCaptured: boolean;
  finalized: boolean;
}

/// Draw phase, in the order a round progresses through.
export type DrawPhase = 'none' | 'committed' | 'seed-ready' | 'seed-captured' | 'finalized';

export function getDrawPhase(round: DrawRoundData | null, currentBlock: number): DrawPhase {
  if (!round || round.blockNumber === 0) return 'none';
  if (round.finalized) return 'finalized';
  if (round.seedCaptured) return 'seed-captured';
  if (currentBlock > round.blockNumber) return 'seed-ready';
  return 'committed';
}

export async function getDrawRound(round: number): Promise<DrawRoundData | null> {
  if (round <= 0) return null;
  const data = SELECTOR_DRAWS + encodeUint256(round);
  const result = await ethCall(data);
  const hex = result.startsWith('0x') ? result.slice(2) : result;
  if (hex.length < 256) return null; // struct = 4 * 32-byte words

  const blockNumber = Number(BigInt(`0x${hex.slice(0, 64)}`));
  const seed = `0x${hex.slice(64, 128)}`;
  const seedCaptured = BigInt(`0x${hex.slice(128, 192)}`) === BigInt(1);
  const finalized = BigInt(`0x${hex.slice(192, 256)}`) === BigInt(1);

  return { round, blockNumber, seed, seedCaptured, finalized };
}

interface LogEntry {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

async function getLogs(topic0: string, extraTopics: (string | null)[] = []): Promise<LogEntry[]> {
  const res = await fetch(FAX_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        address: FAX_CONTRACT,
        fromBlock: '0x0',
        toBlock: 'latest',
        topics: [topic0, ...extraTopics],
      }],
    }),
  });
  const json = (await res.json()) as RpcResponse<LogEntry[]>;
  if (json.error) throw new Error(json.error.message ?? 'eth_getLogs failed');
  return json.result ?? [];
}

/// Every address a fax collectible has ever been minted to (FaxMinted.to,
/// the 2nd indexed topic). One entry per mint — a wallet that minted 3
/// times appears 3 times, so it gets 3 raffle entries in `selectWinners`.
export async function getAllMinters(): Promise<string[]> {
  const logs = await getLogs(TOPIC_FAX_MINTED);
  return logs.map((log) => `0x${log.topics[2].slice(-40)}`.toLowerCase());
}

export interface MintEntry {
  tokenId: number;
  minter: string;
}

/// Same as getAllMinters but also extracts the minted token ID
/// (FaxMinted.mintedTokenId, the 1st indexed topic) so the /verify page
/// can fetch each token's metadata and read its tier trait.
export async function getAllMintEntries(): Promise<MintEntry[]> {
  const logs = await getLogs(TOPIC_FAX_MINTED);
  return logs.map((log) => ({
    tokenId: Number(BigInt(log.topics[1])),
    minter: `0x${log.topics[2].slice(-40)}`.toLowerCase(),
  }));
}

/// ABI-decode a dynamic string from an eth_call return value.
function decodeString(hex: string): string {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (data.length < 128) return '';
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`));
  const lengthHex = data.slice(offset * 2, offset * 2 + 64);
  const length = Number(BigInt(`0x${lengthHex}`));
  const strHex = data.slice(offset * 2 + 64, offset * 2 + 64 + length * 2);
  const bytes = new Uint8Array(strHex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
  return new TextDecoder().decode(bytes);
}

/// Calls tokenURI(tokenId) on the collectible contract and returns the raw
/// URI string (HTTP URL, ipfs://, or data: URI).
export async function getTokenURI(tokenId: number): Promise<string> {
  const data = SELECTOR_TOKEN_URI + encodeUint256(tokenId);
  const result = await ethCall(data);
  return decodeString(result);
}

/// Converts an ipfs:// URI to an HTTPS gateway URL. Leaves HTTP/HTTPS/data
/// URIs untouched.
function resolveUri(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice(7); // strip 'ipfs://'
    return `https://gateway.lighthouse.storage/ipfs/${cid}`;
  }
  return uri;
}

interface NftMetadata {
  attributes?: { trait_type?: string; value?: string | number }[];
  tier?: string | number;
  [key: string]: unknown;
}

/// Fetches the metadata JSON for a token via its tokenURI and extracts the
/// tier trait. Returns null if the fetch fails or no tier trait is found.
/// (Non-fatal — the /verify page handles null tiers gracefully.)
export async function fetchTokenTier(tokenId: number): Promise<string | null> {
  try {
    const uri = await getTokenURI(tokenId);
    if (!uri) return null;

    let json: NftMetadata;
    if (uri.startsWith('data:application/json')) {
      const encoded = uri.slice(uri.indexOf(',') + 1);
      json = JSON.parse(decodeURIComponent(encoded)) as NftMetadata;
    } else {
      const res = await fetch(resolveUri(uri), { cache: 'force-cache' });
      if (!res.ok) return null;
      json = (await res.json()) as NftMetadata;
    }

    // Look for a trait_type matching 'tier' (case-insensitive) in attributes
    if (json.attributes) {
      for (const attr of json.attributes) {
        if (attr.trait_type && attr.trait_type.toLowerCase() === 'tier') {
          return String(attr.value);
        }
      }
    }
    // Fallback: top-level 'tier' field
    if (json.tier !== undefined) return String(json.tier);
    return null;
  } catch {
    return null;
  }
}

/// Fetch tiers for all minted tokens with a concurrency limit to avoid
/// hammering the RPC or IPFS gateway. Returns a map of tokenId -> tier.
export async function fetchAllTiers(
  tokenIds: number[],
  concurrency = 10,
): Promise<Map<number, string>> {
  const tiers = new Map<number, string>();
  const queue = [...tokenIds];

  async function worker() {
    while (queue.length > 0) {
      const tokenId = queue.shift();
      if (tokenId === undefined) break;
      const tier = await fetchTokenTier(tokenId);
      if (tier) tiers.set(tokenId, tier);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tokenIds.length) }, () => worker()));
  return tiers;
}

export interface PrizeSentEntry {
  round: number;
  winner: string;
  amount: bigint;
  txHash: string;
}

export async function getPrizeSentEvents(round?: number): Promise<PrizeSentEntry[]> {
  const roundTopic = round !== undefined ? `0x${encodeUint256(round)}` : null;
  const logs = await getLogs(TOPIC_PRIZE_SENT, [roundTopic]);
  return logs.map((log) => ({
    round: Number(BigInt(log.topics[1])),
    winner: `0x${log.topics[2].slice(-40)}`.toLowerCase(),
    amount: BigInt(log.data),
    txHash: log.transactionHash,
  }));
}

export async function getPrizesDistributedEvents(): Promise<{ round: number; seed: string; winnerCount: number; totalPaid: bigint }[]> {
  const logs = await getLogs(TOPIC_PRIZES_DISTRIBUTED);
  return logs.map((log) => {
    const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    return {
      round: Number(BigInt(log.topics[1])),
      seed: `0x${data.slice(0, 64)}`,
      winnerCount: Number(BigInt(`0x${data.slice(64, 128)}`)),
      totalPaid: BigInt(`0x${data.slice(128, 192)}`),
    };
  });
}

// ---------------------------------------------------------------------
// Wallet write calls (player-triggerable; owner-only calls are not
// exposed here since they're an ops action, not a player action)
// ---------------------------------------------------------------------

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: EthereumProvider };
  return w.ethereum ?? null;
}

/// Returns the encoded calldata for captureDrawSeed(round) — used by the
/// /draw page when sending via a Privy wallet's sendTransaction method.
export function encodeCaptureDrawSeed(round: number): string {
  return SELECTOR_CAPTURE_DRAW_SEED + encodeUint256(round);
}

/// captureDrawSeed(round) is intentionally permissionless on-chain — anyone
/// can call it once the committed block is mined, so seed capture can't be
/// delayed or censored by the owner. This lets a player trigger it directly.
/// Accepts an optional EIP-1193 provider (e.g. from Privy wallet); falls
/// back to window.ethereum if not provided.
export async function captureDrawSeedTx(fromAccount: string, round: number, provider?: EthereumProvider | null): Promise<{ txHash?: string; error?: string }> {
  const p = provider ?? getProvider();
  if (!p) return { error: 'A connected wallet is required.' };
  try {
    const data = SELECTOR_CAPTURE_DRAW_SEED + encodeUint256(round);
    const txHash = await p.request({
      method: 'eth_sendTransaction',
      params: [{ from: fromAccount, to: FAX_CONTRACT, data }],
    });
    return { txHash: typeof txHash === 'string' ? txHash : undefined };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/// Owner-only. Included for completeness on an admin-gated view of /draw.
export async function commitDrawBlockTx(fromAccount: string, futureBlock: number): Promise<{ txHash?: string; error?: string }> {
  const provider = getProvider();
  if (!provider) return { error: 'MetaMask or an EIP-1193 wallet is required.' };
  try {
    const data = SELECTOR_COMMIT_DRAW_BLOCK + encodeUint256(futureBlock);
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: fromAccount, to: FAX_CONTRACT, data }],
    });
    return { txHash: typeof txHash === 'string' ? txHash : undefined };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Reference winner-selection algorithm (client-side, no keccak256 lib
// needed — uses Web Crypto SHA-256 seeded by the on-chain block hash).
//
// IMPORTANT: this is a REFERENCE implementation of a fair, auditable
// selection rule. The actual off-chain draw runner (whatever script the
// team uses to produce the `winners`/`amounts` arrays passed to
// `distributePrizes`) MUST use this exact same algorithm, or the /verify
// page will show a mismatch even for a legitimate draw. The number of
// winners and how the 11 mint tiers (see app/about/page.tsx) map to prizes
// is an off-chain policy decision, not something this file asserts.
// ---------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/// Deterministic Fisher-Yates shuffle keyed by the on-chain seed. Same
/// seed + same input order always produces the same output order, so
/// anyone can recompute and verify it independently.
export async function seededShuffle<T>(entries: T[], seedHex: string): Promise<T[]> {
  const arr = [...entries];
  for (let i = arr.length - 1; i > 0; i--) {
    const hash = await sha256Hex(`${seedHex}:${i}`);
    const rand = BigInt(`0x${hash.slice(0, 16)}`);
    const j = Number(rand % BigInt(i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/// Selects `winnerCount` unique wallets from the minter list. Each mint is
/// one raffle entry (a wallet that minted 3 times has 3x the odds of a
/// wallet that minted once), then deduplicated in shuffle order so no
/// wallet can win twice.
export async function selectWinners(seedHex: string, minters: string[], winnerCount: number): Promise<string[]> {
  const shuffled = await seededShuffle(minters, seedHex);
  const winners: string[] = [];
  const seen = new Set<string>();
  for (const addr of shuffled) {
    if (seen.has(addr)) continue;
    seen.add(addr);
    winners.push(addr);
    if (winners.length >= winnerCount) break;
  }
  return winners;
}

export interface TieredWinner {
  tier: string;
  winner: string;
}

/// Tier-aware winner selection: groups mint entries by their NFT metadata
/// tier trait, shuffles the tier order using the on-chain seed, then picks
/// one winner per tier (shuffling entries within each tier using seed+tier).
/// Stops when `winnerCount` winners are selected. Tiers with no entries are
/// skipped. A wallet can only win once across all tiers.
///
/// This implements the "10 winners — one randomly selected from 11 tiers"
/// rule: if all 11 tiers have minters, one tier is randomly left out
/// (determined by the seed shuffling the tier order).
export async function selectTieredWinners(
  seedHex: string,
  entries: MintEntry[],
  tierMap: Map<number, string>,
  winnerCount: number,
): Promise<TieredWinner[]> {
  // Group entries by tier (skip entries with no tier data)
  const byTier = new Map<string, MintEntry[]>();
  for (const entry of entries) {
    const tier = tierMap.get(entry.tokenId);
    if (!tier) continue;
    const arr = byTier.get(tier);
    if (arr) arr.push(entry);
    else byTier.set(tier, [entry]);
  }

  // Shuffle the tier order using the seed
  const tierNames = Array.from(byTier.keys());
  const shuffledTiers = await seededShuffle(tierNames, seedHex);

  const winners: TieredWinner[] = [];
  const seenWallets = new Set<string>();

  for (const tier of shuffledTiers) {
    if (winners.length >= winnerCount) break;
    const tierEntries = byTier.get(tier)!;
    // Shuffle entries within this tier using seed + tier name for randomness
    const shuffledEntries = await seededShuffle(tierEntries, `${seedHex}:${tier}`);
    for (const entry of shuffledEntries) {
      if (seenWallets.has(entry.minter)) continue;
      seenWallets.add(entry.minter);
      winners.push({ tier, winner: entry.minter });
      break; // one winner per tier
    }
  }

  return winners;
}
