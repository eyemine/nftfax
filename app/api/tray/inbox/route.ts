/// GET /api/tray/inbox?local=<mailbox>&wallet=<0x...>
///
/// In-Tray gallery listing for the standalone NFTfax app. Returns light
/// metadata (NO bitmap) for every fax received by `local`, enriched with the
/// chain-letter game flags (forwarded / mintedBase / savedGnosis).
///
/// Ownership is enforced fail-CLOSED: the caller's wallet must match the
/// on-chain controller of `local`, otherwise a wallet could enumerate someone
/// else's received-fax metadata.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const local = (searchParams.get('local') || '').toLowerCase().trim().replace(/@nftmail\.box$/, '');
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
    if (resolved.exists === false && !resolved.sovereign) {
      return NextResponse.json({ error: 'Mailbox does not exist.' }, { status: 404, headers: NO_STORE });
    }
    if (resolved.exists === true) {
      const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
      if (!controller) {
        return NextResponse.json({
          error: 'Ownership could not be verified. Connect the wallet that controls this mailbox.',
        }, { status: 403, headers: NO_STORE });
      }
      if (controller !== wallet.toLowerCase()) {
        return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
      }
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'listTrayInbox', local }),
      cache: 'no-store',
    });
    const data = await res.json() as { faxes?: Array<{ channel?: string; encrypted?: boolean }> };

    // Standalone app is PUBLIC chain-letter only — filter out any private/encrypted faxes.
    if (Array.isArray(data.faxes)) {
      data.faxes = data.faxes.filter((f) => f.channel !== 'private' && !f.encrypted);
    }

    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Inbox lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
