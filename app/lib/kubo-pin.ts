/// Fallback IPFS pinning via the self-operated kubo archive node, used when
/// Pinata is unavailable or over its storage cap (the Cryptographics
/// preservation pass consumed the free tier — mints must not fall back to the
/// centralised /api/metadata route just because a third-party quota ran out).
///
/// The container reaches the archive over the shared `ipfs-archive_default`
/// network at http://ipfs-archive:5001 (KUBO_API_URL). API is unauthenticated
/// by design — it's only reachable inside the docker network, never exposed.
///
/// Non-fatal by design, same contract as pinata.ts: returns null on any
/// failure and callers fall back to baseURI. Minting must never be blocked
/// by an IPFS outage — the kubo path merely keeps `ipfs://` alive when it can.

const KUBO_API_URL = (process.env.KUBO_API_URL || 'http://ipfs-archive:5001').replace(/\/$/, '');

interface KuboAddResponse {
  Hash?: string;
}

/// Adds + pins raw bytes on the archive node. Returns the `ipfs://<cid>` URI
/// or null. Requests CIDv0 (Qm...) for visual consistency with the Pinata
/// CIDs already on the earlier FAX CHAIN tokens.
async function kuboAdd(content: Buffer, filename: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(content)]), filename);
    const res = await fetch(`${KUBO_API_URL}/api/v0/add?pin=true&cid-version=0`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json() as KuboAddResponse;
    return json.Hash ? `ipfs://${json.Hash}` : null;
  } catch {
    return null;
  }
}

/// Decodes a `data:<mime>;base64,<...>` URI into a Buffer.
function decodeDataUri(dataUriOrBase64: string): Buffer | null {
  const match = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/.exec(dataUriOrBase64);
  try {
    return Buffer.from(match ? match[3] : dataUriOrBase64, 'base64');
  } catch {
    return null;
  }
}

export async function kuboPinImage(dataUriOrBase64: string, format: 'png' | 'jpeg' = 'jpeg'): Promise<string | null> {
  const buffer = decodeDataUri(dataUriOrBase64);
  return buffer ? kuboAdd(buffer, `fax.${format}`) : null;
}

export async function kuboPinJSON(json: Record<string, unknown>, name = 'metadata'): Promise<string | null> {
  return kuboAdd(Buffer.from(JSON.stringify(json)), `${name}.json`);
}
