import { NextRequest, NextResponse } from 'next/server';
import { exhibitFeed } from '../../../lib/exhibit-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = params.get('source') || '';
  const limit = Number(params.get('limit') || 20);
  return NextResponse.json({ notes: exhibitFeed(source, limit) }, { headers: { 'Cache-Control': 'no-store' } });
}
