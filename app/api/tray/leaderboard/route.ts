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

import { TOKEN_TRAY_ID_OVERRIDES } from '@/app/lib/mint-overrides';
import { minterHandleFor, resolveDisplayTrayId } from '@/app/lib/mint-display';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { BASE_FAX_COLLECTIBLE, BASE_CHAIN } from '../../../lib/contracts';
import { resolveEnsNames } from '../../../lib/ens';
import {
  FAX_MINTED_TOPIC,
  DEPLOY_BLOCK,
  COMMUNITY_NAMES,
  CACHE_DIR,
  CACHE_FILE,
  decodeFaxMintedLog as decodeLog,
  decodeSourceTokenId,
  type RpcLog,
  type MintEntry,
} from '../../../lib/fax-stats';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
// NOTE: Alchemy's free tier caps eth_getLogs at a 10-block range (vs. the
// public Base RPC's 2,000), making it unusable for this route's bulk
// history scan unless upgraded to a paid plan — deliberately NOT using
// ALCHEMY_API_KEY here (unlike app/lib/tba.ts) for that reason.
const RPC_URL = BASE_CHAIN.rpcUrl;
const CONTRACT = BASE_FAX_COLLECTIBLE;
// Persisted to disk (bind-mounted volume, see docker-compose.yml) so a
// container restart/redeploy doesn't force re-scanning the entire mint
// history from DEPLOY_BLOCK on the next request — that full rescan is what
// intermittently timed out/rate-limited against the public RPC and surfaced
// to users as "FAULT: Leaderboard request failed".
// Base's public RPC caps eth_getLogs at a 2,000-block range. This was 10,000,
// which meant every chunk failed with `-32614 eth_getLogs is limited to a
// 2,000 range` and the scan could never advance past the cached block.
const CHUNK_SIZE = 2_000;
const MAX_CONCURRENT_CHUNKS = 4;
const RPC_RETRIES = 3;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
// Envio HyperIndex GraphQL endpoint (hosted at envio.dev, repo:
// eyemine/nftfax-indexer). When set, mint history comes from the indexer
// instead of chunked eth_getLogs — faster and immune to public-RPC rate
// limits. If unset OR the query fails, the route falls back to the RPC
// scan + disk cache below, so an Envio outage/plan-limit deletion never
// takes the leaderboard down.
const ENVIO_GRAPHQL_URL = process.env.ENVIO_GRAPHQL_URL || '';

const COMMUNITY_PREFIXES: Record<number, string> = {
  1: 'chonk', 2: 'dfz', 3: 'atom', 4: 'normie',
};

interface LeaderboardEntry { collection: string; mints: number; maxTokenId: number; communities: number; }
interface LeaderboardData { leaderboard: LeaderboardEntry[]; totalMints: number; uniqueMintersTotal: number; contractBalanceEth: string; mints: MintEntry[]; mintsTotal: number; page: number; pageSize: number; }

// Post-mint tray corrections are shared with the metadata route — see app/lib/mint-overrides.ts.

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

interface TrayMeta { chainDepth?: number; rootTrayId?: string; from?: string; to?: string; forwardedTrayId?: string; bitmapRepairedAt?: number }

/// In-process tray-meta cache. Chain fields (rootTrayId, chainDepth) are set
/// at tray creation and never change, so a tray only needs one worker fetch
/// per process lifetime — this is what makes sorting the full mint history by
/// chain/tier affordable (the per-request fetch otherwise only covered the
/// current page). Empty results are NOT cached so a worker hiccup doesn't
/// permanently blank a tray's metadata.
const trayMetaCache = new Map<string, TrayMeta>();

