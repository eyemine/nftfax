/// Printer keys and the @fax identity each exhibit sends as.
///
///   EXHIBIT_PRINT_KEY    the original exhibit; sends as exhibit@fax
///   EXHIBIT_PRINT_KEYS   optional further exhibits: "key=gallery@fax,key2=…"
///
/// The sender comes from the key, never from the request, so a visitor can
/// only add a name in front of it ("Richie exhibit@fax"), not impersonate.
///
/// NOTE: every key still shares one print queue (app/api/exhibit/print). Give
/// each exhibit its own queue before a second machine goes live, or both
/// printers will print each other's jobs.

export const DEFAULT_EXHIBIT_SENDER = 'exhibit@fax';
export const SENDER_NAME_MAX = 24;

function table(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.EXHIBIT_PRINT_KEYS || '').split(',')) {
    const [k, sender] = pair.split('=').map((s) => s?.trim() || '');
    if (k && /^[a-z0-9._-]+@fax$/i.test(sender)) m.set(k, sender.toLowerCase());
  }
  const main = process.env.EXHIBIT_PRINT_KEY || '';
  if (main && !m.has(main)) m.set(main, DEFAULT_EXHIBIT_SENDER);
  return m;
}

/// The exhibit a key belongs to, or null when the key is unknown.
export function exhibitForKey(key: string): { sender: string } | null {
  if (!key) return null;
  const sender = table().get(key);
  return sender ? { sender } : null;
}

/// Visitor-entered name: printable, single-spaced, at most 24 characters.
export function cleanSenderName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, SENDER_NAME_MAX).trim();
}

/// "Richie exhibit@fax", or just "exhibit@fax" with no name.
export function composeSender(name: unknown, sender: string): string {
  const n = cleanSenderName(name);
  return n ? `${n} ${sender}` : sender;
}
