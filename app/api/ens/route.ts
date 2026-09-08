/// Batch ENS reverse-resolution for client components (e.g. the rolofax
/// entries list) that only have raw wallet addresses. Thin wrapper around
/// app/lib/ens.ts's in-process cache — see that file for caching/perf notes.

import { NextRequest, NextResponse } from 'next/server';
import { resolveEnsNames } from '../../lib/ens';

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
