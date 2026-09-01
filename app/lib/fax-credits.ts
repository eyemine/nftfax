/// Fax Chain credit economy v2.
///
/// Free/Basic accounts use `fax-credits` as the chain-letter fuel.
/// - Starting balance: 2 credits (5 for the first 100 joiners).
/// - Hard credit cap: MAX_CREDITS per handle.
/// - Every forward consumes 1 credit from the sender.
/// - Hops 1-5: a successful forward also credits the recipient +1 (capped),
///   so the chain can keep moving without minting.
/// - Hop 6+: forwarding consumes the sender's credit but does NOT credit the
///   recipient; the chain stalls unless the recipient mints.
/// - Minting consumes 1 credit from the minter and credits the next recipient
///   +1 (capped), giving the next hop a fresh 72-hour timer.
/// - Unminted forwarding applies the decayed hop timer.
/// - No credit is awarded for reverted or abandoned transactions.
/// - Credits are keyed by the @fax handle (token-bound), not globally by EOA.

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

/// Hop timer schedule (no prior mint). After a mint, the next hop always
/// resets to 72 hours. Hop 11 has a 3-minute relay before the line is jammed.
/// Hop 12+ is dead: no timer and no minting.
export const RELAY_TIMERS_NO_MINT_MS: number[] = [
  72 * 60 * 60 * 1000, // 1
  36 * 60 * 60 * 1000, // 2
  18 * 60 * 60 * 1000, // 3
  9 * 60 * 60 * 1000,  // 4
  4.5 * 60 * 60 * 1000, // 5
  2 * 60 * 60 * 1000,  // 6
  1 * 60 * 60 * 1000,  // 7
  30 * 60 * 1000,      // 8
  15 * 60 * 1000,      // 9
  10 * 60 * 1000,      // 10
  3 * 60 * 1000,       // 11
];

export const FADE_HOURS = 72;
export const FADE_MS = FADE_HOURS * 60 * 60 * 1000;

/// Default thermal fade for received faxes before they are assigned a chain
/// depth (legacy / out-of-band faxes).
export const DEFAULT_JAM_MS = RELAY_TIMERS_NO_MINT_MS[0];

export const BASE_FREE_CREDITS = 2;

/// Hard cap on credits a single @fax handle can hold at once.
export const MAX_CREDITS = 5;

/// First 100 accounts to ever check their fax credits get a launch bonus of
/// 5 free credits instead of the standard 2. Best-effort (not transactional —
/// concurrent first-time joins may occasionally over/undercount by a couple
/// under heavy simultaneous load), gated by `fax-joined:{label}` so a given
/// label is only ever counted once.
export const FIRST_JOINER_BONUS_CREDITS = 5;
export const FIRST_JOINER_CAP = 100;
const JOINER_COUNT_KEY = 'fax-joiner-count';

function labelKey(prefix: string, label: string): string {
  return `${prefix}:${label.toLowerCase().trim()}`;
}

async function kvGet(key: string): Promise<string | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_SECRET ? { 'X-Worker-Secret': WORKER_SECRET } : {}),
      },
      body: JSON.stringify({ action: 'kvGet', key }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { value: string | null };
    return data.value;
  } catch {
    return null;
  }
}

async function kvPut(key: string, value: string, ownerAddress: string) {
  await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WORKER_SECRET ? { 'X-Worker-Secret': WORKER_SECRET } : {}),
    },
    body: JSON.stringify({
      action: 'kvPut',
      key,
      value,
      ownerAddress: ownerAddress.toLowerCase(),
      webhookSecret: WEBHOOK_SECRET,
    }),
  });
}

export async function getCredits(label: string): Promise<number> {
  const raw = await kvGet(labelKey('fax-credits', label));
  if (raw === null) return BASE_FREE_CREDITS;
  const n = parseInt(raw, 10);
  return isNaN(n) ? BASE_FREE_CREDITS : n;
}

export async function setCredits(label: string, credits: number, ownerAddress: string) {
  await kvPut(labelKey('fax-credits', label), String(credits), ownerAddress);
}

