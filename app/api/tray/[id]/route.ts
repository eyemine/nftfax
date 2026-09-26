/// GET /api/tray/[id]
///
/// Client-accessible fetch of a tray document (public chain-letter bitmap).
///
/// DELETE /api/tray/[id]  { local, ownerWallet }
///
/// Removes a jammed/decayed fax from the recipient's tray. Ownership is
/// verified fail-closed via resolveAddress.

import { NextRequest, NextResponse } from 'next/server';
import { parseFaxHandle, verifyFaxHandleOwner } from '@/app/lib/fax-ownership';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

/// Returns a denial response, or null when the wallet may act on `local`.
///
/// DELETE is destructive, so this must fail CLOSED. It previously authorized via
/// resolveAddress, which returns { exists: false } for unregistered handles and
/// was only checked when exists === true — meaning any wallet could delete
/// another player's fax. @fax handles are now verified against the chain.
async function verifyOwner(local: string, wallet: string): Promise<NextResponse | null> {
  if (parseFaxHandle(local)) {
    const auth = await verifyFaxHandleOwner(local, wallet);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 403, headers: NO_STORE });
    }
    return null;
  }

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
  if (resolved.exists === false) {
    return NextResponse.json({ error: 'Mailbox does not exist.' }, { status: 404, headers: NO_STORE });
  }
  const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
  if (!controller || controller !== wallet.toLowerCase()) {
    return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
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
    const data = await res.json() as Record<string, unknown>;
    // The worker's mint record is a convenience index and is incomplete for a
    // few early mints (#1, #12, #16 had none under their display tray). The
    // chain is the authority on whether a fax was minted, so when the worker
    // says no, ask the on-chain mint list before letting the permalink show a
    // permanent collectible as jammed and fading.
    if (res.ok && !data.minted) {
      const chain = await onChainMintForTray(_req, id);
      if (chain) data.minted = { tokenId: chain.tokenId, tx: null, at: null, source: 'chain' };
    }
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502, headers: NO_STORE });
  }
}

/// trayId -> on-chain mint, from the leaderboard route (which already applies
/// the post-mint tray overrides and caches decoded logs in-process). Memoised
/// for a minute so a busy permalink does not re-fetch the whole list per view.
const mintIndex: { at: number; byTray: Map<string, { tokenId: number }> } = { at: 0, byTray: new Map() };
async function onChainMintForTray(req: NextRequest, trayId: string): Promise<{ tokenId: number } | null> {
  if (Date.now() - mintIndex.at > 60_000) {
    try {
      const origin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;
      const r = await fetch(`${origin}/api/tray/leaderboard?pageSize=2222`, { cache: 'no-store' });
      if (r.ok) {
        const { mints = [] } = await r.json() as { mints?: { tokenId: number; trayId: string }[] };
        mintIndex.byTray = new Map(mints.map((m) => [m.trayId.toLowerCase(), { tokenId: m.tokenId }]));
        mintIndex.at = Date.now();
      }
    } catch { /* keep the previous index; a stale answer beats a wrong "not minted" */ }
  }
  return mintIndex.byTray.get(trayId.toLowerCase()) ?? null;
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
