/// Single source of truth for prize tiers. Client- and server-safe (no imports).
///
/// Hop counting: the initial fax of a chain is hop 0. Each forward that adds to
/// a received fax is one hop. The worker stores `chainDepth` 1-indexed (the
/// initial fax is depth 1), so hop = chainDepth - 1:
///   hop 0  (depth 1)   initial fax — not mintable as a tier of its own;
///                      mapped to Dial Tone for legacy compatibility
///   hop 1  (depth 2)   Dial Tone (Tier 1)
///   hop 2  (depth 3)   Hop 2
///   ...
///   hop 11+ (depth 12+) Dead Letter
///
/// The tier is written into each token's metadata at pin time, and the prize
/// draw reads that trait — so every caller that names a tier MUST use these.

export const PRIZE_TIERS = [
  'Dial Tone', 'Hop 2', 'Hop 3', 'Hop 4', 'Hop 5',
  'Hop 6', 'Hop 7', 'Hop 8', 'Hop 9', 'Hop 10', 'Dead Letter',
] as const;

export type PrizeTier = (typeof PRIZE_TIERS)[number];

/// Fixed supply per tier. Canonical source: the tier table on /about, which
/// sums to exactly MAX_SUPPLY (2,222). Rarity increases with chain depth — a
/// deep hop is hard to reach, so the deepest tiers are the scarcest.
export const TIER_SUPPLY: Record<PrizeTier, number> = {
  'Dial Tone': 1111,
  'Hop 2': 555,
  'Hop 3': 246,
  'Hop 4': 111,
  'Hop 5': 88,
  'Hop 6': 44,
  'Hop 7': 21,
  'Hop 8': 13,
  'Hop 9': 12,
  'Hop 10': 11,
  'Dead Letter': 10,
};

/// Tier for a hop count (0 = initial fax).
export function tierForHop(hop: number): PrizeTier {
  if (hop < 1) return PRIZE_TIERS[0];
  if (hop >= PRIZE_TIERS.length) return PRIZE_TIERS[PRIZE_TIERS.length - 1];
  return PRIZE_TIERS[hop - 1];
}

/// Tier for the worker's 1-indexed chainDepth.
export function tierForChainDepth(chainDepth?: number | null): PrizeTier {
  if (chainDepth == null) return PRIZE_TIERS[0];
  return tierForHop(Math.max(0, chainDepth - 1));
}

export function isPrizeTier(value: unknown): value is PrizeTier {
  return typeof value === 'string' && (PRIZE_TIERS as readonly string[]).includes(value);
}
