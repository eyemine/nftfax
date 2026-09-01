/// POST /api/tray/send
///
/// Standalone nftfax send route — public chain only (no encryption).
/// Proxies to the worker's setTrayDocument action and runs the v2 credit
/// economy: every forward spends one sender credit and credits the recipient
/// for hops 1-5; hop 6+ forwards do not credit the recipient.
///
/// Body: { fromLabel, fromDomain, ownerWallet, to, format, dataBase64,
///   chainTrayId?, sourceChainDepth?, sourceMintedBase?, collection? }

import { NextRequest, NextResponse } from 'next/server';
import { transferForwardCredit, getChainTimerMs } from '@/app/lib/fax-credits';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const MAX_SOURCE_BASE64_LENGTH = 28_000_000;
const ALLOWED_FORMATS = new Set(['png', 'bmp', 'jpg']);

function matchesFormat(base64: string, format: string): boolean {
  try {
    const header = Buffer.from(base64.slice(0, 24), 'base64');
    if (format === 'png') {
      return header.length >= 8 &&
        header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    }
    if (format === 'bmp') {
      return header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d;
    }
    if (format === 'jpg') {
      return header.length >= 3 &&
        header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    return false;
  } catch {
    return false;
  }
}

async function getChainDocument(id: string): Promise<{ dataBase64: string; from: string; to?: string; chainDepth?: number; chainTimerDuration?: number; sourceMintedBase?: boolean } | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
    if (WEBHOOK_SECRET) headers['X-Webhook-Secret'] = WEBHOOK_SECRET;
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'getTrayDocument', id, secret: WEBHOOK_SECRET }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as { dataBase64: string; from: string; to?: string };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      fromLabel?: string;
      ownerWallet?: string;
      to?: string;
      format?: string;
      dataBase64?: string;
      chainTrayId?: string;
      colorMode?: 'greyscale' | '256';
      fromDomain?: string;
      collection?: string;
      sourceChainDepth?: number;
      sourceMintedBase?: boolean;
    };

    let { fromLabel, ownerWallet, to, format, dataBase64, chainTrayId } = body;
    let fromDomain = (body.fromDomain || '').toLowerCase().trim();
    if (fromLabel) {
      const parts = fromLabel.toLowerCase().trim().split('@');
      if (parts.length > 1) {
        fromLabel = parts[0];
        if (!fromDomain) fromDomain = parts[1];
      }
    }
    if (!fromDomain) fromDomain = 'nftmail.box';
    const isFaxSender = fromDomain === 'fax';

    if (!fromLabel) {
      return NextResponse.json({ error: 'Missing fromLabel' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!to || !to.includes('@')) {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }

    let isForward = false;
    let rawDataBase64: string | undefined;
    let chain: { dataBase64: string; from: string; to?: string; chainDepth?: number; sourceMintedBase?: boolean } | null = null;

    if (chainTrayId) {
      chain = await getChainDocument(chainTrayId);
      if (!chain || !chain.dataBase64) {
        return NextResponse.json({ error: 'Chain tray not found' }, { status: 404 });
      }
      if (!chain.to) {
        return NextResponse.json({ error: 'Could not verify chain ownership. Try again.' }, { status: 502 });
      }
      const chainToLocal = chain.to.split('@')[0].toLowerCase();
      if (chainToLocal !== fromLabel.toLowerCase()) {
        return NextResponse.json({ error: 'You can only forward faxes sent to you' }, { status: 403 });
      }
      isForward = true;
      rawDataBase64 = dataBase64 || chain.dataBase64;
    } else {
      const normFormat = (format || '').toLowerCase() === 'jpeg' ? 'jpg' : (format || '').toLowerCase();
      if (!normFormat || !ALLOWED_FORMATS.has(normFormat)) {
        return NextResponse.json({ error: 'Only PNG, JPG, or BMP formats are permitted' }, { status: 400 });
      }
      if (!dataBase64) {
        return NextResponse.json({ error: 'Missing dataBase64 or chainTrayId' }, { status: 400 });
      }
      if (dataBase64.length > MAX_SOURCE_BASE64_LENGTH) {
        return NextResponse.json({ error: 'Source image too large (max ~20MB)' }, { status: 413 });
      }
      if (!matchesFormat(dataBase64, normFormat)) {
        return NextResponse.json({ error: 'File content does not match declared format' }, { status: 400 });
      }
      rawDataBase64 = dataBase64;
    }

    // @fax senders skip on-chain ownership verification (rolofax registered handles)
    if (!isFaxSender) {
      const resolveRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({ action: 'resolveAddress', name: fromLabel, domain: fromDomain }),
      });
      if (!resolveRes.ok) {
        return NextResponse.json({ error: 'Could not verify sender ownership. Try again.' }, { status: 503 });
      }
      const resolved = await resolveRes.json() as Record<string, unknown>;
      if (resolved.exists === false) {
        return NextResponse.json({ error: 'Sender mailbox does not exist.' }, { status: 404 });
      }
      const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
      if (!controller) {
        return NextResponse.json({
          error: 'Sender ownership could not be verified. Connect the wallet that controls this mailbox.',
        }, { status: 403 });
      }
      if (controller !== ownerWallet.toLowerCase()) {
        return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403 });
      }
    }

    const fromEmail = `${fromLabel}@${fromDomain}`;

    // Determine the next hop's depth and timer for the v2 chain-letter economy.
    const sourceChainDepth = isForward
      ? (body.sourceChainDepth ?? chain?.chainDepth ?? 0)
      : 0;
    const sourceMintedBase = isForward
      ? (body.sourceMintedBase ?? chain?.sourceMintedBase ?? false)
      : false;
    const nextHop = isForward ? sourceChainDepth + 1 : 1;
    const chainTimerDuration = getChainTimerMs(nextHop, sourceMintedBase);
    const toLocal = (to || '').split('@')[0].toLowerCase();

    // Every relay spends one credit from the sender and, for hops 1-5, credits
    // the recipient. If the sender has no credits, the chain cannot continue.
    if (nextHop <= 11) {
      try {
        await transferForwardCredit(fromLabel, toLocal, ownerWallet, nextHop);
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : 'Credit transfer failed';
        return NextResponse.json({ error: message }, { status: 402 });
      }
    }

    // Detect the actual image format from magic bytes when the client doesn't
    // explicitly declare one (e.g. bare chain forwards with no composite).
    let resolvedFormat = (format || '').toLowerCase() === 'jpeg' ? 'jpg' : (format || '').toLowerCase();
    if (!resolvedFormat && rawDataBase64) {
      try {
        const hdr = Buffer.from(rawDataBase64.slice(0, 24), 'base64');
        if (hdr[0] === 0x89 && hdr[1] === 0x50) resolvedFormat = 'png';
        else if (hdr[0] === 0xff && hdr[1] === 0xd8) resolvedFormat = 'jpg';
        else if (hdr[0] === 0x42 && hdr[1] === 0x4d) resolvedFormat = 'bmp';
      } catch { /* fall through */ }
    }
    if (!resolvedFormat) resolvedFormat = 'png';

    const trayPayload: Record<string, unknown> = {
      action: 'setTrayDocument',
      secret: WEBHOOK_SECRET,
      from: fromEmail,
      to,
      format: resolvedFormat,
      colorMode: body.colorMode || 'greyscale',
      channel: 'public',
      dataBase64: rawDataBase64,
      chainDepth: nextHop,
      chainTimerDuration,
    };
    if (chainTrayId) {
      trayPayload.chainTrayId = chainTrayId;
    }

    const setRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify(trayPayload),
    });

    const rawSet = await setRes.text();
    let data: { id?: string; trayUrl?: string; error?: string };
    try {
      data = JSON.parse(rawSet) as { id?: string; trayUrl?: string; error?: string };
    } catch {
      return NextResponse.json({
        error: `Transmission relay error (worker returned ${setRes.status}). Please try again shortly.`,
      }, { status: 502 });
    }
    if (!setRes.ok) {
      return NextResponse.json({ error: data.error || 'Failed to store document' }, { status: setRes.status });
    }

    // Chain-letter game: mark the source fax as forwarded
    if (isForward && chainTrayId) {
      try {
        await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
          body: JSON.stringify({ action: 'markTrayForwarded', secret: WEBHOOK_SECRET, trayId: chainTrayId, forwardedTrayId: data.id }),
        });
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, id: data.id, trayUrl: data.trayUrl, isForward, channel: 'public' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transmission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
