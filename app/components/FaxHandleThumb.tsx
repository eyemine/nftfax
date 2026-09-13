'use client';

/// Thumbnail of the NFT behind an @fax handle.
///
/// An @fax handle IS an NFT — `chonk.681@fax` is Chonk #681 — so showing the
/// artwork next to the handle field makes it obvious which identity is sending
/// and which is receiving, instead of two opaque strings.
///
/// Resolution reuses /api/nft-image (tokenURI -> metadata -> image, cached
/// 24h server-side), so this works for every collection with no per-collection
/// API. Renders nothing but a neutral placeholder until a valid handle is
/// entered, and degrades to a small label if the image cannot be resolved —
/// a thumbnail must never block sending a fax.

import { useEffect, useState } from 'react';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';

const PREFIX_TO_COLLECTION: Record<string, CollectionKey> = {
  chonk: 'chonk',
  dfz: 'deadfellaz',
  normie: 'normie',
  atom: 'pow',
};

interface ParsedHandle {
  collection: CollectionKey;
  tokenId: number;
}

/// Parses `chonk.681`, `chonk.681@fax`, or a bare `chonk.681@fax ` with
/// whitespace into its collection + token id. Returns null when the value is
/// incomplete or not a recognised NFT-backed handle.
function parseHandle(raw: string): ParsedHandle | null {
  const clean = raw.trim().toLowerCase().replace(/@fax$/, '').replace(/@nftmail\.box$/, '');
  const dot = clean.indexOf('.');
  if (dot < 0) return null;
  const collection = PREFIX_TO_COLLECTION[clean.slice(0, dot)];
  const idPart = clean.slice(dot + 1);
  if (!collection || !/^\d+$/.test(idPart)) return null;
  const tokenId = Number(idPart);
  if (!Number.isSafeInteger(tokenId) || tokenId < 0) return null;
  return { collection, tokenId };
}

interface FaxHandleThumbProps {
  /** The handle to preview, e.g. "chonk.681" or "chonk.681@fax". */
  handle: string;
  /** Rendered size in px. Defaults to match the adjacent input height. */
  size?: number;
  /** Optional label for screen readers / tooltip context. */
  label?: string;
}

export function FaxHandleThumb({ handle, size = 46, style, label }: FaxHandleThumbProps & { style?: React.CSSProperties }) {
  const parsed = parseHandle(handle);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!parsed) { setSrc(null); setFailed(false); return; }
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    const theme = getCollectionTheme(parsed.collection);
    void (async () => {
      try {
        const params = new URLSearchParams({
          contract: theme.contract,
          chainId: String(theme.chainId),
          tokenId: String(parsed.tokenId),
          rpc: theme.rpc,
        });
        const res = await fetch(`/api/nft-image?${params}`, { cache: 'no-store' });
        const json = await res.json() as { image?: string | null };
        if (cancelled) return;
        if (json.image) setSrc(json.image); else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // Depend on the resolved identity, not the raw string, so re-typing the
    // same handle in a different form does not refetch.
  }, [parsed?.collection, parsed?.tokenId]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = parsed
    ? `${label ? `${label}: ` : ''}${getCollectionTheme(parsed.collection).collectionName} #${parsed.tokenId}`
    : label;

  return (
    <span
      title={title}
      aria-label={title}
      className="grid flex-shrink-0 place-items-center overflow-hidden border border-[#847d6e] bg-[#d5cebf]"
      style={{ width: size, height: size, ...style }}
    >
      {!parsed ? (
        <span className="text-[8px] uppercase leading-none text-[#8f8878]">NFT</span>
      ) : failed ? (
        <span className="text-[8px] uppercase leading-none text-[#8f8878]">N/A</span>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title ?? `${parsed.collection} #${parsed.tokenId}`}
          className="h-full w-full object-cover"
          style={{ imageRendering: 'pixelated' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="h-3 w-3 animate-pulse rounded-full bg-[#a99f8b]" />
      )}
    </span>
  );
}

export default FaxHandleThumb;