async function fetchTrayMeta(trayId: string): Promise<TrayMeta> {
  const cached = trayMetaCache.get(trayId);
  if (cached) return cached;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      // Authenticated: the worker withholds `to` on public reads, and the
      // display rule needs it to tell whether the minter received this tray.
      // Without it every mint resolved to the event tray and #7 kept showing
      // the received image even after its forward marker was repaired.
      body: JSON.stringify({ action: 'getTrayDocument', id: trayId, secret: WEBHOOK_SECRET }),
    });
    if (!res.ok) return {};
    const doc = await res.json().catch(() => null) as TrayMeta | null;
    const meta: TrayMeta = {
      chainDepth: typeof doc?.chainDepth === 'number' ? doc.chainDepth : undefined,
      rootTrayId: typeof doc?.rootTrayId === 'string' ? doc.rootTrayId : undefined,
      from: typeof doc?.from === 'string' ? doc.from : undefined,
      to: typeof doc?.to === 'string' ? doc.to : undefined,
      forwardedTrayId: typeof doc?.forwardedTrayId === 'string' ? doc.forwardedTrayId : undefined,
      bitmapRepairedAt: typeof doc?.bitmapRepairedAt === 'number' ? doc.bitmapRepairedAt : undefined,
    };
    if (meta.chainDepth != null || meta.rootTrayId != null) trayMetaCache.set(trayId, meta);
    return meta;
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

// ── Envio indexer path ───────────────────────────────────────────────────

interface EnvioFaxMintedRow {
  mintedTokenId: string | number;
  to: string;
  community: string | number;
  sourceTokenId: string | number;
  trayId: string;
  transactionHash?: string;
}

const ENVIO_PAGE = 1000;

