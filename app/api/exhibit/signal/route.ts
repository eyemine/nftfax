import { NextRequest, NextResponse } from 'next/server';
import { waitForExhibitSignal } from '../../../lib/exhibit-signal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const since = Math.max(0, Math.floor(Number(params.get('since') || 0)));
  const wait = Math.min(25, Math.max(0, Number(params.get('wait') || 0))) * 1000;
  const signal = await waitForExhibitSignal(since, wait);
  return NextResponse.json({ signal }, { headers: { 'Cache-Control': 'no-store' } });
}
