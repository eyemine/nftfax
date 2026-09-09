/// Resolves an ERC-721 token's static preview image from its tokenURI.
///
/// Generic across collections — no per-collection API needed. The standard
/// path (tokenId -> tokenURI() -> metadata JSON -> `image` field) works
/// identically for every collection theme in app/lib/theme.ts (Chonks,
/// Deadfellaz, Normies, POW NFT). Collections that also expose an
/// `animation_url` (e.g. POW NFT's animated variant) are intentionally
/// ignored here — we only want the static `image`.
///
/// Results are cached in-process (this runs as a persistent Docker process
/// on Hetzner) — an NFT's image essentially never changes post-mint, so a
/// long TTL is safe and avoids repeat RPC + IPFS-gateway round trips.

import { createPublicClient, http, type Address, type Chain } from 'viem';
import { base, mainnet } from 'viem/chains';

const CHAIN_MAP: Record<number, Chain> = {
  8453: base,
  1: mainnet,
};

const ERC721_METADATA_ABI = [
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://infura-ipfs.io/ipfs/',
];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — images don't change post-mint
const FETCH_TIMEOUT_MS = 12000;

interface CacheEntry { image: string | null; at: number }
const cache = new Map<string, CacheEntry>();

/// Rewrites ipfs://<cid>/<path> (and the bare ipfs:/<cid> variant some
/// minters use) to an HTTP gateway URL using the first gateway in the list.
/// Passes through http(s) and data: URIs unchanged.
function resolveUri(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return IPFS_GATEWAYS[0] + uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  }
  return uri;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

interface NftMetadata { image?: string; poster?: string }

/// Tries to fetch metadata from an IPFS URI across multiple gateways,
/// returning the first successful JSON response. For non-IPFS URIs, falls
/// back to a single fetchWithTimeout call.
async function fetchMetadataFromUri(tokenUri: string): Promise<NftMetadata | null> {
  if (!tokenUri.startsWith('ipfs://')) {
    const res = await fetchWithTimeout(resolveUri(tokenUri));
    if (!res.ok) return null;
    return (await res.json()) as NftMetadata;
  }
  const path = tokenUri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const res = await fetchWithTimeout(gateway + path);
      if (res.ok) return (await res.json()) as NftMetadata;
    } catch {
      // gateway down or timed out — try next
    }
  }
  return null;
}

async function fetchMetadata(tokenUri: string): Promise<NftMetadata | null> {
  // Fully on-chain metadata: data:application/json;base64,<...> or
  // data:application/json,<...> (unencoded).
  if (tokenUri.startsWith('data:')) {
    const comma = tokenUri.indexOf(',');
    if (comma === -1) return null;
    const meta = tokenUri.slice(0, comma);
    const payload = tokenUri.slice(comma + 1);
    const json = meta.includes('base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
    return JSON.parse(json) as NftMetadata;
  }
  return fetchMetadataFromUri(tokenUri);
}

/// Some collections (e.g. POW NFT) put an animated/live-model render under
/// `image` and the actual static still under `poster` — `image` there
/// resolves to an .mp4, not a picture. Prefer `poster` when present so we
/// never hand the browser a video for an <img> tag.
function pickStaticImage(metadata: NftMetadata): string | undefined {
  return metadata.poster || metadata.image;
}

/// Resolves the static preview image URL for one ERC-721 token. Never
/// throws — returns null on any failure (bad tokenId, RPC error, gateway
/// timeout, malformed metadata) so a single bad token can't break a list.
export async function resolveNftImage(
  contract: string,
  chainId: number,
  tokenId: number,
  rpc?: string,
): Promise<string | null> {
  const key = `${chainId}:${contract.toLowerCase()}:${tokenId}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.image;

  try {
    const viemChain = CHAIN_MAP[chainId];
    if (!viemChain) throw new Error(`Unsupported chainId: ${chainId}`);
    const client = createPublicClient({ chain: viemChain, transport: http(rpc || undefined) });
    const tokenUri = await client.readContract({
      address: contract as Address,
      abi: ERC721_METADATA_ABI,
      functionName: 'tokenURI',
      args: [BigInt(tokenId)],
    });
    const metadata = await fetchMetadata(tokenUri);
    const rawImage = metadata ? pickStaticImage(metadata) : undefined;
    const image = rawImage ? resolveUri(rawImage) : null;
    cache.set(key, { image, at: now });
    return image;
  } catch {
    // Don't cache failures — a transient RPC/gateway blip shouldn't be
    // stuck showing "no image" for the full 24h TTL.
    return null;
  }
}
