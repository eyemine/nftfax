/// POST /api/tray/[id]/reroute
///
/// Re-route a sent fax to a new recipient after 24h with no forward from
/// the original recipient. The sender stays in control of the chain.
///
/// Body: { fromLabel, ownerWallet, to, dataBase64?, chainTrayId }
///   - fromLabel: sender's mailbox (must control the original fax)
///   - ownerWallet: sender's wallet (verified against on-chain owner)
///   - to: new recipient address
///   - dataBase64: optional new image to composite (if omitted, forwards
///     the original fax bitmap unchanged)
///   - chainTrayId: the original fax ID being re-routed
///
/// After the new send succeeds, calls markRerouted on the original tray
/// to disable mint for the original recipient.

import { NextRequest, NextResponse } from 'next/server';
import { transferForwardCredit, getChainTimerMs } from '@/app/lib/fax-credits';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const RELAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h before re-route is allowed

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: originalTrayId } = await params;

  try {
    const body = await req.json() as {
      fromLabel?: string;
      ownerWallet?: string;
      to?: string;
      dataBase64?: string;
      chainTrayId?: string;
    };

    let fromLabel = (body.fromLabel || '').toLowerCase().trim();
    const ownerWallet = (body.ownerWallet || '').toLowerCase().trim();
    const to = (body.to || '').toLowerCase().trim();
    const chainTrayId = (body.chainTrayId || originalTrayId).trim();

    let fromDomain = 'nftmail.box';
    const parts = fromLabel.split('@');
    if (parts.length > 1) {
      fromLabel = parts[0];
      fromDomain = parts.slice(1).join('@');
    }
    const isFaxSender = fromDomain === 'fax';

    if (!fromLabel || !ownerWallet || !to) {
      return NextResponse.json({ error: 'Missing fromLabel, ownerWallet, or to' }, { status: 400, headers: NO_STORE });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400, headers: NO_STORE });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;

    const docRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'getTrayDocument', id: originalTrayId, secret: WEBHOOK_SECRET }),
      cache: 'no-store',
    });
    if (!docRes.ok) {
      return NextResponse.json({ error: 'Original fax not found or already decayed' }, { status: 404, headers: NO_STORE });
    }
    const doc = await docRes.json() as Record<string, unknown>;
    const docFrom = ((doc.from as string) || '').toLowerCase().trim();
    const fromAddress = `${fromLabel}@${fromDomain}`;

    if (docFrom !== fromAddress && docFrom !== fromLabel) {
      return NextResponse.json({ error: 'Only the original sender can re-route this fax' }, { status: 403, headers: NO_STORE });
    }

    // @fax senders are rolofax handles without on-chain ownership; skip resolve.
    if (!isFaxSender) {
      const resolveRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'resolveAddress', name: fromLabel, domain: fromDomain }),
        cache: 'no-store',
      });
      if (!resolveRes.ok) {
        return NextResponse.json({ error: 'Could not verify sender ownership' }, { status: 503, headers: NO_STORE });
      }
      const resolved = await resolveRes.json() as Record<string, unknown>;
      if (resolved.exists === false) {
        return NextResponse.json({ error: 'Sender mailbox does not exist' }, { status: 404, headers: NO_STORE });
      }
      const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
      if (!controller || controller !== ownerWallet) {
        return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
      }
    }

    const createdAt = Number(doc.createdAt) || 0;
    const elapsed = Date.now() - createdAt;
    if (elapsed < RELAY_WINDOW_MS) {
      const remainingMs = RELAY_WINDOW_MS - elapsed;
      const remainingH = Math.ceil(remainingMs / (60 * 60 * 1000));
      return NextResponse.json({
        error: `Re-route available in ${remainingH}h. The relay window opens 24h after sending.`,
      }, { status: 409, headers: NO_STORE });
    }

    const reroutedAt = doc.reroutedAt as number | undefined;
    if (reroutedAt) {
      return NextResponse.json({
        error: 'This fax has already been re-routed.',
      }, { status: 409, headers: NO_STORE });
    }

    const sourceChainDepth = Number(doc.chainDepth) || 0;
    const sourceMintedBase = Boolean(doc.sourceMintedBase);
    const nextHop = sourceChainDepth + 1;
    const chainTimerDuration = getChainTimerMs(nextHop, sourceMintedBase);

    const trayPayload: Record<string, unknown> = {
      action: 'setTrayDocument',
      secret: WEBHOOK_SECRET,
      from: fromAddress,
      to,
      format: 'png',
      isMultipage: false,
      colorMode: 'greyscale',
      channel: 'public',
      chainTrayId,
      chainDepth: nextHop,
      chainTimerDuration,
    };

    // Re-route is a forward: the sender spends a credit and the new recipient
    // is credited for hops 1-5.
    try {
      await transferForwardCredit(fromLabel, to.split('@')[0], ownerWallet, nextHop);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Credit transfer failed';
      return NextResponse.json({ error: message }, { status: 402, headers: NO_STORE });
    }

    if (body.dataBase64) {
      trayPayload.dataBase64 = body.dataBase64;
    } else if (doc.dataBase64) {
      trayPayload.dataBase64 = doc.dataBase64;
    } else {
      return NextResponse.json({ error: 'No image data available to re-route' }, { status: 400, headers: NO_STORE });
    }

    const setRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(trayPayload),
    });

    const rawSet = await setRes.text();
    let setData: { id?: string; trayUrl?: string; error?: string };
    try {
      setData = JSON.parse(rawSet) as { id?: string; trayUrl?: string; error?: string };
    } catch {
      return NextResponse.json({
        error: `Re-route relay error (worker returned ${setRes.status}). Please try again shortly.`,
      }, { status: 502, headers: NO_STORE });
    }

    if (!setRes.ok) {
      return NextResponse.json({ error: setData.error || 'Failed to re-route fax' }, { status: setRes.status, headers: NO_STORE });
    }

    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'markRerouted',
          secret: WEBHOOK_SECRET,
          trayId: originalTrayId,
          newRecipient: to,
        }),
      });
    } catch { /* non-fatal — the new fax is already sent */ }

    return NextResponse.json({
      success: true,
      id: setData.id,
      trayUrl: setData.trayUrl,
      reroutedFrom: originalTrayId,
      newRecipient: to,
    }, { status: 200, headers: NO_STORE });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Re-route failed';
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
