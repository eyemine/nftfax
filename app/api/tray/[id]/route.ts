/// GET /api/tray/[id]
///
/// Client-accessible fetch of a tray document (public chain-letter bitmap).
///
/// DELETE /api/tray/[id]  { local, ownerWallet }
///
/// Removes a jammed/decayed fax from the recipient's tray. Ownership is
/// verified fail-closed via resolveAddress.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

async function verifyOwner(local: string, wallet: string): Promise<NextResponse | null> {
  const resolveRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: workerHeaders(),
    body: JSON.stringify({ action: 'resolveAddress', name: local }),
    cache: 'no-store',
  });
  if (!resolveRes.ok) {
    return NextResponse.json({ error: 'Could not verify mailbox ownership.' }, { status: 503, headers: NO_STORE });
  }
  const resolved = await resolveRes.json() as Record<string, unknown>;
  if (resolved.exists === false && !resolved.sovereign) {
    return NextResponse.json({ error: 'Mailbox does not exist.' }, { status: 404, headers: NO_STORE });
  }
  if (resolved.exists === true) {
    const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
    if (!controller || controller !== wallet.toLowerCase()) {
      return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
    }
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: NO_STORE });
  }
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ action: 'getTrayDocument', id, secret: WEBHOOK_SECRET }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502, headers: NO_STORE });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { local?: string; ownerWallet?: string };
  const local = (body.local || '').toLowerCase().trim().replace(/@nftmail\.box$/, '').replace(/@fax$/, '');
  const wallet = (body.ownerWallet || '').trim();

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400, headers: NO_STORE });
  if (!local) return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  try {
    const denied = await verifyOwner(local, wallet);
    if (denied) return denied;

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        action: 'deleteTrayDocument',
        secret: WEBHOOK_SECRET,
        trayId: id,
        local,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 502, headers: NO_STORE });
  }
}
