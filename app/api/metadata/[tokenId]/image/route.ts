/// GET /api/metadata/[tokenId]/image — the FAX CHAIN token's artwork as bytes.
///
/// The metadata route returns the image as a data: URI, which is right for
/// tokenURI consumers but ~900KB per token — far too heavy to embed in list
/// responses such as the backpack viewer. This serves the same pixels as a
/// plain image so lists can carry a URL and the browser can lazy-load.
///
/// Exists because Alchemy's NFT cache went stale for this contract after every
/// token URI was rewritten (the FAX CHAIN #N rename), leaving backpack entries
/// with no image. We own the contract; our own metadata is authoritative, so
/// the viewer should never depend on a third-party index for it.

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
  }

  const origin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;
  const res = await fetch(`${origin}/api/metadata/${tokenId}`, { cache: 'no-store' });
  if (!res.ok) {
    return NextResponse.json({ error: 'Metadata unavailable' }, { status: res.status });
  }
  const meta = await res.json() as { image?: string };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(meta.image || '');
  if (!m) {
    // An http(s)/ipfs image: hand the browser the URL rather than proxying.
    if (meta.image) return NextResponse.redirect(meta.image, 302);
    return NextResponse.json({ error: 'No image' }, { status: 404 });
  }

  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: {
      'Content-Type': m[1],
      // Artwork is immutable once minted; let browsers and Cloudflare cache it.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
    },
  });
}
