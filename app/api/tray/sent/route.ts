/// GET /api/tray/sent?local=<mailbox>&wallet=<0x...>
///
/// Sent-Tray gallery listing for the standalone NFTfax app. Returns light
/// metadata (NO bitmap) for every fax SENT by `local`.
///
/// Ownership is enforced fail-CLOSED: the caller's wallet must match the
/// on-chain controller of `local`.

import { NextRequest, NextResponse } from 'next/server';
import { parseFaxHandle, verifyFaxHandleOwner } from '@/app/lib/fax-ownership';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const local = (searchParams.get('local') || '').toLowerCase().trim().replace(/@nftmail\.box$/, '').replace(/@fax$/, '');
  const wallet = (searchParams.get('wallet') || '').trim();

  if (!local) {
    return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  }
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;

  try {
    // @fax handles are NFT-backed: verify on-chain ownership, not the worker's
    // KV registry. resolveAddress returns { exists: false } for unregistered
    // handles and the old code only checked when exists === true, leaving most
    // fax mailboxes readable by any wallet.
    if (parseFaxHandle(local)) {
      const auth = await verifyFaxHandleOwner(local, wallet);
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 403, headers: NO_STORE });
      }
    } else {
      const resolveRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'resolveAddress', name: local }),
        cache: 'no-store',
      });
      if (!resolveRes.ok) {
        return NextResponse.json({ error: 'Could not verify mailbox ownership. Try again.' }, { status: 503, headers: NO_STORE });
      }
      const resolved = await resolveRes.json() as Record<string, unknown>;
      if (resolved.exists === false) {
        return NextResponse.json({ error: 'Mailbox does not exist.' }, { status: 404, headers: NO_STORE });
      }
      const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
      if (!controller || controller !== wallet.toLowerCase()) {
        return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
      }
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'listTraySent', local }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Sent tray lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
