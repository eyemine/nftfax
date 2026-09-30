import { NextRequest, NextResponse } from 'next/server';

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
/// The queue lives in process memory. A container restart loses whatever is
/// in flight, which is at most a few seconds of jobs given the poll cadence;
/// that is an acceptable trade against adding storage for a weekend show.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Job = { id: string; payload: Record<string, unknown>; enqueuedAt: number; leasedAt: number | null; attempts: number };
type Queue = { jobs: Map<string, Job>; daemonSeenAt: number; daemonInfo: string; printed: number; failed: number; lastError: string | null; waiters: Array<() => void> };

// Survive HMR in dev; a fresh Map per module instance in prod is fine.
const g = globalThis as unknown as { __nftfaxPrintQueue?: Queue };
const Q: Queue = g.__nftfaxPrintQueue ??= { jobs: new Map(), daemonSeenAt: 0, daemonInfo: '', printed: 0, failed: 0, lastError: null, waiters: [] };

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
  const ack = body.ack as { id?: string; ok?: boolean; error?: string } | undefined;
  if (ack?.id) {
    Q.daemonSeenAt = Date.now();
    const job = Q.jobs.get(ack.id);
    if (!job) return NextResponse.json({ ok: true, note: 'unknown job' });
    if (ack.ok) { Q.jobs.delete(ack.id); Q.printed++; Q.lastError = null; }
    else {
      Q.lastError = String(ack.error || 'print failed').slice(0, 200);
      if (job.attempts >= MAX_ATTEMPTS) { Q.jobs.delete(ack.id); Q.failed++; }
      else job.leasedAt = null;                  // back to pending; the next poll retries it
    }
    return NextResponse.json({ ok: true });
  }

  // Tablet enqueuing a print.
  if (typeof body.event !== 'string') return NextResponse.json({ error: 'event required' }, { status: 400 });
  if (Q.jobs.size >= MAX_QUEUE) return NextResponse.json({ error: 'queue full' }, { status: 429 });
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  Q.jobs.set(id, { id, payload: body, enqueuedAt: Date.now(), leasedAt: null, attempts: 0 });
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
  const wait = Math.min(25, Math.max(0, Number(p.get('wait') || 0))) * 1000;
  if (pending().length === 0 && wait > 0) {
    await new Promise<void>((resolve) => { const t = setTimeout(resolve, wait); Q.waiters.push(() => { clearTimeout(t); resolve(); }); });
  }
  const now = Date.now();
  const lease = pending().slice(0, 5);
  for (const j of lease) { j.leasedAt = now; j.attempts++; }
  return NextResponse.json({ jobs: lease.map((j) => ({ id: j.id, attempt: j.attempts, enqueuedAt: j.enqueuedAt, ...j.payload })) }, { headers: { 'Cache-Control': 'no-store' } });
}