export async function getLastReceived(label: string): Promise<number | null> {
  const raw = await kvGet(labelKey('fax-last-received', label));
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

export async function setLastReceived(label: string, timestamp: number, ownerAddress: string) {
  await kvPut(labelKey('fax-last-received', label), String(timestamp), ownerAddress);
}

export async function getLastForwarded(label: string): Promise<number | null> {
  const raw = await kvGet(labelKey('fax-last-forwarded', label));
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

export async function setLastForwarded(label: string, timestamp: number, ownerAddress: string) {
  await kvPut(labelKey('fax-last-forwarded', label), String(timestamp), ownerAddress);
}


/// Get the relay timer for a given hop. After a prior mint, the timer is
/// always 72h. Hop 12+ is dead (0ms). Hop indexing is 1-based.
export function getChainTimerMs(hop: number, afterPriorMint = false): number {
  if (hop <= 0) return RELAY_TIMERS_NO_MINT_MS[0];
  if (hop > RELAY_TIMERS_NO_MINT_MS.length) return 0;
  if (afterPriorMint) return FADE_MS;
  return RELAY_TIMERS_NO_MINT_MS[hop - 1];
}

export function capCredits(credits: number): number {
  return Math.min(Math.max(0, credits), MAX_CREDITS);
}

export async function earnSendCredit(label: string, ownerAddress: string, amount = 1): Promise<number> {
  const credits = await getCredits(label);
  const nextCredits = capCredits(credits + amount);
  await setCredits(label, nextCredits, ownerAddress);
  return nextCredits;
}

/// Spend one send credit from `label`. Returns true if a credit was available.
export async function spendCredit(label: string, ownerAddress: string): Promise<boolean> {
  const credits = await getCredits(label);
  if (credits < 1) return false;
  await setCredits(label, credits - 1, ownerAddress);
  return true;
}

/// Forward a fax: the sender always spends 1 credit. For hops 1-5 the
/// recipient is also credited +1 (capped). Hop 6+ does not credit the
/// recipient; the chain must be unlocked by a mint.
export async function transferForwardCredit(
  sender: string,
  recipient: string,
  ownerAddress: string,
  nextHop: number,
): Promise<{ senderCredits: number; recipientCredits: number }> {
  const canSpend = await spendCredit(sender, ownerAddress);
  if (!canSpend) throw new Error('Not enough send credits to forward this fax');

  const senderCredits = await getCredits(sender);

  // Dead chain — should have been blocked before calling.
  if (nextHop > RELAY_TIMERS_NO_MINT_MS.length) {
    return { senderCredits, recipientCredits: await getCredits(recipient) };
  }

  let recipientCredits = await getCredits(recipient);
  if (nextHop <= 5) {
    recipientCredits = await earnSendCredit(recipient, ownerAddress, 1);
  }
  await setLastForwarded(sender, Date.now(), ownerAddress);
  return { senderCredits, recipientCredits };
}

/// Mint a fax: the minter always spends 1 credit and the next recipient
/// (the player who receives the next hop) is credited +1 (capped). This also
/// gives the next hop a fresh 72-hour timer.
export async function transferMintCredit(
  minter: string,
  nextRecipient: string,
  ownerAddress: string,
): Promise<{ minterCredits: number; recipientCredits: number }> {
  const canSpend = await spendCredit(minter, ownerAddress);
  if (!canSpend) throw new Error('Not enough send credits to mint this fax');

  const minterCredits = await getCredits(minter);
  const recipientCredits = await earnSendCredit(nextRecipient, ownerAddress, 1);
  return { minterCredits, recipientCredits };
}

/// Grants the first-100-joiners launch bonus on an account's very first
/// credits lookup, then behaves like `getCredits` on every subsequent call.
/// Call this from the credits GET route instead of `getCredits` directly.
export async function ensureJoinerBonus(label: string, ownerAddress: string): Promise<number> {
  const joinedRaw = await kvGet(labelKey('fax-joined', label));
  if (joinedRaw !== null) {
    return getCredits(label);
  }

  const countRaw = await kvGet(JOINER_COUNT_KEY);
  const count = countRaw ? parseInt(countRaw, 10) || 0 : 0;
  const granted = count < FIRST_JOINER_CAP ? FIRST_JOINER_BONUS_CREDITS : BASE_FREE_CREDITS;

  await Promise.all([
    setCredits(label, granted, ownerAddress),
    kvPut(labelKey('fax-joined', label), String(granted), ownerAddress),
    ...(count < FIRST_JOINER_CAP ? [kvPut(JOINER_COUNT_KEY, String(count + 1), ownerAddress)] : []),
  ]);

  return granted;
}

/// Reset an account's thermal-fade jam and refill free credits.
export async function clearJam(label: string, ownerAddress: string): Promise<number> {
  const now = Date.now();
  await Promise.all([
    setCredits(label, BASE_FREE_CREDITS, ownerAddress),
    setLastReceived(label, now, ownerAddress),
    setLastForwarded(label, now, ownerAddress),
  ]);
  return BASE_FREE_CREDITS;
}
