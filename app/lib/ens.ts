/// ENS reverse-resolution (address -> name) against Ethereum mainnet.
///
/// Shared by the leaderboard route (minter column) and /api/ens (rolofax
/// entries). Results are cached in-process — this runs as a persistent
/// Docker process on Hetzner, so a Map survives across requests. ENS
/// reverse records change rarely; a 6h TTL keeps signer/name rotation
/// reasonably fresh without hammering the RPC.

import { createPublicClient, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';

const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_BATCH = 50; // cap per call — public RPCs dislike huge bursts

const client = createPublicClient({
  chain: mainnet,
  transport: http(ETH_RPC_URL),
});

interface CacheEntry { name: string | null; at: number }
const cache = new Map<string, CacheEntry>();

/// Resolves a batch of addresses to ENS names. Returns a Map of
/// lowercase address -> name (absent key = no reverse record or lookup
/// failure). Never throws — a failed lookup caches null so one bad RPC
/// doesn't retry-storm on every request.
export async function resolveEnsNames(addresses: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const toFetch: string[] = [];

  for (const raw of addresses) {
    const addr = raw.toLowerCase();
    if (!isAddress(addr)) continue;
    const hit = cache.get(addr);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      if (hit.name) out.set(addr, hit.name);
    } else {
      toFetch.push(addr);
    }
  }

  for (let i = 0; i < toFetch.length; i += MAX_BATCH) {
    const batch = toFetch.slice(i, i + MAX_BATCH);
    const results = await Promise.all(
      batch.map(async (addr) => {
        try {
          const name = await client.getEnsName({ address: addr as `0x${string}` });
          return [addr, name] as const;
        } catch {
          return [addr, null] as const;
        }
      }),
    );
    for (const [addr, name] of results) {
      cache.set(addr, { name, at: now });
      if (name) out.set(addr, name);
    }
  }

  return out;
}
