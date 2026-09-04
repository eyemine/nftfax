/// Reads totalMinted() from the V2 contract on Base. Scans FaxMinted events
/// to build the per-collection leaderboard, then enriches each mint with the
/// fax's real chain depth (tier) from the worker's tray KV — the contract
/// event only carries the source NFT's tokenId, which is NOT the chain depth.
///
/// Log scanning is cached in-process across requests (this runs as a
/// persistent Docker process on Hetzner, not serverless) — each request
/// only fetches the block range since the last successful scan instead of
/// re-scanning the entire history every time. This also fixes a bug where
/// public-RPC rate limiting on a failed eth_getLogs chunk would silently
/// drop that entire range of mints from the leaderboard with no error
/// surfaced (see rpc()'s retry logic and fetchLogsInRange()'s bounded
/// concurrency below).

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BASE_FAX_COLLECTIBLE, BASE_CHAIN } from '../../../lib/contracts';
import {
  FAX_MINTED_TOPIC,
  DEPLOY_BLOCK,
  COMMUNITY_NAMES,
  CACHE_DIR,
  CACHE_FILE,
  decodeFaxMintedLog as decodeLog,
  type RpcLog,
  type MintEntry,
} from '../../../lib/fax-stats';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
// NOTE: Alchemy's free tier caps eth_getLogs at a 10-block range (vs. the
// public Base RPC's 10,000), making it unusable for this route's bulk
// history scan unless upgraded to a paid plan — deliberately NOT using
// ALCHEMY_API_KEY here (unlike app/lib/tba.ts) for that reason.
const RPC_URL = BASE_CHAIN.rpcUrl;
const CONTRACT = BASE_FAX_COLLECTIBLE;
// Persisted to disk (bind-mounted volume, see docker-compose.yml) so a
// container restart/redeploy doesn't force re-scanning the entire mint
// history from DEPLOY_BLOCK on the next request — that full rescan is what
// intermittently timed out/rate-limited against the public RPC and surfaced
// to users as "FAULT: Leaderboard request failed".
const CHUNK_SIZE = 10_000;
const MAX_CONCURRENT_CHUNKS = 4;
const RPC_RETRIES = 3;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const COMMUNITY_PREFIXES: Record<number, string> = {
  1: 'chonk', 2: 'dfz', 3: 'atom', 4: 'normie',
};

interface LeaderboardEntry { collection: string; mints: number; maxTokenId: number; communities: number; }
interface LeaderboardData { leaderboard: LeaderboardEntry[]; totalMints: number; contractBalanceEth: string; mints: MintEntry[]; mintsTotal: number; page: number; pageSize: number; }

/// In-process cache of decoded-ready raw logs, keyed by the highest block
/// scanned so far. Persists across requests in this long-running server
/// process. `cacheInFlight` de-dupes concurrent requests so a burst of
/// simultaneous page loads triggers only one underlying scan.
let cachedLogs: RpcLog[] = [];
let cachedUpToBlock = DEPLOY_BLOCK - 1;
let cacheInFlight: Promise<void> | null = null;

try {
  const raw = readFileSync(CACHE_FILE, 'utf8');
  const parsed = JSON.parse(raw) as { logs: RpcLog[]; upToBlock: number };
  if (Array.isArray(parsed.logs) && typeof parsed.upToBlock === 'number') {
    cachedLogs = parsed.logs;
    cachedUpToBlock = parsed.upToBlock;
    console.log(`[leaderboard] restored ${cachedLogs.length} cached logs up to block ${cachedUpToBlock}`);
  }
} catch {
  // No cache file yet (first boot) or unreadable — fine, will do a full scan.
}

function persistCache(): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ logs: cachedLogs, upToBlock: cachedUpToBlock }));
  } catch (cause) {
    console.error('[leaderboard] failed to persist log cache', cause);
  }
}

async function fetchTrayMeta(trayId: string): Promise<{ chainDepth?: number; rootTrayId?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'getTrayDocument', id: trayId }),
    });
    if (!res.ok) return {};
    const doc = await res.json().catch(() => null) as { chainDepth?: number; rootTrayId?: string } | null;
    return {
      chainDepth: typeof doc?.chainDepth === 'number' ? doc.chainDepth : undefined,
      rootTrayId: typeof doc?.rootTrayId === 'string' ? doc.rootTrayId : undefined,
    };
  } catch {
    return {};
  }
}

/// Calls the RPC endpoint, retrying with backoff on network errors or RPC
/// error responses. Throws after exhausting retries — callers must not
/// treat a failure as "no logs" (that previously caused entire block
/// ranges to silently vanish from the leaderboard).
async function rpc(method: string, params: unknown[], attempt = 0): Promise<unknown> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message || 'RPC error');
    return json.result;
  } catch (cause) {
    if (attempt >= RPC_RETRIES) throw cause;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    return rpc(method, params, attempt + 1);
  }
}

async function getTotalMinted(): Promise<number> {
  try {
    const result = await rpc('eth_call', [{ to: CONTRACT, data: '0xa2309ff8' }, 'latest']);
    if (typeof result === 'string') return parseInt(result, 16);
  } catch { /* ignore */ }
  return 0;
}

async function getCurrentBlock(): Promise<number> {
  try {
    const result = await rpc('eth_blockNumber', []);
    if (typeof result === 'string') return parseInt(result, 16);
  } catch { /* ignore */ }
  return 0;
}

