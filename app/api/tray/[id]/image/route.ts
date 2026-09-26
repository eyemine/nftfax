/// GET /api/tray/[id]/image — a public fax's bitmap as bytes.
///
/// The tray document carries its image as base64 inside JSON, which is right
/// for the permalink page but wrong for a grid: the exhibit shows a row of
/// recent public transmissions and needs a URL per fax that next/image can
/// resize. This serves the bitmap directly, memoised in-process — a fax's
/// pixels never change after it is sent, even though the document itself
/// decays after eight days.
///
/// Public faxes only. Encrypted/private documents return 404 with no bytes.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

interface CachedImage { body: Buffer; type: string }
const MAX_CACHED = 400;
const cache = new Map<string, CachedImage>();

function remember(id: string, img: CachedImage) {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, img);
}

const HEADERS = (type: string) => ({
  'Content-Type': type,
  'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{6,32}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const key = id.toLowerCase();

  const hit = cache.get(key);
  if (hit) return new NextResponse(new Uint8Array(hit.body), { headers: { ...HEADERS(hit.type), 'X-Cache': 'HIT' } });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
    const res = await fetch(WORKER_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'getTrayDocument', id: key, secret: WEBHOOK_SECRET }),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'Fax not found' }, { status: res.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'no-store' } });
    const doc = await res.json() as { dataBase64?: string; format?: string; encrypted?: boolean };
    if (doc.encrypted || !doc.dataBase64) return NextResponse.json({ error: 'No public image' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const img: CachedImage = { body: Buffer.from(doc.dataBase64, 'base64'), type: doc.format === 'png' ? 'image/png' : 'image/jpeg' };
    remember(key, img);
    return new NextResponse(new Uint8Array(img.body), { headers: { ...HEADERS(img.type), 'X-Cache': 'MISS' } });
  } catch {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
  }
}
