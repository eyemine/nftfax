/// GET /api/tray/[id]/mint-eligibility?local=...&wallet=...
///
/// Proxies to the worker's checkFaxMintEligibility action. This enforces the
/// per-chain single-claim rule (a source token can mint many collectibles, but
/// only one per chain) before the wallet is asked to sign.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const local = (searchParams.get('local') || '').toLowerCase().trim().replace(/@nftmail\.box$/, '');
  const wallet = (searchParams.get('wallet') || '').trim();

  if (!id) return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  if (!local) return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ action: 'checkFaxMintEligibility', trayId: id }),
    });
    const data = await res.json().catch(() => ({ error: 'Worker unavailable' })) as { eligible?: boolean; reason?: string; error?: string };
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Eligibility check failed' }, { status: 502, headers: NO_STORE });
  }
}
