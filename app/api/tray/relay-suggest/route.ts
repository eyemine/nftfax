/// GET /api/tray/relay-suggest?chainTrayId=<id>&excludeRecipient=<handle>&excludeSender=<handle>
///
/// Returns ready Rolofax participants for re-routing, excluding existing
/// chain participants. Public read (no wallet verification needed — the
/// Rolofax is a public directory).

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chainTrayId = (searchParams.get('chainTrayId') || '').trim();
  const excludeRecipient = (searchParams.get('excludeRecipient') || '').toLowerCase().trim();
  const excludeSender = (searchParams.get('excludeSender') || '').toLowerCase().trim();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'getRelaySuggestion',
        chainTrayId,
        excludeRecipient,
        excludeSender,
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Relay suggestion lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
