/// GET /api/fax-owner?handle=chonk.681 — the wallet holding an @fax identity.
///
/// Used by the Send and Forward destination fields so the player can see which
/// wallet a fax is about to go to, not just the handle. Public read; the owner
/// of an NFT is public on-chain data.

import { NextRequest, NextResponse } from 'next/server';
import { resolveFaxHandleOwner } from '@/app/lib/fax-ownership';
import { resolveEnsNames } from '@/app/lib/ens';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const handle = (new URL(req.url).searchParams.get('handle') || '').trim().toLowerCase().replace(/@fax$/, '');
  if (!handle) return NextResponse.json({ error: 'Missing handle' }, { status: 400, headers: NO_STORE });

  const resolved = await resolveFaxHandleOwner(handle);
  if (!resolved) return NextResponse.json({ handle, owner: null, ens: null }, { headers: NO_STORE });

  const names = await resolveEnsNames([resolved.owner]);
  return NextResponse.json({
    handle,
    owner: resolved.owner,
    ens: names.get(resolved.owner) ?? null,
    collection: resolved.collection,
    tokenId: resolved.tokenId,
  }, { headers: NO_STORE });
}
