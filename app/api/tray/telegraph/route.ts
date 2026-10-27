/// Proxies the worker's getTelegraphLog filtered to NFTfax (@fax) addresses only.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/// `?offset=&limit=` page the `recent` list (newest first, limit ≤ 100).
export async function GET(req: NextRequest) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
    const { searchParams } = req.nextUrl;
    const recentOffset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
    const recentLimit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '24', 10) || 24));
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'getTelegraphLog', domainFilter: 'fax', recentOffset, recentLimit }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Telegraph lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
