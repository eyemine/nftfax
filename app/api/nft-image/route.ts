/// Resolves a single ERC-721 token's static preview image URL.
///
/// Thin wrapper around app/lib/nft-metadata.ts's cached resolver — see that
/// file for the tokenURI -> metadata -> image pipeline and caching notes.
/// Returns the raw image URL only; the browser loads the actual image
/// bytes directly from IPFS/HTTP, so this route never proxies image data.

import { NextRequest, NextResponse } from 'next/server';
import { resolveNftImage } from '../../lib/nft-metadata';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contract = searchParams.get('contract');
  const chainIdRaw = searchParams.get('chainId');
  const tokenIdRaw = searchParams.get('tokenId');
  const rpc = searchParams.get('rpc') || undefined;

  const chainId = Number(chainIdRaw);
  const tokenId = Number(tokenIdRaw);
  if (!contract || !Number.isFinite(chainId) || !Number.isFinite(tokenId)) {
    return NextResponse.json({ error: 'Missing or invalid contract, chainId, or tokenId' }, { status: 400, headers: NO_STORE });
  }

  const image = await resolveNftImage(contract, chainId, tokenId, rpc);
  return NextResponse.json({ image }, { headers: NO_STORE });
}