/// Fetches the full FaxMinted history from the Envio-hosted GraphQL
/// endpoint, paginating in 1000-row batches. Returns null on ANY failure
/// (network, GraphQL error, malformed row) so the caller can fall back to
/// the RPC scan — Envio's free tier can delete deployments when indexing
/// hours are exhausted, and that must never break this route.
async function fetchMintsFromEnvio(): Promise<MintEntry[] | null> {
  if (!ENVIO_GRAPHQL_URL) return null;
  try {
    const out: MintEntry[] = [];
    for (let offset = 0; ; offset += ENVIO_PAGE) {
      const res = await fetch(ENVIO_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query FaxMinted($limit: Int!, $offset: Int!) {
            NFTFaxCollectibleV2_FaxMinted(
              order_by: { blockNumber: asc }
              limit: $limit
              offset: $offset
            ) { mintedTokenId to community sourceTokenId trayId transactionHash }
          }`,
          variables: { limit: ENVIO_PAGE, offset },
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: { NFTFaxCollectibleV2_FaxMinted?: EnvioFaxMintedRow[] };
        errors?: unknown[];
      };
      const rows = json.data?.NFTFaxCollectibleV2_FaxMinted;
      if (json.errors || !Array.isArray(rows)) return null;
      for (const row of rows) {
        const tokenId = Number(row.mintedTokenId);
        const community = Number(row.community);
        const rawSource = Number(row.sourceTokenId);
        if (!Number.isFinite(tokenId) || !Number.isFinite(community) || !Number.isFinite(rawSource)) return null;
        out.push({
          tokenId,
          minter: String(row.to).toLowerCase(),
          community,
          sourceTokenId: decodeSourceTokenId(rawSource, community),
          trayId: String(row.trayId ?? ''),
          txHash: row.transactionHash ? String(row.transactionHash) : undefined,
        });
      }
      if (rows.length < ENVIO_PAGE) return out;
    }
  } catch (cause) {
    console.error('[leaderboard] envio fetch failed, falling back to RPC scan', cause);
    return null;
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
    // Sortable minted-collection panel. `sort` selects the column; anything
    // other than the tokenId default requires enriching mints BEFORE
    // pagination (sorting only the fetched page would silently reorder 20
    // rows instead of the collection — see below).
    const sortParam = searchParams.get('sort') || 'tokenId';
    const dirParam = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
    // Manual cache-bust escape hatch: ?refresh=1 forces a full re-scan from
    // DEPLOY_BLOCK, in case the cache ever needs to be reset.
    if (searchParams.get('refresh') === '1') {
      cachedLogs = [];
      cachedUpToBlock = DEPLOY_BLOCK - 1;
    }

    // Prefer the Envio indexer when configured; fall back to the RPC scan
    // on any failure so an indexer outage never breaks the leaderboard.
    const envioMints = await fetchMintsFromEnvio();

    const [totalMints, contractBalanceEth, currentBlock] = await Promise.all([
      getTotalMinted(), getContractBalanceEth(), getCurrentBlock(),
    ]);
    if (totalMints === 0 || currentBlock === 0) {
      return NextResponse.json({ leaderboard: [], totalMints: 0, uniqueMintersTotal: 0, contractBalanceEth, mints: [], mintsTotal: 0, page, pageSize } as LeaderboardData, { headers: NO_STORE });
    }

    let allMints: MintEntry[];
    // An empty Envio result while the contract reports mints means the
    // indexer is still backfilling (or was deleted) — fall back to RPC.
    if (envioMints !== null && envioMints.length > 0) {
      allMints = envioMints;
    } else {
      await ensureLogsCached(currentBlock);
      allMints = cachedLogs.map(decodeLog);
    }
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

    // Post-mint tray corrections apply before ANY enrichment or sorting — an
    // override changes which tray the metadata comes from.
    for (const mint of allMints) {
      const override = TOKEN_TRAY_ID_OVERRIDES[mint.tokenId];
      if (override) mint.trayId = override;
    }

    // Chain numbering + chain/tier sorting need rootTrayId/chainDepth for
    // EVERY mint, not just the page — so enrichment always runs over the
    // full set. The in-process trayMetaCache keeps this to one worker fetch
    // per tray per process lifetime; concurrency is bounded so a cold cache
    // doesn't burst 2000+ simultaneous worker calls at sellout.
    const needsEns = sortParam === 'minter';
    const ensByAddress = new Map<string, string>();

    if (allMints.length > 0) {
      const allTrayIds = Array.from(new Set(allMints.map((m) => m.trayId).filter(Boolean)));
      const metaByTrayId = new Map<string, TrayMeta>();
      for (let i = 0; i < allTrayIds.length; i += 16) {
        const batch = allTrayIds.slice(i, i + 16);
        const metas = await Promise.all(batch.map((id) => fetchTrayMeta(id)));
        batch.forEach((id, j) => metaByTrayId.set(id, metas[j]));
      }
      for (const mint of allMints) {
        const meta = metaByTrayId.get(mint.trayId);
        mint.rootTrayId = meta?.rootTrayId;
        mint.displayTrayId = TOKEN_TRAY_ID_OVERRIDES[mint.tokenId]
          ?? resolveDisplayTrayId(mint.trayId, minterHandleFor(mint), meta ?? {});
        mint.chainDepth = meta?.chainDepth;
      }
      // Depth describes the displayed hop (the artwork), not the received
      // tray — same rule the per-page enrichment applies below.
      const redirected = allMints.filter((m) => m.displayTrayId && m.displayTrayId !== m.trayId);
      if (redirected.length) {
        const hopMetas = await Promise.all(redirected.map((m) => fetchTrayMeta(m.displayTrayId as string)));
        redirected.forEach((m, i) => {
          if (hopMetas[i]?.chainDepth != null) m.chainDepth = hopMetas[i].chainDepth;
          if (!m.rootTrayId && hopMetas[i]?.rootTrayId) m.rootTrayId = hopMetas[i].rootTrayId;
        });
      }
    }
    if (needsEns) {
      const allMinters = Array.from(new Set(allMints.map((m) => m.minter)));
      (await resolveEnsNames(allMinters)).forEach((v, k) => ensByAddress.set(k, v));
    }

    // Chain index: a stable, human-readable number per chain. Chains are
    // ordered by the tokenId of their earliest mint — "Chain #1" is the
    // chain whose first mint came first. The chain key is the chain's root
    // tray (rootTrayId), falling back to the tray itself for root mints
    // whose docs predate the field.
    const chainOrder = new Map<string, number>();
    if (allMints.length > 0) {
      const chainFirstMint = new Map<string, number>();
      for (const m of allMints) {
        const key = m.rootTrayId || m.trayId;
        if (!key) continue;
        const prev = chainFirstMint.get(key);
        if (prev == null || m.tokenId < prev) chainFirstMint.set(key, m.tokenId);
      }
      Array.from(chainFirstMint.entries())
        .sort((a, b) => a[1] - b[1])
        .forEach(([key], i) => chainOrder.set(key, i + 1));
      for (const m of allMints) {
        const key = m.rootTrayId || m.trayId;
        m.chainIndex = key ? chainOrder.get(key) : undefined;
      }
    }

    const tierRank = (m: MintEntry): number | undefined => (m.chainDepth == null ? undefined : Math.max(0, m.chainDepth - 1)); // hop count, matches tierForDepth
    const handleKey = (m: MintEntry): number => m.community * 1e12 + m.sourceTokenId;
    const mul = dirParam === 'asc' ? 1 : -1;
    const numCmp = (av: number | undefined, bv: number | undefined): number => {
      if (av == null && bv == null) return 0;
      if (av == null) return 1;  // unresolved values sink to the end either direction
      if (bv == null) return -1;
      return (av - bv) * mul;
    };
    const strCmp = (av: string, bv: string): number => av.localeCompare(bv) * mul;
    const comparators: Record<string, (a: MintEntry, b: MintEntry) => number> = {
      tokenId: (a, b) => numCmp(a.tokenId, b.tokenId),
      tray: (a, b) => strCmp(a.trayId, b.trayId),
      chain: (a, b) => numCmp(a.chainIndex, b.chainIndex),
      tier: (a, b) => numCmp(tierRank(a), tierRank(b)),
      minter: (a, b) => strCmp(ensByAddress.get(a.minter) || a.minter, ensByAddress.get(b.minter) || b.minter),
      handle: (a, b) => numCmp(handleKey(a), handleKey(b)),
    };
    const cmp = comparators[sortParam] || comparators.tokenId;
    const sortedMints = allMints.slice().sort(cmp);

    const start = (page - 1) * pageSize;
    const pageMints = sortedMints.slice(start, start + pageSize);

    const uniqueMintersTotal = new Set(allMints.map((m) => m.minter)).size;
    const uniqueTrayIds = Array.from(new Set(pageMints.map((m) => m.trayId).filter(Boolean)));
    const uniqueMinters = Array.from(new Set(pageMints.map((m) => m.minter)));
    const [metas, ensPage] = await Promise.all([
      Promise.all(uniqueTrayIds.map((id) => fetchTrayMeta(id))),
      resolveEnsNames(uniqueMinters),
    ]);
    ensPage.forEach((v, k) => ensByAddress.set(k, v));
    const metaByTrayId = new Map(uniqueTrayIds.map((id, i) => [id, metas[i]]));
    for (const mint of pageMints) {
      const meta = metaByTrayId.get(mint.trayId);
      mint.rootTrayId = meta?.rootTrayId;
      mint.minterEns = ensByAddress.get(mint.minter);
      // The artwork is the minter's hop — see lib/mint-display.ts. Every
      // consumer reads displayTrayId from here instead of re-deriving it.
      // An explicit override PINS the display tray and skips the identity
      // rule: the operator has confirmed which art the token carries.
      mint.displayTrayId = TOKEN_TRAY_ID_OVERRIDES[mint.tokenId]
        ?? resolveDisplayTrayId(mint.trayId, minterHandleFor(mint), meta ?? {});
      mint.chainDepth = meta?.chainDepth;
    }
    // Depth must describe the displayed hop, not the received tray, when they
    // differ — it drives the tier shown beside the artwork.
    const redirected = pageMints.filter((m) => m.displayTrayId && m.displayTrayId !== m.trayId);
    if (redirected.length) {
      const hopMetas = await Promise.all(redirected.map((m) => fetchTrayMeta(m.displayTrayId as string)));
      redirected.forEach((m, i) => {
        if (hopMetas[i]?.chainDepth != null) m.chainDepth = hopMetas[i].chainDepth;
        m.imageVersion = hopMetas[i]?.bitmapRepairedAt;
      });
    }
    // A bitmap repaired in place keeps its URL; the version makes browsers,
    // Cloudflare and next/image treat it as a new image.
    for (const m of pageMints) {
      if (m.imageVersion == null) m.imageVersion = metaByTrayId.get(m.displayTrayId || m.trayId)?.bitmapRepairedAt;
    }

    return NextResponse.json({ leaderboard, totalMints, uniqueMintersTotal, contractBalanceEth, mints: pageMints, mintsTotal: allMints.length, page, pageSize } as LeaderboardData, { headers: NO_STORE });
  } catch (cause) {
    console.error('[leaderboard] lookup failed', cause);
    return NextResponse.json({ error: 'Leaderboard lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
