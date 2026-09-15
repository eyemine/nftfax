/// Batch ENS reverse-resolution for client components (e.g. the rolofax
/// entries list) that only have raw wallet addresses. Thin wrapper around
/// app/lib/ens.ts's in-process cache — see that file for caching/perf notes.

import { NextRequest, NextResponse } from 'next/server';
import { resolveEnsAddress, resolveEnsNames } from '../../lib/ens';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const MAX_ADDRESSES = 100;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { addresses?: unknown } | null;
    const addresses = Array.isArray(body?.addresses)
      ? body.addresses.filter((a): a is string => typeof a === 'string').slice(0, MAX_ADDRESSES)
      : [];
    if (addresses.length === 0) {
      return NextResponse.json({ names: {} }, { headers: NO_STORE });
    }
    const resolved = await resolveEnsNames(addresses);
    const names: Record<string, string> = {};
    resolved.forEach((name, addr) => { names[addr] = name; });
    return NextResponse.json({ names }, { headers: NO_STORE });
  } catch (cause) {
    console.error('[ens] batch resolve failed', cause);
    return NextResponse.json({ names: {} }, { status: 502, headers: NO_STORE });
  }
}

/// GET /api/ens?name=vitalik.eth — forward resolution for a single name.
///
/// Used by the delegate panel so a player can enter an ENS name as the hot
/// wallet. Resolution happens server-side: the browser has no mainnet RPC, and
/// the in-process cache is shared with every other caller.
export async function GET(req: NextRequest) {
  const name = new URL(req.url).searchParams.get('name') || '';
  if (!name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400, headers: NO_STORE });
  }
  const address = await resolveEnsAddress(name);
  return NextResponse.json({ name: name.trim().toLowerCase(), address }, { headers: NO_STORE });
}