/// Fetches FaxMinted logs across [fromBlock, toBlock] in fixed-size chunks,
/// with bounded concurrency (public RPC endpoints rate-limit large bursts
/// of parallel requests — sending all chunks via Promise.all risked some
/// silently failing and dropping mints). Each chunk retries via rpc();
/// if a chunk still fails after retries, the whole fetch throws rather
/// than returning a partial, silently-incomplete result.
async function fetchLogsInRange(fromBlock: number, toBlock: number): Promise<RpcLog[]> {
  const ranges: Array<[number, number]> = [];
  for (let from = fromBlock; from <= toBlock; from += CHUNK_SIZE) {
    ranges.push([from, Math.min(from + CHUNK_SIZE - 1, toBlock)]);
  }
  const out: RpcLog[] = [];
  for (let i = 0; i < ranges.length; i += MAX_CONCURRENT_CHUNKS) {
    const batch = ranges.slice(i, i + MAX_CONCURRENT_CHUNKS);
    const results = await Promise.all(batch.map(([from, to]) => rpc('eth_getLogs', [{
      address: CONTRACT,
      topics: [FAX_MINTED_TOPIC],
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
    }])));
    for (const result of results) {
      out.push(...(result as RpcLog[]));
    }
  }
  return out;
}

/// Ensures the in-process cache covers up to `currentBlock`, fetching only
/// the incremental range since the last successful scan. If the fetch
/// fails, the cache cursor is not advanced so the same range is retried on
/// the next request instead of silently skipping it.
async function ensureLogsCached(currentBlock: number): Promise<void> {
  if (cachedUpToBlock >= currentBlock) return;
  if (cacheInFlight) return cacheInFlight;
  cacheInFlight = (async () => {
    const from = cachedUpToBlock + 1;
    const newLogs = await fetchLogsInRange(from, currentBlock);
    cachedLogs = cachedLogs.concat(newLogs);
    cachedUpToBlock = currentBlock;
    persistCache();
  })();
  try {
    await cacheInFlight;
  } finally {
    cacheInFlight = null;
  }
}

async function getContractBalanceEth(): Promise<string> {
  try {
    const result = await rpc('eth_getBalance', [CONTRACT, 'latest']);
    if (typeof result === 'string') {
      const wei = BigInt(result);
      const eth = Number(wei) / 1e18;
      return eth.toFixed(4);
    }
  } catch { /* ignore */ }
  return '0';
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20));
    // Manual cache-bust escape hatch: ?refresh=1 forces a full re-scan from
    // DEPLOY_BLOCK, in case the cache ever needs to be reset.
    if (searchParams.get('refresh') === '1') {
      cachedLogs = [];
      cachedUpToBlock = DEPLOY_BLOCK - 1;
    }

    const [totalMints, contractBalanceEth, currentBlock] = await Promise.all([
      getTotalMinted(), getContractBalanceEth(), getCurrentBlock(),
    ]);
    if (totalMints === 0 || currentBlock === 0) {
      return NextResponse.json({ leaderboard: [], totalMints: 0, contractBalanceEth, mints: [], mintsTotal: 0, page, pageSize } as LeaderboardData, { headers: NO_STORE });
    }

    await ensureLogsCached(currentBlock);

    const allMints: MintEntry[] = cachedLogs.map(decodeLog);
    const byCollection = new Map<string, { mints: number; maxTokenId: number; communities: Set<number> }>();

    for (const mint of allMints) {
      const name = COMMUNITY_NAMES[mint.community] ?? 'unknown';
      const entry = byCollection.get(name) ?? { mints: 0, maxTokenId: 0, communities: new Set<number>() };
      entry.mints++;
      entry.maxTokenId = Math.max(entry.maxTokenId, mint.tokenId);
      entry.communities.add(mint.community);
      byCollection.set(name, entry);
    }

    const leaderboard: LeaderboardEntry[] = Array.from(byCollection.entries())
      .map(([collection, e]) => ({ collection, mints: e.mints, maxTokenId: e.maxTokenId, communities: e.communities.size }))
      .sort((a, b) => b.mints - a.mints);

    // Newest-first, paginated AFTER sorting so page 1 always shows the most
    // recent mints. Tray metadata (chain depth/tier) is only fetched for the
    // current page's mints — at 2200+ mints, fetching metadata for every
    // single mint on every request would be very slow and mostly wasted.
    const sortedMints = allMints.slice().sort((a, b) => b.tokenId - a.tokenId);
    const start = (page - 1) * pageSize;
    const pageMints = sortedMints.slice(start, start + pageSize);

    const uniqueTrayIds = Array.from(new Set(pageMints.map((m) => m.trayId).filter(Boolean)));
    const metas = await Promise.all(uniqueTrayIds.map((id) => fetchTrayMeta(id)));
    const metaByTrayId = new Map(uniqueTrayIds.map((id, i) => [id, metas[i]]));
    for (const mint of pageMints) {
      const meta = metaByTrayId.get(mint.trayId);
      mint.chainDepth = meta?.chainDepth;
      mint.rootTrayId = meta?.rootTrayId;
    }

    return NextResponse.json({ leaderboard, totalMints, contractBalanceEth, mints: pageMints, mintsTotal: allMints.length, page, pageSize } as LeaderboardData, { headers: NO_STORE });
  } catch (cause) {
    console.error('[leaderboard] lookup failed', cause);
    return NextResponse.json({ error: 'Leaderboard lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
