// Irys / Arweave storage — secondary permanent backup to Pinata/IPFS.
// Non-fatal: returns null on any failure or missing key.
//
// Requires: IRYS_PRIVATE_KEY env var (private key of a wallet holding
// a small amount of ETH on Base — ~$0.01–0.05 covers many uploads).
//
// Put ETH on Base into that wallet; ensureFunded() below deposits into the
// Irys node as needed. Note the SDK does NOT do this for you: uploads above
// Irys's ~100KB free threshold fail with "402 Not enough balance" until the
// node balance is funded explicitly.
//
// npm install @irys/upload @irys/upload-ethereum

import { Uploader } from "@irys/upload";
import { BaseEth } from "@irys/upload-ethereum";

const IRYS_PRIVATE_KEY = process.env.IRYS_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// Lazy singleton — init once, reuse across requests
// ---------------------------------------------------------------------------

interface IrysReceipt {
  id: string;
}

interface IrysUploader {
  upload: (data: Buffer | string, opts?: { tags?: { name: string; value: string }[] }) => Promise<IrysReceipt>;
  getPrice: (bytes: number) => Promise<bigint | { toString: () => string }>;
  getBalance: () => Promise<bigint | { toString: () => string }>;
  fund: (amount: bigint | string) => Promise<unknown>;
}

/// Upper bound on a single automatic top-up, in wei. A ~900KB fax costs a tiny
/// fraction of this; the cap exists so a pricing spike or a bug can never drain
/// the Irys wallet.
const MAX_AUTO_FUND_WEI = BigInt('500000000000000'); // 0.0005 ETH

let _uploader: IrysUploader | null = null;
let _initError: string | null = null;

async function getUploader(): Promise<IrysUploader | null> {
  if (_uploader) return _uploader;
  if (_initError) return null;

  if (!IRYS_PRIVATE_KEY) {
    _initError = "IRYS_PRIVATE_KEY not set";
    console.warn("[irys] IRYS_PRIVATE_KEY not configured — Arweave uploads disabled");
    return null;
  }

  try {
    _uploader = await Uploader(BaseEth).withWallet(IRYS_PRIVATE_KEY) as unknown as IrysUploader;
    console.log("[irys] Uploader initialised on Base");
    return _uploader;
  } catch (err) {
    _initError = String(err);
    console.error("[irys] Failed to initialise uploader:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core upload — Buffer | string → { id, url } | null
// ---------------------------------------------------------------------------

/// Ensures the Irys node balance covers an upload of `bytes`, funding from the
/// wallet if it does not.
///
/// This is NOT automatic in @irys/upload: `upload()` throws
/// "402 error: Not enough balance for transaction" if the node balance is
/// short. Uploads under Irys's ~100KB free threshold never hit this, which is
/// why small metadata JSON always succeeded while ~900KB fax images silently
/// failed every time — leaving the Arweave mirror without its image.
///
/// Best-effort: on any failure we return and let the upload attempt proceed,
/// so a funding hiccup degrades to the previous behaviour rather than throwing.
async function ensureFunded(irys: IrysUploader, bytes: number): Promise<void> {
  try {
    const price = BigInt((await irys.getPrice(bytes)).toString());
    const balance = BigInt((await irys.getBalance()).toString());
    if (balance >= price) return;

    // Add ~50% headroom so consecutive uploads don't each trigger a top-up.
    const target = price + price / BigInt(2) - balance;
    if (target > MAX_AUTO_FUND_WEI) {
      console.error(
        `[irys] upload of ${bytes} bytes needs ${target} wei, above the ` +
        `${MAX_AUTO_FUND_WEI} wei auto-fund cap — not funding. Top up ` +
        `manually or raise MAX_AUTO_FUND_WEI.`,
      );
      return;
    }
    console.log(`[irys] balance ${balance} < price ${price}, funding ${target} wei`);
    await irys.fund(target);
    console.log('[irys] funded');
  } catch (err) {
    console.error('[irys] ensureFunded failed (continuing anyway):', err);
  }
}

async function upload(
  data: Buffer | string,
  contentType: string,
  extraTags: { name: string; value: string }[] = [],
): Promise<{ id: string; url: string } | null> {
  const irys = await getUploader();
  if (!irys) return null;

  try {
    const byteLength = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
    await ensureFunded(irys, byteLength);

    const tags = [
      { name: "Content-Type", value: contentType },
      { name: "App-Name", value: "nftfax" },
      ...extraTags,
    ];
    const receipt = await irys.upload(data, { tags });
    const url = `https://gateway.irys.xyz/${receipt.id}`;
    console.log(`[irys] Uploaded ${contentType} → ${receipt.id}`);
    return { id: receipt.id, url };
  } catch (err) {
    console.error("[irys] Upload failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API — mirrors pinata.ts surface
// ---------------------------------------------------------------------------

/**
 * Upload a raw image buffer to Arweave via Irys.
 *
 * `tags` should carry the fax's identity (e.g. Tray-Id) — without it an upload
 * cannot be mapped back to a token, which is what made earlier Arweave backups
 * unusable for recovery.
 */
export async function uploadImageToArweave(
  imageBuffer: Buffer,
  contentType: "image/png" | "image/jpeg" = "image/png",
  tags: { name: string; value: string }[] = [],
): Promise<{ id: string; url: string } | null> {
  return upload(imageBuffer, contentType, tags);
}

/** Upload JSON metadata to Arweave via Irys. */
export async function uploadJSONToArweave(
  json: Record<string, unknown>,
  tags: { name: string; value: string }[] = [],
): Promise<{ id: string; url: string } | null> {
  return upload(JSON.stringify(json), "application/json", tags);
}

/** Convert an Arweave txId to the ar:// URI scheme (usable as tokenURI). */
export function arweaveTxIdToURI(txId: string): string {
  return `ar://${txId}`;
}

/** Gateway URL for a txId (human-readable / fallback). */
export function arweaveTxIdToGatewayUrl(txId: string): string {
  return `https://gateway.irys.xyz/${txId}`;
}
