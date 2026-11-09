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
import { kuboPinImage, kuboPinJSON } from '../../../../lib/kubo-pin';
import { uploadImageToArweave, uploadJSONToArweave, arweaveTxIdToURI } from '../../../../lib/irys';
import { parseFaxHandle, verifyFaxHandleOwner } from '@/app/lib/fax-ownership';
import { tierForHop } from '@/app/lib/tiers';
import { reserveTierSlot } from '@/app/lib/tier-supply';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const BASE_RPC = 'https://mainnet.base.org';
const BASE_FAX_COLLECTIBLE = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
const TOTAL_MINTED_SELECTOR = '0xa2309ff8'; // totalMinted()

/// Queries the on-chain totalMinted to predict the next token ID for metadata.
/// Racy if two mints land simultaneously, but mints are infrequent and the
/// metadata API route (/api/metadata/[tokenId]) is the authoritative source.
async function getNextTokenId(): Promise<number | null> {
  try {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: BASE_FAX_COLLECTIBLE, data: TOTAL_MINTED_SELECTOR }, 'latest'], id: 1 }),
    });
    const json = await res.json() as { result?: string };
    if (json.result && json.result.startsWith('0x')) {
      return parseInt(json.result, 16) + 1;
    }
  } catch { /* non-fatal */ }
  return null;
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

