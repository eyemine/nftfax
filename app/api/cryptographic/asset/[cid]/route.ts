import { NextResponse } from 'next/server';

/// Same-origin proxy for Cryptographic asset blocks. On the Hetzner host the
/// nftfax container shares the ipfs-archive Docker network and reaches the
/// kubo gateway at http://ipfs-archive:8080 — the same node that durably pins
/// the whole collection. Local dev falls back to a public gateway.
const GATEWAY = (process.env.CRYPTO_IPFS_GATEWAY || 'https://ipfs.io').replace(/\/$/, '');

// CIDv0 (base58btc Qm…) and CIDv1 (base32 b…) are alphanumeric; the character
// whitelist also blocks path tricks, keeping this a CID-only fetcher.
const CID_RE = /^[a-zA-Z0-9]{20,120}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!CID_RE.test(cid)) return NextResponse.json({ error: 'Invalid CID.' }, { status: 400 });
  try {
    const upstream = await fetch(`${GATEWAY}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
    }
    // CIDs are content-addressed — the bytes can never change, cache forever.
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': (() => { const t = upstream.headers.get('content-type'); return t && t !== 'application/octet-stream' ? t : 'image/png'; })(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'IPFS gateway unavailable.' }, { status: 502 });
  }
}
