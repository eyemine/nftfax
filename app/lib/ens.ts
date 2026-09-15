/// ENS reverse-resolution (address -> name) against Ethereum mainnet.
///
/// Shared by the leaderboard route (minter column) and /api/ens (rolofax
/// entries). Results are cached in-process — this runs as a persistent
/// Docker process on Hetzner, so a Map survives across requests. ENS
/// reverse records change rarely; a 6h TTL keeps signer/name rotation
/// reasonably fresh without hammering the RPC.

import { createPublicClient, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';

const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
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
          if (!name) return [addr, null, true] as const;
          // A reverse record is set by the ADDRESS owner and can point at any
          // name, including one they don't own (e.g. someone else's .eth/.box
          // domain) — it's not authoritative on its own. Only trust it once
          // the name's forward record resolves back to this exact address.
          // Let a thrown error here fall through to the outer catch (below)
          // so a transient RPC failure isn't cached as "verification failed".
          const forward = await client.getEnsAddress({ name });
          const verified = forward?.toLowerCase() === addr;
          return [addr, verified ? name : null, true] as const;
        } catch {
          // RPC failure, not a confirmed "no ENS name" — don't cache, so the
          // next request retries instead of being stuck showing the raw
          // address for a full TTL because of a transient RPC outage.
          return [addr, null, false] as const;
        }
      }),
    );
    for (const [addr, name, ok] of results) {
      if (!ok) continue;
      cache.set(addr, { name, at: now });
      if (name) out.set(addr, name);
    }
  }

  return out;
}

/// Forward ENS resolution: name -> address.
///
/// Separate cache from the reverse map above, keyed by normalised name. Unlike a
/// reverse record, a forward record IS authoritative — it is set by the name's
/// owner — so no round-trip confirmation is needed.
///
/// Returns null for anything that is not a resolvable name, including a name
/// with no address record. Never throws; an RPC failure returns null WITHOUT
/// caching, so a transient outage does not pin a name to "unresolvable" for a
/// full TTL.
const forwardCache = new Map<string, { address: string | null; at: number }>();

export async function resolveEnsAddress(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  // Must contain a dot and no whitespace to be a plausible name. Cheap guard so
  // typing a raw 0x address never costs an RPC call.
  if (!key || !key.includes('.') || /\s/.test(key) || key.startsWith('0x')) return null;

  const now = Date.now();
  const hit = forwardCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.address;

  try {
    const address = await client.getEnsAddress({ name: key });
    const out = address ? address.toLowerCase() : null;
    forwardCache.set(key, { address: out, at: now });
    return out;
  } catch {
    return null;
  }
}
