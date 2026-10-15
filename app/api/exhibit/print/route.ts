import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { after, NextRequest, NextResponse } from 'next/server';
import { recordExhibitNote } from '../../../lib/exhibit-feed';
import { publishExhibitSignal } from '../../../lib/exhibit-signal';
import { pingCheck, printerCheckUrl } from '../../../lib/exhibit-health';

/// Print queue between the exhibition display and the physical fax machine.
///
/// The display (a tablet in the gallery) and the printer (a Mac in Australia)
/// are on different continents and neither can reach the other directly. So
/// the tablet POSTs jobs here, and a daemon beside the printer long-polls for
/// them. The Mac never accepts an inbound connection and needs no public IP.
///
///   POST ?key=K  {event,...}        enqueue a job              (the tablet)
///   GET  ?key=K&wait=25             lease up to 5 jobs, waiting up to 25 s (the daemon)
///   POST ?key=K  {ack:{id,ok,error}} finish or fail a leased job (the daemon)
///   GET  ?key=K&status=1            daemon last-seen + depth   (the tablet)
///
/// The queue persists to the app's data volume so a container restart returns
/// leased jobs to pending instead of silently dropping physical print work.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Job = { id: string; payload: Record<string, unknown>; enqueuedAt: number; leasedAt: number | null; attempts: number };
type Queue = { jobs: Map<string, Job>; daemonSeenAt: number; daemonInfo: string; printed: number; failed: number; lastError: string | null; waiters: Array<() => void> };

const QUEUE_DIR = process.env.EXHIBIT_DATA_DIR || join(process.cwd(), 'data');
const QUEUE_FILE = join(QUEUE_DIR, 'exhibit-print-queue.json');

function loadQueue(): Queue {
  const queue: Queue = { jobs: new Map(), daemonSeenAt: 0, daemonInfo: '', printed: 0, failed: 0, lastError: null, waiters: [] };
  try {
    const parsed = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) as { jobs?: Job[]; printed?: number; failed?: number; lastError?: string | null };
    for (const job of parsed.jobs || []) {
      if (typeof job?.id !== 'string' || !job.id || typeof job.payload !== 'object' || !job.payload) continue;
      queue.jobs.set(job.id, { ...job, payload: job.payload, leasedAt: null, attempts: Number(job.attempts) || 0 });
    }
    queue.printed = Number(parsed.printed) || 0;
    queue.failed = Number(parsed.failed) || 0;
    queue.lastError = typeof parsed.lastError === 'string' ? parsed.lastError : null;
  } catch {
    // Missing or unreadable queue: start empty rather than blocking the exhibit.
  }
  return queue;
}

function persistQueue() {
  try {
    mkdirSync(QUEUE_DIR, { recursive: true });
    const temp = `${QUEUE_FILE}.tmp`;
    writeFileSync(temp, JSON.stringify({ jobs: Array.from(Q.jobs.values()), printed: Q.printed, failed: Q.failed, lastError: Q.lastError }));
    renameSync(temp, QUEUE_FILE);
  } catch (cause) {
    console.error('[exhibit-print] failed to persist queue', cause);
  }
}

// Survive HMR in dev; a fresh Map per module instance in prod restores jobs
// leased before a restart so the physical machine can retry them.
const g = globalThis as unknown as { __nftfaxPrintQueue?: Queue };
const Q: Queue = g.__nftfaxPrintQueue ??= loadQueue();

const KEY = process.env.EXHIBIT_PRINT_KEY || '';
const LEASE_MS = 90_000;      // a job leased but not acked in 90 s goes back to pending
const MAX_ATTEMPTS = 3;
const MAX_QUEUE = 50;