/// Mirrors a fax's image + metadata to Arweave and records the resulting
/// `ar://` pointers on the worker, keyed by tray id.
///
/// Runs detached from the pin response (see the call site) because funding Irys
/// and uploading a ~900KB bitmap takes ~25s and must not delay a mint.
///
/// The Arweave copy is deliberately SELF-CONTAINED: the image is uploaded first
/// and referenced as `ar://` in an Arweave-only metadata variant. Uploading both
/// in parallel and discarding the image txId (the earlier behaviour) left the
/// mirror's `image` pointing at ipfs://, so if IPFS was what failed, the ar://
/// metadata resolved with a dead image. The IPFS copy is untouched.
async function mirrorToArweave(args: {
  id: string;
  local: string;
  format: 'png' | 'jpeg';
  dataBase64: string;
  metadata: Record<string, unknown>;
  nextTokenId: number | null;
}): Promise<void> {
  const { id, local, format, dataBase64, metadata, nextTokenId } = args;
  try {
    const tags = [
      { name: 'Tray-Id', value: id },
      ...(local ? [{ name: 'Fax-Mailbox', value: local }] : []),
      ...(nextTokenId ? [{ name: 'Expected-Token-Id', value: String(nextTokenId) }] : []),
    ];

    const arweaveImage = await uploadImageToArweave(
      Buffer.from(dataBase64, 'base64'),
      format === 'png' ? 'image/png' : 'image/jpeg',
      [...tags, { name: 'Fax-Asset', value: 'image' }],
    );
    const arweaveImageURI = arweaveImage ? arweaveTxIdToURI(arweaveImage.id) : null;

    const arweaveMeta = await uploadJSONToArweave(
      arweaveImageURI ? { ...metadata, image: arweaveImageURI } : metadata,
      [...tags, { name: 'Fax-Asset', value: 'metadata' }],
    );
    if (!arweaveMeta) return;

    const arweaveURI = arweaveTxIdToURI(arweaveMeta.id);
    console.log(
      `[pin] Arweave mirror stored for ${id}: ${arweaveURI}` +
      (arweaveImageURI ? ` (self-contained, image ${arweaveImageURI})` : ' (WARNING: image upload failed, image still points at IPFS)'),
    );

    // Record the pointers so recovery does not depend on querying Irys by tag.
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_SECRET ? { 'X-Worker-Secret': WORKER_SECRET } : {}),
      },
      body: JSON.stringify({
        action: 'setTrayArweave',
        secret: WEBHOOK_SECRET,
        trayId: id,
        arweaveUri: arweaveURI,
        arweaveImageUri: arweaveImageURI,
      }),
    }).catch(() => { /* tags remain as the fallback recovery path */ });
  } catch (cause) {
    // Best-effort by design: a mirror failure must never affect a mint.
    console.error(`[pin] Arweave mirror failed for ${id}:`, cause);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // mode: 'mint' (default) checks + reserves the tier slot and pins;
  // 'prefetch' (pin at forward time) checks the tier but holds no slot, since
  // the player may never mint; 'reserve' checks + reserves without pinning
  // again — the mint path uses it when it already holds a prefetched URI, so a
  // tier that filled up since the forward still refuses the mint.
  const body = await req.json().catch(() => ({})) as { local?: string; ownerWallet?: string; mode?: 'mint' | 'prefetch' | 'reserve' };
  const mode = body.mode === 'prefetch' || body.mode === 'reserve' ? body.mode : 'mint';
  const local = (body.local || '').trim();
  const wallet = (body.ownerWallet || '').trim();
  const collectionName = collectionNameFromLocal(local);

  if (!id) {
    return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  }

  // This endpoint SPENDS money: it writes permanent pins to Pinata and funds an
  // on-chain Irys deposit before mirroring ~1MB to Arweave. It previously had no
  // authentication of any kind, which meant anyone holding a tray id could drain
  // the Irys wallet and burn Pinata quota. Require a wallet that actually owns
  // the mailbox the pin is attributed to.
  if (!local) {
    return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  }
  if (!parseFaxHandle(local)) {
    return NextResponse.json({ error: 'Not a recognised @fax handle.' }, { status: 404, headers: NO_STORE });
  }
  const auth = await verifyFaxHandleOwner(local, wallet);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 403, headers: NO_STORE });
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
    const tier = tierForHop(hopCount ?? 0);

    // Tier supply is fixed (TIER_SUPPLY) and the prize draw reads this tier
    // trait, so a full tier must refuse BEFORE anything is pinned. This is a
    // hard stop, not the non-fatal "mint without URI" fallback: minting
    // without a per-token URI would just put the same tier in the baseURI
    // metadata. The slot is reserved briefly so concurrent mints can't both
    // take the last one.
    // Prefetch (forward-time pin, Gnosis save) still pins on a full tier — it
    // isn't a mint — and just reports it; the mint itself re-checks.
    const slot = await reserveTierSlot(tier, id, { hold: mode !== 'prefetch' });
    if (!slot.ok && mode !== 'prefetch') {
      return NextResponse.json(
        { tokenURI: null, reason: 'tier_minted_out', tier, supply: slot.supply, minted: slot.minted,
          error: `${tier} is minted out (${slot.minted}/${slot.supply}). You can still create and forward this fax, but this hop can't be minted.` },
        { status: 409, headers: NO_STORE },
      );
    }
    if (mode === 'reserve') {
      return NextResponse.json({ reserved: true, tier }, { status: 200, headers: NO_STORE });
    }

    // Pinata first; the shared free tier is exhausted by the Cryptographics
    // archive, so fall through to the self-operated kubo node (same docker
    // network) rather than letting the mint fall back to the centralised
    // baseURI — which is what OpenSea flags as "centralised" on token 44/45.
    const imageUri =
      (await pinImageToIPFS(dataUri, format, `fax-${id}`)) ||
      (await kuboPinImage(dataUri, format));
    if (!imageUri) {
      return NextResponse.json({ tokenURI: null, reason: 'image_pin_failed' }, { status: 200, headers: NO_STORE });
    }

    const nextTokenId = await getNextTokenId();
    const metadata = {
      name: nextTokenId ? `FAX CHAIN #${nextTokenId}` : 'FAX CHAIN',
      description: `NFTFax Collectible${nextTokenId ? ` #${nextTokenId}` : ''} — minted from ${local || 'a fax mailbox'} (fax ${id}). A chain-letter fax machine collectible on Base.`,
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

    const metadataUri =
      (await pinJSONToIPFS(metadata, `fax-metadata-${id}`)) ||
      (await kuboPinJSON(metadata, `fax-metadata-${id}`));
    if (!metadataUri) {
      return NextResponse.json({ tokenURI: null, reason: 'metadata_pin_failed' }, { status: 200, headers: NO_STORE });
    }

    // Belt-and-suspenders: also mirror to Arweave — but NOT on this request's
    // critical path.
    //
    // This route is awaited by the mint flow before the wallet is even asked to
    // sign. Funding the Irys node and pushing a ~900KB bitmap takes ~25s, which
    // made clicking "Mint" look like nothing was happening at all. Arweave is a
    // backup, so it must never delay a mint. Fire it off and return immediately;
    // this runs as a persistent Node process (not serverless), so the task
    // survives the response. The txId is recorded to the worker from inside the
    // task, keyed by tray id, so nothing is lost by not returning it here.
    void mirrorToArweave({ id, local, format, dataBase64: doc.dataBase64, metadata, nextTokenId });

    return NextResponse.json(
      { tokenURI: metadataUri, imageUri, arweaveQueued: true, tier, tierMintedOut: !slot.ok },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ tokenURI: null, reason: 'pin_failed' }, { status: 200, headers: NO_STORE });
  }
}
