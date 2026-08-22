/// POST /api/tray/[id]/save   { local, ownerWallet, gnosisTx?, gnosisTokenId? }
///
/// "Save to Gnosis" — the permanence verb of the chain-letter game. Rescues a
/// received fax from the 8-day Thermal-Fade decay by persisting it (removing
/// the KV TTL) and recording tray-saved:gnosis:{id}. Distinct from "Mint to
/// Base" (the tradeable collectible).
///
/// PROPAGATION GATE (fail-CLOSED): a fax can only be saved AFTER its recipient
/// has forwarded it onward (mirrors the mint gate).

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
  forwarded?: boolean;
  forwardedTrayId?: string;
  encrypted?: boolean;
  channel?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    local?: string;
    ownerWallet?: string;
    gnosisTx?: string;
    gnosisTokenId?: string | number;
  };
  const local = (body.local || '').toLowerCase().trim().replace(/@nftmail\.box$/, '');
  const wallet = (body.ownerWallet || '').trim();

  if (!id) return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  if (!local) return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  // Next.js standalone can misreport nextUrl.origin as https:// against its own
  // plain-HTTP internal listener (behind an nginx TLS-terminating proxy), which
  // breaks this same-origin self-fetch with an SSL handshake error. Force http
  // for the internal hop; only used for our own ownership-check route.
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
      return NextResponse.json({ error: 'Fax not found in your in-tray (it may have decayed).' }, { status: 404, headers: NO_STORE });
    }
    if (fax.encrypted || fax.channel === 'private') {
      return NextResponse.json({ error: 'Private (encrypted) faxes cannot be saved.' }, { status: 400, headers: NO_STORE });
    }
    if (!fax.forwarded) {
      return NextResponse.json({
        error: 'Forward this fax before saving. The chain letter must be passed on to unlock Save.',
        code: 'FORWARD_REQUIRED',
      }, { status: 403, headers: NO_STORE });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({
        action: 'saveTrayDocument',
        secret: WEBHOOK_SECRET,
        trayId: id,
        forwardedTrayId: fax.forwardedTrayId || undefined,
        local,
        gnosisTx: body.gnosisTx || null,
        gnosisTokenId: body.gnosisTokenId ?? null,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Save failed' }, { status: 502, headers: NO_STORE });
  }
}
