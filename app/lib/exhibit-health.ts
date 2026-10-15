import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

/// Exhibit health: the last heartbeat from each kiosk display (the gallery
/// tablet running /exhibit), plus forwarding to healthchecks.io so a person is
/// told when a kiosk or the printer daemon goes quiet.
///
/// healthchecks.io is a dead-man's switch: it alerts when pings STOP. A kiosk
/// that loses power or Wi-Fi cannot report that it is offline, so the alert has
/// to come from the absence of pings, not from a message. A low battery while
/// unplugged is reported as a /fail ping, which alerts at once.
///
/// Env (all optional; nothing is forwarded when unset):
///   EXHIBIT_KIOSK_HEALTHCHECK_URL            check URL for every kiosk
///   EXHIBIT_KIOSK_HEALTHCHECK_URL_<ID>       per kiosk, e.g. _MARFA_1 for ?kiosk=marfa-1
///   EXHIBIT_PRINTER_HEALTHCHECK_URL          check URL for the printer daemon
///   EXHIBIT_LOW_BATTERY                      percent, default 20

export type KioskReport = {
  id: string;
  seenAt: number;
  battery: number | null;
  charging: boolean | null;
  wifiSsid: string | null;
  wifiSignal: number | null;
  screenOn: boolean | null;
  fully: boolean;
  agent: string;
  page: string;
};

const MAX_KIOSKS = 10;
const ONLINE_MS = 150_000; // a kiosk pings every 60 s: two missed pings = offline
const DIR = process.env.EXHIBIT_DATA_DIR || join(process.cwd(), 'data');
const FILE = join(DIR, 'exhibit-kiosks.json');
export const KIOSK_ID = /^[a-z0-9-]{1,32}$/;
export const LOW_BATTERY = Math.min(90, Math.max(5, Number(process.env.EXHIBIT_LOW_BATTERY) || 20));

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max);
const num = (value: unknown, lo: number, hi: number) => {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : Math.min(hi, Math.max(lo, Math.round(n)));
};
const bool = (value: unknown) => (typeof value === 'boolean' ? value : null);

function load(): Map<string, KioskReport> {
  const map = new Map<string, KioskReport>();
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as { kiosks?: KioskReport[] };
    for (const k of parsed.kiosks || []) if (typeof k?.id === 'string' && KIOSK_ID.test(k.id)) map.set(k.id, k);
  } catch {
    // first run, or unreadable: start empty
  }
  return map;
}

const g = globalThis as unknown as { __nftfaxKiosks?: Map<string, KioskReport>; __nftfaxHcLast?: Map<string, number> };
const kiosks = (g.__nftfaxKiosks ??= load());
const lastPing = (g.__nftfaxHcLast ??= new Map());

function persist() {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify({ kiosks: Array.from(kiosks.values()) }));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (cause) {
    console.error('[exhibit-health] failed to persist kiosks', cause);
  }
}

/// Stores a kiosk heartbeat. Returns null when the id is invalid or the kiosk
/// table is full of other ids.
export function recordKiosk(id: string, input: Record<string, unknown>): KioskReport | null {
  if (!KIOSK_ID.test(id)) return null;
  if (!kiosks.has(id) && kiosks.size >= MAX_KIOSKS) return null;
  const report: KioskReport = {
    id,
    seenAt: Date.now(),
    battery: num(input.battery, 0, 100),
    charging: bool(input.charging),
    wifiSsid: clean(input.wifiSsid, 64) || null,
    wifiSignal: num(input.wifiSignal, -127, 100),
    screenOn: bool(input.screenOn),
    fully: input.fully === true,
    agent: clean(input.agent, 160),
    page: clean(input.page, 200),
  };
  kiosks.set(id, report);
  persist();
  return report;
}

export function listKiosks() {
  const now = Date.now();
  return Array.from(kiosks.values())
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((k) => ({ ...k, online: now - k.seenAt < ONLINE_MS, lowBattery: k.battery !== null && k.battery <= LOW_BATTERY && k.charging !== true }));
}

function checkUrl(value: string | undefined) {
  return value && /^https:\/\/[^\s]+$/.test(value) ? value.replace(/\/+$/, '') : null;
}

export function kioskCheckUrl(id: string) {
  return checkUrl(process.env[`EXHIBIT_KIOSK_HEALTHCHECK_URL_${id.toUpperCase().replace(/-/g, '_')}`]) || checkUrl(process.env.EXHIBIT_KIOSK_HEALTHCHECK_URL);
}
export const printerCheckUrl = () => checkUrl(process.env.EXHIBIT_PRINTER_HEALTHCHECK_URL);

/// Pings a healthchecks.io check, at most once per 50 s per check unless the
/// state flips. Fire-and-forget: a slow or failing monitor never delays the
/// kiosk or the printer daemon.
const lastState = new Map<string, boolean>();
export function pingCheck(url: string | null, ok: boolean, note: string) {
  if (!url) return;
  const now = Date.now();
  const flipped = lastState.get(url) !== ok;
  if (!flipped && now - (lastPing.get(url) || 0) < 50_000) return;
  lastPing.set(url, now);
  lastState.set(url, ok);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  fetch(ok ? url : `${url}/fail`, { method: 'POST', body: note.slice(0, 2000), signal: controller.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

export function describeKiosk(k: KioskReport) {
  const battery = k.battery === null ? 'battery ?' : `battery ${k.battery}%${k.charging ? ' charging' : k.charging === false ? ' unplugged' : ''}`;
  const wifi = k.wifiSsid ? `wifi ${k.wifiSsid}${k.wifiSignal !== null ? ` (${k.wifiSignal})` : ''}` : 'wifi ?';
  const screen = k.screenOn === null ? '' : ` · screen ${k.screenOn ? 'on' : 'off'}`;
  return `${k.id}: ${battery} · ${wifi}${screen}${k.fully ? ' · Fully' : ''}`;
}
