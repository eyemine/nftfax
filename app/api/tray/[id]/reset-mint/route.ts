/// POST /api/tray/[id]/reset-mint   { local, ownerWallet }
///
/// Reset an incorrectly-recorded "Mint to Base" so the player can retry.
/// This is meant for cases where a mint transaction was broadcast but then
/// reverted/failed on-chain, yet the UI already recorded it as minted.

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

interface InboxFax {
  id: string;
  mintedBase?: { mintedAt: number } | null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { local?: string; ownerWallet?: string };
  const local = (body.local || '').toLowerCase().trim().replace(/@nftmail\.box$/, '');
  const wallet = (body.ownerWallet || '').trim();

  if (!id) return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  if (!local) return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  // Same self-fetch as /api/tray/[id]/mint: use http for the internal hop.
  const internalOrigin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;

  try {
    const listRes = await fetch(
      `${internalOrigin}/api/tray/inbox?local=${encodeURIComponent(local)}&wallet=${encodeURIComponent(wallet)}`,
      { cache: 'no-store' },
    );
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({ error: err.error || 'Ownership check failed' }, { status: listRes.status, headers: NO_STORE });
    }
    const { faxes = [] } = await listRes.json() as { faxes?: InboxFax[] };
    const fax = faxes.find((f) => f.id === id);
    if (!fax) {
      return NextResponse.json({ error: 'Fax not found in your fax-tray (it may have decayed).' }, { status: 404, headers: NO_STORE });
    }
    if (!fax.mintedBase) {
      return NextResponse.json({ error: 'This fax is not currently marked as minted.' }, { status: 409, headers: NO_STORE });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        action: 'markTrayUnminted',
        secret: WEBHOOK_SECRET,
        trayId: id,
        local,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Reset mint failed' }, { status: 502, headers: NO_STORE });
  }
}
