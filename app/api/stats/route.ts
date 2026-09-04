/// Public telemetry for NFTFAX.
///
/// GET /api/stats
///
/// Two data sources, deliberately kept distinct so a consumer can tell which
/// number to trust:
///
///   totalMinted  — read live from the contract's totalMinted() on Base. This
///                  is authoritative and always current.
///   aggregates   — derived from the FaxMinted log cache that the leaderboard
///                  route maintains. This route only READS that cache and
///                  never scans the chain for logs itself, so hitting /api/stats
///                  cannot rate-limit the RPC or disturb the leaderboard.
///
/// If the cache does not exist yet (fresh deploy, before the leaderboard has
/// been requested once), aggregates are omitted and `aggregatesAvailable` is
/// false rather than reporting zeroes as though they were real.

import { NextResponse } from 'next/server';
import { BASE_FAX_COLLECTIBLE, BASE_CHAIN } from '../../lib/contracts';
import { readLogCache, decodeFaxMintedLog, aggregateMints, type CollectionStats } from '../../lib/fax-stats';

/// Telemetry is cheap and slightly stale is fine, so allow a short shared
/// cache. This is a public endpoint and may get hit by dashboards.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
} as const;

interface StatsResponse {
  contract: string;
  chain: string;
  chainId: number;
  /// Authoritative supply from the contract.
  totalMinted: number;
  /// True when the log cache was readable and aggregates below are populated.
  aggregatesAvailable: boolean;
  totalMints?: number;
  uniqueMinters?: number;
  collections?: CollectionStats[];
  /// Highest block covered by the log cache, so consumers can judge freshness.
  logsUpToBlock?: number;
  generatedAt: string;
}

async function getTotalMinted(): Promise<number | null> {
  try {
    const res = await fetch(BASE_CHAIN.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // totalMinted() selector
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: BASE_FAX_COLLECTIBLE, data: '0xa2309ff8' }, 'latest'],
      }),
      cache: 'no-store',
    });
    const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message || 'RPC error');
    if (typeof json.result === 'string') return parseInt(json.result, 16);
  } catch (cause) {
    console.error('[stats] totalMinted() call failed', cause);
  }
  return null;
}

export async function GET() {
  const totalMinted = await getTotalMinted();

  if (totalMinted === null) {
    return NextResponse.json(
      { error: 'Unable to read contract supply' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const body: StatsResponse = {
    contract: BASE_FAX_COLLECTIBLE,
    chain: BASE_CHAIN.name,
    chainId: BASE_CHAIN.id,
    totalMinted,
    aggregatesAvailable: false,
    generatedAt: new Date().toISOString(),
  };

  const cache = readLogCache();
  if (cache) {
    const { totalMints, uniqueMinters, collections } = aggregateMints(
      cache.logs.map(decodeFaxMintedLog),
    );
    body.aggregatesAvailable = true;
    body.totalMints = totalMints;
    body.uniqueMinters = uniqueMinters;
    body.collections = collections;
    body.logsUpToBlock = cache.upToBlock;
  }

  return NextResponse.json(body, { headers: CACHE_HEADERS });
}
