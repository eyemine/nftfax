// Irys / Arweave storage — secondary permanent backup to Pinata/IPFS.
// Non-fatal: returns null on any failure or missing key.
//
// Requires: IRYS_PRIVATE_KEY env var (private key of a wallet holding
// a small amount of ETH on Base — ~$0.01–0.05 covers many uploads).
// Get ETH on Base into that wallet, then the SDK auto-funds per upload.
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
}

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

async function upload(
  data: Buffer | string,
  contentType: string,
): Promise<{ id: string; url: string } | null> {
  const irys = await getUploader();
  if (!irys) return null;

  try {
    const tags = [
      { name: "Content-Type", value: contentType },
      { name: "App-Name", value: "nftfax" },
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

/** Upload a raw image buffer to Arweave via Irys. */
export async function uploadImageToArweave(
  imageBuffer: Buffer,
): Promise<{ id: string; url: string } | null> {
  return upload(imageBuffer, "image/png");
}

/** Upload JSON metadata to Arweave via Irys. */
export async function uploadJSONToArweave(
  json: Record<string, unknown>,
): Promise<{ id: string; url: string } | null> {
  return upload(JSON.stringify(json), "application/json");
}

/** Convert an Arweave txId to the ar:// URI scheme (usable as tokenURI). */
export function arweaveTxIdToURI(txId: string): string {
  return `ar://${txId}`;
}

/** Gateway URL for a txId (human-readable / fallback). */
export function arweaveTxIdToGatewayUrl(txId: string): string {
  return `https://gateway.irys.xyz/${txId}`;
}
