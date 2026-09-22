'use client';

/// Shows which wallet holds the NFT behind a destination @fax handle.
///
/// A handle like `chonk.681@fax` tells the sender which *identity* they are
/// addressing but not which *wallet* will receive the transmission. Surfacing
/// the holder — with its ENS name when it has one — lets the sender confirm the
/// destination before committing credits. Renders nothing until a valid handle
/// is present, and degrades to a quiet "holder unknown" rather than blocking the
/// send if the lookup fails.

import { useEffect, useState } from 'react';

interface FaxHandleOwnerProps {
  /** Destination handle, with or without @fax. */
  handle: string;
}

interface OwnerResult { owner: string | null; ens: string | null }

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function FaxHandleOwner({ handle }: FaxHandleOwnerProps) {
  const clean = handle.trim().toLowerCase().replace(/@fax$/, '');
  const looksLikeFax = /^[a-z]+\.\d+$/.test(clean);
  const [result, setResult] = useState<OwnerResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!looksLikeFax) { setResult(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    // Debounce: the handle arrives one keystroke at a time from the manual field.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/fax-owner?handle=${encodeURIComponent(clean)}`, { cache: 'no-store' });
          const json = await res.json() as OwnerResult;
          if (!cancelled) setResult(json);
        } catch {
          if (!cancelled) setResult({ owner: null, ens: null });
        }
        if (!cancelled) setLoading(false);
      })();
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clean, looksLikeFax]);

  if (!looksLikeFax) return null;

  return (
    <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#625e52]">
      <span className="text-[#847d6e]">Holder</span>
      {loading ? (
        <span className="text-[#847d6e]">resolving…</span>
      ) : result?.owner ? (
        <span className="font-mono normal-case tracking-normal" title={result.owner}>
          {result.ens ? `${result.ens} · ` : ''}{short(result.owner)}
        </span>
      ) : (
        <span className="text-[#847d6e]">unknown</span>
      )}
    </p>
  );
}

export default FaxHandleOwner;
