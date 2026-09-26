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
///
/// CACHING. Artwork is immutable once minted, and resolving it is expensive:
/// the metadata route touches the chain and the worker. The exhibit requests a
/// dozen-plus thumbnails at once, and under that burst the public Base RPC
/// throttled and most of them broke. Decoded bytes are therefore memoised
/// in-process by token id — the first successful resolution serves every
/// later request from memory. Failures are never cached, and a failed lookup
/// is retried once before giving up, so a transient upstream blip does not
/// become a permanently blank tile.

import { NextRequest, NextResponse } from 'next/server';

interface CachedImage { body: Buffer; type: string }
const MAX_CACHED = 400;
const imageCache = new Map<number, CachedImage>();

function remember(tokenId: number, img: CachedImage) {
  if (imageCache.size >= MAX_CACHED) {
    // Map iterates in insertion order; drop the oldest.
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(tokenId, img);
}

const HEADERS = (type: string) => ({
  'Content-Type': type,
  // Immutable once minted; let browsers and Cloudflare cache it.
  'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
});

async function resolve(origin: string, tokenId: number): Promise<{ img?: CachedImage; redirect?: string; status: number }> {
  const res = await fetch(`${origin}/api/metadata/${tokenId}`, { cache: 'no-store' });
  if (!res.ok) return { status: res.status };
  const meta = await res.json() as { image?: string };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(meta.image || '');
  if (m) return { img: { body: Buffer.from(m[2], 'base64'), type: m[1] }, status: 200 };
  if (meta.image) return { redirect: meta.image, status: 302 };
  return { status: 404 };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId: raw } = await params;
  if (!/^\d+$/.test(raw)) return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
  const tokenId = Number(raw);

  const hit = imageCache.get(tokenId);
  if (hit) return new NextResponse(new Uint8Array(hit.body), { headers: { ...HEADERS(hit.type), 'X-Cache': 'HIT' } });

  const origin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;
  let out = await resolve(origin, tokenId);
  if (!out.img && !out.redirect && out.status !== 404) {
    // Transient upstream failure (RPC throttle, worker hiccup): one retry.
    await new Promise((r) => setTimeout(r, 400));
    out = await resolve(origin, tokenId);
  }

  if (out.img) {
    remember(tokenId, out.img);
    return new NextResponse(new Uint8Array(out.img.body), { headers: { ...HEADERS(out.img.type), 'X-Cache': 'MISS' } });
  }
  if (out.redirect) return NextResponse.redirect(out.redirect, 302);
  // Do not let a browser cache a failure — the next request should try again.
  return NextResponse.json(
    { error: out.status === 404 ? 'No image' : 'Metadata unavailable' },
    { status: out.status === 404 ? 404 : 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } },
  );
}
