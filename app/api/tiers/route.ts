/// GET /api/tiers
///
/// Public tier supply: for each prize tier, its fixed supply, how many tokens
/// carry that tier in their on-chain metadata, what's left, and whether it is
/// minted out. The compose/forward UI uses this to warn a player before they
/// make an artwork for a hop that can no longer be minted.

import { NextResponse } from 'next/server';
import { getTierStatus } from '@/app/lib/tier-supply';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getTierStatus();
    return NextResponse.json(status, { headers: { 'Cache-Control': 'public, max-age=30' } });
  } catch {
    return NextResponse.json({ error: 'Tier supply unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
