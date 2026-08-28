/// Minimal Pinata REST API client for pinning fax images + metadata JSON to
/// IPFS at mint time (NFTFaxCollectibleV2 per-token URI support).
///
/// Non-fatal by design: every function here returns `null` on any failure
/// (missing API key, network error, non-2xx response) rather than throwing.
/// Callers must treat a `null` result as "no IPFS URI available" and fall
/// back to the on-chain baseURI — minting must never be blocked by an IPFS
/// outage or misconfiguration.

const PINATA_JWT = process.env.PINATA_JWT || '';
const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_PIN_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';

interface PinataPinResponse {
  IpfsHash?: string;
  error?: unknown;
}

/// Converts a `data:<mime>;base64,<...>` URI (or bare base64 string) into a
/// Buffer + inferred filename, for building the multipart upload.
function decodeDataUri(dataUriOrBase64: string, fallbackFormat: 'png' | 'jpeg' = 'jpeg'): { buffer: Buffer; filename: string; mimeType: string } {
  const match = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/.exec(dataUriOrBase64);
  if (match) {
    const mimeType = match[1];
    const ext = match[2] === 'jpg' ? 'jpg' : match[2];
    return { buffer: Buffer.from(match[3], 'base64'), filename: `fax.${ext}`, mimeType };
  }
  const mimeType = fallbackFormat === 'png' ? 'image/png' : 'image/jpeg';
  return { buffer: Buffer.from(dataUriOrBase64, 'base64'), filename: `fax.${fallbackFormat}`, mimeType };
}

/// Pins a fax image (base64 data URI or bare base64) to IPFS via Pinata.
/// Returns the `ipfs://<cid>` URI, or `null` if pinning failed/unconfigured.
export async function pinImageToIPFS(
  imageDataUri: string,
  format: 'png' | 'jpeg' = 'jpeg',
  name = 'fax-image',
): Promise<string | null> {
  if (!PINATA_JWT) return null;
  try {
    const { buffer, filename, mimeType } = decodeDataUri(imageDataUri, format);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    form.append('pinataMetadata', JSON.stringify({ name }));

    const res = await fetch(PINATA_PIN_FILE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PinataPinResponse;
    return json.IpfsHash ? `ipfs://${json.IpfsHash}` : null;
  } catch {
    return null;
  }
}

/// Pins an arbitrary JSON object (ERC-721 metadata) to IPFS via Pinata.
/// Returns the `ipfs://<cid>` URI, or `null` if pinning failed/unconfigured.
export async function pinJSONToIPFS(
  json: Record<string, unknown>,
  name = 'fax-metadata',
): Promise<string | null> {
  if (!PINATA_JWT) return null;
  try {
    const res = await fetch(PINATA_PIN_JSON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataMetadata: { name },
        pinataContent: json,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PinataPinResponse;
    return data.IpfsHash ? `ipfs://${data.IpfsHash}` : null;
  } catch {
    return null;
  }
}

/// Converts an `ipfs://<cid>` URI into an HTTPS gateway URL for display in
/// contexts (previews, dashboards) that don't support `ipfs://` natively.
export function ipfsToGatewayUrl(ipfsUri: string): string {
  if (!ipfsUri.startsWith('ipfs://')) return ipfsUri;
  return PINATA_GATEWAY + ipfsUri.slice('ipfs://'.length);
}