function authed(req: NextRequest) {
  const k = req.nextUrl.searchParams.get('key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return KEY.length > 0 && k === KEY;
}
function pending() {
  const now = Date.now();
  return Array.from(Q.jobs.values()).filter((j) => j.leasedAt === null || now - j.leasedAt > LEASE_MS).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}
function wake() { const w = Q.waiters.splice(0); for (const fn of w) fn(); }

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad json' }, { status: 400 });

  // Daemon acknowledging a leased job.
  const ack = body.ack as { id?: string; ok?: boolean; error?: string; retry?: boolean } | undefined;
  if (ack?.id) {
    Q.daemonSeenAt = Date.now();
    const job = Q.jobs.get(ack.id);
    if (!job) return NextResponse.json({ ok: true, note: 'unknown job' });
    if (ack.ok) { Q.jobs.delete(ack.id); Q.printed++; Q.lastError = null; }
    else if (ack.retry) {
      // Transient on the machine's side (printer asleep, paper out): surface the
      // reason on the tablet, put the job back, and do not count the attempt.
      Q.lastError = String(ack.error || 'printer busy').slice(0, 200);
      job.leasedAt = null; job.attempts = Math.max(0, job.attempts - 1);
    }
    else {
      Q.lastError = String(ack.error || 'print failed').slice(0, 200);
      if (job.attempts >= MAX_ATTEMPTS) { Q.jobs.delete(ack.id); Q.failed++; }
      else job.leasedAt = null;                  // back to pending; the next poll retries it
    }
    persistQueue();
    return NextResponse.json({ ok: true });
  }

  // Tablet enqueuing a print.
  if (typeof body.event !== 'string') return NextResponse.json({ error: 'event required' }, { status: 400 });
  if (Q.jobs.size >= MAX_QUEUE) return NextResponse.json({ error: 'queue full' }, { status: 429 });
  const source = String(body.source || 'exhibit').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'exhibit';
  body.source = source;
  recordExhibitNote({ event: body.event, source, tokenId: body.tokenId, from: body.from, visitor: body.visitor, coverNote: body.coverNote });
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  Q.jobs.set(id, { id, payload: body, enqueuedAt: Date.now(), leasedAt: null, attempts: 0 });
  persistQueue();
  publishExhibitSignal(body.event, body.tokenId, source);
  wake();
  return NextResponse.json({ ok: true, id, position: pending().length, daemonOnline: Date.now() - Q.daemonSeenAt < 60_000 });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = req.nextUrl.searchParams;

  if (p.get('status')) {
    return NextResponse.json({
      daemonOnline: Date.now() - Q.daemonSeenAt < 60_000,
      daemonSeenAt: Q.daemonSeenAt || null,
      daemonInfo: Q.daemonInfo || null,
      pending: pending().length,
      inFlight: Array.from(Q.jobs.values()).filter((j) => j.leasedAt !== null).length,
      printed: Q.printed,
      failed: Q.failed,
      lastError: Q.lastError,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Daemon poll. Long-poll up to `wait` seconds so the daemon can sit on one
  // request instead of hammering; wake early when a job arrives.
  Q.daemonSeenAt = Date.now();
  Q.daemonInfo = (p.get('info') || '').slice(0, 80);
  // Dead-man's switch for the printer Mac: pings stop when the daemon does.
  const printerNote = `printer daemon${Q.daemonInfo ? ` ${Q.daemonInfo}` : ''} · ${pending().length} pending · last error: ${Q.lastError || 'none'}`;
  after(() => pingCheck(printerCheckUrl(), true, printerNote));
  const wait = Math.min(25, Math.max(0, Number(p.get('wait') || 0))) * 1000;
  if (pending().length === 0 && wait > 0) {
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, wait); Q.waiters.push(() => { clearTimeout(t); resolve(); }); });
  }
  const now = Date.now();
  const lease = pending().slice(0, 5);
  for (const j of lease) { j.leasedAt = now; j.attempts++; }
  if (lease.length) persistQueue();
  return NextResponse.json({ jobs: lease.map((j) => ({ id: j.id, attempt: j.attempts, enqueuedAt: j.enqueuedAt, ...j.payload })) }, { headers: { 'Cache-Control': 'no-store' } });
}
