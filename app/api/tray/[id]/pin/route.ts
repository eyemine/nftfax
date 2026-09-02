/// POST /api/tray/[id]/pin   { local?: string }
///
/// Pins a fax's image + ERC-721 metadata JSON to IPFS via Pinata, ahead of a
/// V2 mint (mintFaxOnChainWithURI / mintFaxDirectWithURI). Returns the
/// resulting `ipfs://<cid>` metadata URI to pass as the on-chain tokenURI.
///
/// Also attempts a secondary permanent backup to Arweave via Irys (fire-and-
/// forget, non-fatal). The Arweave `ar://<txId>` URI is returned as
/// `arweaveURI` in the response but is NOT used as the on-chain tokenURI —
/// IPFS stays primary. If Pinata ever goes down, you can call
/// `setTokenURI(tokenId, ar://<txId>)` on the V2 contract to switch.
///
/// Non-fatal by design: if Pinata is unconfigured or a pin fails, returns
/// `{ tokenURI: null }` (200 OK) rather than an error — the frontend falls
/// back to minting without a per-token URI (V2's tokenURI() falls back to
/// baseURI + tokenId in that case). Minting must never be blocked by an
/// IPFS outage.

import { NextRequest, NextResponse } from 'next/server';
import { pinImageToIPFS, pinJSONToIPFS } from '../../../../lib/pinata';
import { uploadImageToArweave, uploadJSONToArweave, arweaveTxIdToURI } from '../../../../lib/irys';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/// Tier names based on chain depth (hop count), matching CHAIN_GAME_DESIGN
/// and the existing /api/metadata/[tokenId] route.
const TIERS: { depth: number; name: string }[] = [
  { depth: 1, name: 'Dial Tone' },
  { depth: 2, name: 'Hop 2' },
  { depth: 3, name: 'Hop 3' },
  { depth: 4, name: 'Hop 4' },
  { depth: 5, name: 'Hop 5' },
  { depth: 6, name: 'Hop 6' },
  { depth: 7, name: 'Hop 7' },
  { depth: 8, name: 'Hop 8' },
  { depth: 9, name: 'Hop 9' },
  { depth: 10, name: 'Hop 10' },
  { depth: 11, name: 'Dead Letter' },
];

function tierForDepth(depth: number): string {
  if (depth < 1) return 'Dial Tone';
  if (depth >= 11) return 'Dead Letter';
  return TIERS[depth - 1]?.name ?? 'Dead Letter';
}

interface TrayDoc {
  dataBase64?: string;
  format?: string;
  chainDepth?: number;
}

const PREFIX_TO_COLLECTION_NAME: Record<string, string> = {
  chonk: 'Chonks',
  dfz: 'Deadfellaz',
  normie: 'Normies',
  atom: 'POW NFT',
};

function collectionNameFromLocal(local: string): string {
  const prefix = local.split('.')[0]?.toLowerCase() ?? '';
  return PREFIX_TO_COLLECTION_NAME[prefix] ?? 'Unknown';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { local?: string };
  const local = (body.local || '').trim();
  const collectionName = collectionNameFromLocal(local);

  if (!id) {
    return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  }

  try {
    const internalOrigin = `http://${req.nextUrl.hostname}:${req.nextUrl.port || process.env.PORT || 3000}`;
    const docRes = await fetch(`${internalOrigin}/api/tray/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!docRes.ok) {
      return NextResponse.json({ tokenURI: null, reason: 'tray_not_found' }, { status: 200, headers: NO_STORE });
    }
    const doc = await docRes.json() as TrayDoc;
    if (!doc.dataBase64) {
      return NextResponse.json({ tokenURI: null, reason: 'no_image' }, { status: 200, headers: NO_STORE });
    }

    const format = doc.format === 'png' ? 'png' : 'jpeg';
    const dataUri = `data:image/${format};base64,${doc.dataBase64}`;
    const chainDepth = typeof doc.chainDepth === 'number' ? doc.chainDepth : null;
    // Worker counts the initial send as depth 1, but the first send is not a hop.
    // First forward = hop 1 (Dial Tone). Subtract 1 to get actual hop count.
    const hopCount = chainDepth != null ? Math.max(0, chainDepth - 1) : null;
    const tier = hopCount != null ? tierForDepth(hopCount) : 'Dial Tone';

    const imageUri = await pinImageToIPFS(dataUri, format, `fax-${id}`);
    if (!imageUri) {
      return NextResponse.json({ tokenURI: null, reason: 'image_pin_failed' }, { status: 200, headers: NO_STORE });
    }

    const metadata = {
      name: `FAX CHAIN`,
      description: `NFTFax Collectible — minted from ${local || 'a fax mailbox'} (fax ${id}). A chain-letter fax machine collectible on Base.`,
      image: imageUri,
      external_url: `https://nftmail.box/tray/${id}`,
      attributes: [
        { trait_type: 'Tier', value: tier },
        ...(hopCount != null ? [{ trait_type: 'Chain Depth', value: hopCount }] : []),
        { trait_type: 'Fax Tray ID', value: id },
        ...(local ? [{ trait_type: 'Minting Collection', value: collectionName }] : []),
        ...(local ? [{ trait_type: 'Minting Token ID', value: local }] : []),
      ],
    };

    const metadataUri = await pinJSONToIPFS(metadata, `fax-metadata-${id}`);
    if (!metadataUri) {
      return NextResponse.json({ tokenURI: null, reason: 'metadata_pin_failed' }, { status: 200, headers: NO_STORE });
    }

    // Belt-and-suspenders: also store permanently on Arweave (non-fatal).
    // IPFS stays the primary tokenURI; Arweave is a backup you can switch to
    // via setTokenURI(tokenId, ar://<txId>) if Pinata ever goes down.
    let arweaveURI: string | null = null;
    try {
      const imageBuffer = Buffer.from(doc.dataBase64, 'base64');
      const [arweaveImage, arweaveMeta] = await Promise.all([
        uploadImageToArweave(imageBuffer),
        uploadJSONToArweave(metadata),
      ]);
      if (arweaveMeta) {
        arweaveURI = arweaveTxIdToURI(arweaveMeta.id);
        console.log(`[pin] Arweave backup stored: ${arweaveURI}`);
      }
    } catch {
      // Arweave is best-effort; never block the response on it.
    }

    return NextResponse.json({ tokenURI: metadataUri, imageUri, arweaveURI }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ tokenURI: null, reason: 'pin_failed' }, { status: 200, headers: NO_STORE });
  }
}
