import { after, NextRequest, NextResponse } from 'next/server';
import { describeKiosk, kioskCheckUrl, listKiosks, LOW_BATTERY, pingCheck, recordKiosk } from '../../../lib/exhibit-health';

/// Kiosk heartbeat for the exhibit displays.
///
///   POST ?key=K  { id, battery, charging, wifiSsid, wifiSignal, screenOn, fully, agent, page }   (the kiosk, every 60 s)
///   GET  ?key=K                                                                                    (the status page)
///
/// Same key as the print queue (EXHIBIT_PRINT_KEY): the kiosk already carries
/// it in its /exhibit?key=… URL. Each heartbeat is forwarded to the kiosk's
/// healthchecks.io check (see app/lib/exhibit-health.ts).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = process.env.EXHIBIT_PRINT_KEY || '';
function authed(req: NextRequest) {
  const k = req.nextUrl.searchParams.get('key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return KEY.length > 0 && k === KEY;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'bad json' }, { status: 400 });
  const report = recordKiosk(String(body.id || ''), body);
  if (!report) return NextResponse.json({ error: 'bad or unknown kiosk id' }, { status: 400 });
  const low = report.battery !== null && report.battery <= LOW_BATTERY && report.charging !== true;
  const note = `${describeKiosk(report)}${low ? ` · LOW BATTERY (≤${LOW_BATTERY}%, not charging)` : ''}`;
  after(() => pingCheck(kioskCheckUrl(report.id), !low, note));
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ kiosks: listKiosks(), lowBattery: LOW_BATTERY }, { headers: { 'Cache-Control': 'no-store' } });
}
