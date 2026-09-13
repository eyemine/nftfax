/// GET /api/tray/notifications?wallet=<0x...>
///
/// Cross-mailbox unread summary for a connected wallet. A player's @fax
/// identities are per-NFT, so faxes routinely land on a handle they are not
/// currently viewing and go unnoticed until the chain timer jams. This returns
/// the count of ACTIONABLE faxes per owned handle so the UI can badge them.
///
/// "Actionable" means the player can still do something about it:
///   - not yet forwarded (forwarding is what keeps the chain alive), and
///   - not jammed (the hop timer has not expired), and
///   - not private/encrypted (this app is the public chain only).
/// Already-forwarded and already-jammed faxes are deliberately excluded —
/// counting those would badge every mailbox forever and train players to
/// ignore the badge.
///
/// Ownership: the handle list is derived SERVER-SIDE from the telegraph
/// registry filtered by the connected wallet, and each handle is then verified
/// against the chain. Handles are never accepted from the client, so this
/// cannot be used to enumerate someone else's inbox — and because the registry
/// can hold a stale owner after a trade, the on-chain check is what actually
/// decides.

import { NextRequest, NextResponse } from 'next/server';
import { getChainTimerMs } from '@/app/lib/fax-credits';
import { verifyFaxHandleOwner } from '@/app/lib/fax-ownership';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const COLLECTIONS = ['chonk', 'deadfellaz', 'normie', 'pow'] as const;

interface TelegraphEntry {
  handle?: string;
  wallet?: string;
  collection?: string;
}

interface InboxFax {
  id?: string;
  createdAt?: number;
  forwarded?: boolean;
  channel?: string;
  encrypted?: boolean;
  chainDepth?: number;
  chainTimerDuration?: number;
  sourceMintedBase?: boolean;
}

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

/// Resolves which @fax handles a wallet owns, from the same telegraph registry
/// the Rolofax UI uses.
async function ownedHandles(origin: string, wallet: string): Promise<{ handle: string; collection: string }[]> {
  const results = await Promise.all(COLLECTIONS.map(async (collection) => {
    try {
      const res = await fetch(`${origin}/api/telegraph/list?collection=${collection}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json() as { items?: TelegraphEntry[] };
      return json.items ?? [];
    } catch {
      return [];
    }
  }));

  return results
    .flat()
    .filter((e): e is Required<Pick<TelegraphEntry, 'handle' | 'wallet' | 'collection'>> =>
      !!e.handle && !!e.wallet && e.wallet.toLowerCase() === wallet)
    .map((e) => ({ handle: e.handle.toLowerCase(), collection: e.collection ?? '' }));
}

export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get('wallet') || '').trim().toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  // Same-origin self-fetch: force http for the internal hop, matching the
  // other routes (nextUrl.origin can misreport https against the container's
  // plain-HTTP listener behind nginx).
  const origin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;

  try {
    const handles = await ownedHandles(origin, wallet);
    if (handles.length === 0) {
      return NextResponse.json({ total: 0, handles: [] }, { headers: NO_STORE });
    }

    const now = Date.now();

    /// Counts faxes still awaiting a forward. Reads the worker's KV only — no
    /// chain access — so this is cheap enough to run for every owned handle.
    const countActionable = async ({ handle, collection }: { handle: string; collection: string }) => {
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: workerHeaders(),
          body: JSON.stringify({ action: 'listTrayInbox', local: handle }),
          cache: 'no-store',
        });
        if (!res.ok) return { handle, collection, actionable: 0 };
        const { faxes = [] } = await res.json() as { faxes?: InboxFax[] };

        const actionable = faxes.filter((f) => {
          if (f.channel === 'private' || f.encrypted) return false;
          if (f.forwarded) return false;
          const duration = f.chainTimerDuration
            || getChainTimerMs(f.chainDepth || 1, !!f.sourceMintedBase);
          return (now - (f.createdAt ?? 0)) <= duration;
        }).length;

        return { handle, collection, actionable };
      } catch {
        return { handle, collection, actionable: 0 };
      }
    };

    // Count FIRST, verify ownership second.
    //
    // Verifying all owned handles up front meant one ownerOf() per handle, and a
    // wallet holding a dozen NFTs exhausted the public Base rate limit partway
    // through (measured: the first 5 calls succeeded, the rest errored). Because
    // the ownership check fails closed, those handles silently reported 0 —
    // hiding real waiting faxes. Counting is pure KV, so do that for everything
    // and spend on-chain calls only on the handful we would actually report.
    const counted = await Promise.all(handles.map(countActionable));
    const candidates = counted.filter((h) => h.actionable > 0);

    const withFaxes: typeof candidates = [];
    for (const candidate of candidates) {
      // Registry ownership can be stale after a trade, so the chain decides.
      const auth = await verifyFaxHandleOwner(candidate.handle, wallet);
      if (auth.authorized) withFaxes.push(candidate);
    }
    return NextResponse.json({
      total: withFaxes.reduce((sum, h) => sum + h.actionable, 0),
      handles: withFaxes,
    }, { headers: NO_STORE });
  } catch {
    // Non-fatal: a badge is cosmetic and must never break the page.
    return NextResponse.json({ total: 0, handles: [], error: 'lookup_failed' }, { headers: NO_STORE });
  }
}
