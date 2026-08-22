/// Fax Chain credit/decay (Thermal Fade) helpers.
///
/// Free/Basic accounts use `fax-credits` instead of a hard monthly cap.
/// - Receiving a fax sets `fax-last-received`.
/// - Forwarding a received fax within 72 hours adds +1 credit.
/// - If a received fax is not forwarded within 72 hours, the account loses
///   all credits.
/// - New sends consume 1 credit.

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

export const FADE_HOURS = 72;
export const FADE_MS = FADE_HOURS * 60 * 60 * 1000;

export const BASE_FREE_CREDITS = 2;

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

export async function applyThermalFade(label: string, ownerAddress: string): Promise<number> {
  const [credits, lastReceived, lastForwarded] = await Promise.all([
    getCredits(label),
    getLastReceived(label),
    getLastForwarded(label),
  ]);

  if (lastReceived && (lastForwarded === null || lastForwarded < lastReceived)) {
    const now = Date.now();
    if (now - lastReceived > FADE_MS) {
      if (credits > 0) await setCredits(label, 0, ownerAddress);
      return 0;
    }
  }

  return credits;
}

export async function spendCredit(label: string, ownerAddress: string): Promise<boolean> {
  const credits = await applyThermalFade(label, ownerAddress);
  if (credits <= 0) return false;
  await setCredits(label, credits - 1, ownerAddress);
  return true;
}

export async function earnForwardCredit(label: string, ownerAddress: string): Promise<void> {
  const [credits, lastReceived, lastForwarded] = await Promise.all([
    getCredits(label),
    getLastReceived(label),
    getLastForwarded(label),
  ]);

  const now = Date.now();
  let nextCredits = credits;

  // Only earn a credit for forwarding a received fax that hasn't already been
  // forwarded and hasn't thermally faded.
  if (lastReceived && (lastForwarded === null || lastForwarded < lastReceived)) {
    if (now - lastReceived <= FADE_MS) {
      nextCredits += 1;
    } else {
      nextCredits = 0;
    }
  }

  await setCredits(label, nextCredits, ownerAddress);
  await setLastForwarded(label, now, ownerAddress);
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
