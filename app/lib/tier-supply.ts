/// Per-tier mint supply: how many tokens each prize tier has, read from the
/// same place the prize draw reads it — the `Tier` trait in every token's
/// on-chain tokenURI metadata. Server-only.
///
/// The contract only enforces the 2,222 total; tier caps (TIER_SUPPLY) are
/// enforced here, at pin time, which every app mint passes through.
///
/// Token metadata is cached per token (it only changes via an owner
/// setTokenURI), so a refresh fetches only new tokens plus stale entries.
/// Reservations hold a slot for a pin that is about to be minted, so two
/// concurrent mints cannot both take a tier's last slot.

import { getTokenURI, getTotalMinted } from './draw';
import { PRIZE_TIERS, TIER_SUPPLY, isPrizeTier, type PrizeTier } from './tiers';

const META_TTL_MS = 30 * 60_000;
const COUNTS_TTL_MS = 60_000;
const RESERVATION_TTL_MS = 15 * 60_000;

const GATEWAYS = [
  process.env.CRYPTO_IPFS_GATEWAY,
  'https://gateway.lighthouse.storage',
  'https://ipfs.io',
].filter((g): g is string => Boolean(g)).map((g) => g.replace(/\/$/, ''));

const tokenTierCache = new Map<number, { at: number; tier: PrizeTier | null }>();
const reservations = new Map<string, { tier: PrizeTier; at: number }>();
let countsCache: { at: number; value: TierCounts } | null = null;
let inFlight: Promise<TierCounts> | null = null;

export interface TierCounts {
  totalMinted: number;
  minted: Record<PrizeTier, number>;
  /// Tokens whose metadata could not be read — not counted against any tier.
  unknown: number[];
}

export interface TierStatus {
  tier: PrizeTier;
  supply: number;
  minted: number;
  remaining: number;
  mintedOut: boolean;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readTokenTier(tokenId: number): Promise<PrizeTier | null> {
  const uri = await getTokenURI(tokenId).catch(() => '');
  if (!uri) return null;
  let meta: unknown = null;
  if (uri.startsWith('data:application/json')) {
    try { meta = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1))); } catch { meta = null; }
  } else if (uri.startsWith('ipfs://')) {
    const cid = uri.slice(7);
    for (const gw of GATEWAYS) {
      try { meta = await fetchJson(`${gw}/ipfs/${cid}`); break; } catch { /* next gateway */ }
    }
  } else {
    try { meta = await fetchJson(uri); } catch { meta = null; }
  }
  const attrs = (meta as { attributes?: { trait_type?: string; value?: unknown }[] } | null)?.attributes ?? [];
  const value = attrs.find((a) => a.trait_type?.toLowerCase() === 'tier')?.value;
  return isPrizeTier(value) ? value : null;
}

async function computeCounts(): Promise<TierCounts> {
  const totalMinted = await getTotalMinted();
  const minted = Object.fromEntries(PRIZE_TIERS.map((t) => [t, 0])) as Record<PrizeTier, number>;
  const unknown: number[] = [];
  const now = Date.now();
  const queue = Array.from({ length: totalMinted }, (_, i) => i + 1);
  const resolveOne = async (tokenId: number) => {
    const hit = tokenTierCache.get(tokenId);
    let tier = hit && now - hit.at < META_TTL_MS && hit.tier ? hit.tier : null;
    if (!tier) {
      tier = await readTokenTier(tokenId);
      tokenTierCache.set(tokenId, { at: now, tier });
    }
    if (tier) minted[tier] += 1;
    else unknown.push(tokenId);
  };
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await resolveOne(t);
  }));
  return { totalMinted, minted, unknown: unknown.sort((a, b) => a - b) };
}

/// Minted count per tier (cached ~1 minute; concurrent callers share a fetch).
/// On a failed refresh the last good counts are returned.
export async function getTierCounts(force = false): Promise<TierCounts> {
  if (!force && countsCache && Date.now() - countsCache.at < COUNTS_TTL_MS) return countsCache.value;
  if (!inFlight) {
    inFlight = computeCounts()
      .then((value) => { countsCache = { at: Date.now(), value }; return value; })
      .catch((err) => { if (countsCache) return countsCache.value; throw err; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

function activeReservations(excludeTrayId?: string): Record<PrizeTier, number> {
  const now = Date.now();
  const held = Object.fromEntries(PRIZE_TIERS.map((t) => [t, 0])) as Record<PrizeTier, number>;
  reservations.forEach((r, trayId) => {
    if (now - r.at > RESERVATION_TTL_MS) { reservations.delete(trayId); return; }
    if (trayId !== excludeTrayId) held[r.tier] += 1;
  });
  return held;
}

export async function getTierStatus(): Promise<{ tiers: TierStatus[]; totalMinted: number; unknown: number[] }> {
  const counts = await getTierCounts();
  const held = activeReservations();
  const tiers = PRIZE_TIERS.map((tier) => {
    const supply = TIER_SUPPLY[tier];
    const taken = counts.minted[tier] + held[tier];
    return { tier, supply, minted: counts.minted[tier], remaining: Math.max(0, supply - taken), mintedOut: taken >= supply };
  });
  return { tiers, totalMinted: counts.totalMinted, unknown: counts.unknown };
}

/// Reserves a slot in `tier` for the fax about to be minted. Re-pinning the
/// same tray refreshes its own reservation rather than taking a second slot.
///
/// If the counts cannot be read at all (RPC down, no cache yet) the slot is
/// granted: no tier is near its cap today, and blocking every mint on an RPC
/// hiccup is worse than a theoretical overshoot. Revisit once any tier is
/// within reach of its supply.
/// `hold: false` only checks availability (used when pinning ahead of a
/// possible mint) without taking a slot.
export async function reserveTierSlot(
  tier: PrizeTier,
  trayId: string,
  { hold = true }: { hold?: boolean } = {},
): Promise<{ ok: boolean; supply: number; minted: number }> {
  const supply = TIER_SUPPLY[tier];
  let minted: number;
  try {
    minted = (await getTierCounts()).minted[tier];
  } catch (err) {
    console.warn(`[tier-supply] counts unavailable, granting ${tier} slot for ${trayId}:`, err);
    if (hold) reservations.set(trayId, { tier, at: Date.now() });
    return { ok: true, supply, minted: 0 };
  }
  const taken = minted + activeReservations(trayId)[tier];
  if (taken >= supply) return { ok: false, supply, minted };
  if (hold) reservations.set(trayId, { tier, at: Date.now() });
  return { ok: true, supply, minted };
}
