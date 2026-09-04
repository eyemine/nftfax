/// Shared decoding and aggregation for FaxMinted events.
///
/// Extracted so /api/stats and /api/tray/leaderboard decode the same event the
/// same way. Only the leaderboard route WRITES the log cache (it owns the chain
/// scan); /api/stats reads it, so telemetry never triggers an RPC log scan of
/// its own.

import { readFileSync } from 'fs';
import { join } from 'path';

/// keccak256("FaxMinted(uint256,address,uint8,uint256,string)")
export const FAX_MINTED_TOPIC =
  '0x20a7befda21edb48bdea9b5c9be274f9329f49476f8e64469506e5629bcb0e5c';

export const DEPLOY_BLOCK = 50375000;

export const COMMUNITY_NAMES: Record<number, string> = {
  0: 'none', 1: 'chonk', 2: 'deadfellaz', 3: 'pow', 4: 'normie',
};

export interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

export interface MintEntry {
  tokenId: number;
  minter: string;
  community: number;
  sourceTokenId: number;
  trayId: string;
  chainDepth?: number;
  rootTrayId?: string;
}

/// DeadFellaz/POW/Normie mints encode sourceTokenId on-chain as a composite
/// (realTokenId * 1_000_000 + chainSuffix) — see encodeCompositeSourceTokenId
/// in fax-mint.ts — so the same real NFT can claim once per chain instead of
/// the contract's permanent once-ever claimed[] mapping. Chonk mints always use
/// the real ID (on-chain ownerOf() resolution requires it). Real collection
/// supplies are well under 1M, so any value >= 1_000_000 unambiguously
/// indicates the new composite encoding.
const CHAIN_SUFFIX_MOD = 1_000_000;

export function decodeSourceTokenId(raw: number, community: number): number {
  if (community === 1) return raw; // Chonk: always the real ID
  if (raw >= CHAIN_SUFFIX_MOD) return Math.floor(raw / CHAIN_SUFFIX_MOD);
  return raw; // legacy pre-composite mint, already the real ID
}

export function decodeFaxMintedLog(log: RpcLog): MintEntry {
  const tokenId = parseInt(log.topics[1] ?? '0x0', 16);
  const minter = '0x' + (log.topics[2] ?? '').slice(26).toLowerCase();
  const data = log.data.slice(2);
  const community = parseInt(data.slice(0, 64), 16);
  const rawSourceTokenId = parseInt(data.slice(64, 128), 16);
  const sourceTokenId = decodeSourceTokenId(rawSourceTokenId, community);
  // trayId is a dynamic string: offset (word 3), length, then UTF-8 bytes
  const stringOffset = parseInt(data.slice(128, 192), 16) * 2; // in hex chars
  const stringLen = parseInt(data.slice(stringOffset, stringOffset + 64), 16);
  const trayIdHex = data.slice(stringOffset + 64, stringOffset + 64 + stringLen * 2);
  const trayId = Buffer.from(trayIdHex, 'hex').toString('utf8');
  return { tokenId, minter, community, sourceTokenId, trayId };
}

// ── Log cache (written by the leaderboard route) ─────────────────────────────

export const CACHE_DIR = process.env.LEADERBOARD_CACHE_DIR || join(process.cwd(), 'data');
export const CACHE_FILE = join(CACHE_DIR, 'leaderboard-log-cache.json');

export interface CachedLogFile {
  logs: RpcLog[];
  upToBlock: number;
}

/// Reads the persisted log cache. Returns null when it does not exist yet —
/// the leaderboard route creates it on its first successful scan.
export function readLogCache(): CachedLogFile | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CachedLogFile;
    if (Array.isArray(parsed.logs) && typeof parsed.upToBlock === 'number') return parsed;
  } catch {
    // Missing or unreadable — caller decides how to degrade.
  }
  return null;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface CollectionStats {
  collection: string;
  mints: number;
  uniqueMinters: number;
  maxTokenId: number;
}

export interface AggregatedStats {
  totalMints: number;
  uniqueMinters: number;
  collections: CollectionStats[];
}

export function aggregateMints(mints: MintEntry[]): AggregatedStats {
  const byCollection = new Map<string, { mints: number; minters: Set<string>; maxTokenId: number }>();
  const allMinters = new Set<string>();

  for (const mint of mints) {
    allMinters.add(mint.minter);

    const name = COMMUNITY_NAMES[mint.community] ?? 'unknown';
    const entry = byCollection.get(name)
      ?? { mints: 0, minters: new Set<string>(), maxTokenId: 0 };
    entry.mints++;
    entry.minters.add(mint.minter);
    entry.maxTokenId = Math.max(entry.maxTokenId, mint.tokenId);
    byCollection.set(name, entry);
  }

  return {
    totalMints: mints.length,
    uniqueMinters: allMinters.size,
    collections: Array.from(byCollection.entries())
      .map(([collection, e]) => ({
        collection,
        mints: e.mints,
        uniqueMinters: e.minters.size,
        maxTokenId: e.maxTokenId,
      }))
      .sort((a, b) => b.mints - a.mints),
  };
}
