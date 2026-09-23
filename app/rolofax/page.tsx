'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useActiveWallet, useConnectWallet } from '@privy-io/react-auth';
import { LayersArrowDown, Radar, Loader2, Check, Users, AlertCircle, ArrowLeft, X, Send } from 'lucide-react';
import { OdometerCounter } from '../components/OdometerCounter';
import { FaxHandleThumb } from '../components/FaxHandleThumb';
import Link from 'next/link';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';
import { disconnectWallet } from '../lib/disconnect';
import { SkinPanel } from '../components/SkinPanel';

type RegisterStatus = 'idle' | 'registering' | 'registered' | 'error';

interface RolofaxEntry {
  handle: string;
  wallet: string;
  collection: string;
  ready: boolean;
  readyUntil?: number;
  createdAt: number;
}

const COLLECTION_KEYS = ['chonk', 'deadfellaz', 'normie', 'pow'] as const;

const MARKETPLACE_URLS: Record<string, (tokenId: number) => string> = {
  chonk: (id) => `https://www.chonks.xyz/market/chonks/${id}`,
  deadfellaz: (id) => `https://opensea.io/item/ethereum/0x2acab3dea77832c09420663b0e1cb386031ba17b/${id}`,
  normie: (id) => `https://opensea.io/item/ethereum/0x9eb6e2025b64f340691e424b7fe7022ffde12438/${id}`,
  pow: (id) => `https://opensea.io/item/ethereum/0x9abb7bddc43fa67c76a62d8c016513827f59be1b/${id}`,
};

// Only fetches the NFT's image once the row scrolls into view — avoids
// firing an RPC + IPFS-gateway lookup for every registered entry on mount.
// Once resolved, the <img> loads directly from IPFS/HTTP in the browser —
// our server only ever resolves+caches the URL, never proxies the bytes.
function NftThumbnail({ handle, collection }: { handle: string; collection: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const elRef = useRef<HTMLAnchorElement>(null);

  const tokenId = useMemo(() => {
    const match = handle.match(/\.(\d+)$/);
    return match ? Number(match[1]) : null;
  }, [handle]);

  useEffect(() => {
    if (visible) return;
    const el = elRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || tokenId === null) return;
    if (!COLLECTION_KEYS.includes(collection as typeof COLLECTION_KEYS[number])) { setFailed(true); return; }
    const theme = getCollectionTheme(collection as CollectionKey);
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          contract: theme.contract,
          chainId: String(theme.chainId),
          tokenId: String(tokenId),
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
  }, [visible, tokenId, collection]);

  const marketplaceUrl = tokenId !== null ? MARKETPLACE_URLS[collection]?.(tokenId) ?? null : null;

  return (
    <a
      ref={elRef}
      href={marketplaceUrl ?? undefined}
      target={marketplaceUrl ? '_blank' : undefined}
      rel={marketplaceUrl ? 'noopener noreferrer' : undefined}
      className="grid h-10 w-10 flex-shrink-0 place-items-center overflow-hidden border border-[#847d6e] bg-[#d5cebf] transition-colors hover:border-[#e65b2f]"
      title={marketplaceUrl ? `View on ${collection === 'chonk' ? 'Chonks' : 'OpenSea'}` : undefined}
    >
      {tokenId === null || failed ? (
        <span className="text-[9px] text-[#847d6e]">N/A</span>
      ) : src ? (
        <img src={src} alt={`${handle}@fax`} className="h-10 w-10 object-cover" loading="lazy" />
      ) : (
        <Loader2 size={12} className="animate-spin text-[#847d6e]" />
      )}
    </a>
  );
}

/// Community logos, keyed by collection. Served from /public/logos.
///
/// The files are cropped to their marks, so they do NOT share an aspect ratio.
/// Scale is therefore applied to a base WIDTH, not a height: the crop was
/// vertical, so matching width is what makes the marks look optically equal.
/// Intrinsic w/h are declared per file so the browser reserves the right space
/// before decoding — a single shared 2400x1500 would now be wrong for all four.
const LOGO_BASE_WIDTH = 384;

/// Fixed box, sized to the tallest scaled logo (Normies, 180px). Constant
/// across collections so no logo can change the footer height and shift the
/// counter.
const LOGO_BOX_HEIGHT = 180;

/// Gap between the logo box and the counter beneath it.
const LOGO_BOTTOM_GAP = 52;

const COLLECTION_LOGOS: Record<string, { src: string; scale: number; w: number; h: number; lift?: number }> = {
  chonk: { src: '/logos/chonks.png', scale: 1.25, w: 2400, h: 750 },
  deadfellaz: { src: '/logos/deadfellaz.png', scale: 1, w: 2400, h: 990 },
  normie: { src: '/logos/normies.png', scale: 1.5, w: 2400, h: 750 },
  // 384x120 at scale 1.0. Smaller than the other marks by design: it stays
  // centred in the same 180px box, so the reduced height reads as extra
  // clearance above the counter rather than a shift in position.
  // lift is a transform, so raising it cannot change the box height or move
  // the counter below.
  pow: { src: '/logos/pow.png', scale: 1.0, w: 2400, h: 750, lift: 8 },
};

export default function PreRegisterPage() {
  const { ready, authenticated, logout } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const activeWallet = useActiveWallet().wallet;
  const [collection, setCollection] = useState<CollectionKey>('chonk');
  const theme = useMemo(() => getCollectionTheme(collection), [collection]);
  const walletAddress = activeWallet?.address?.toLowerCase() || '';

  const [faxTokenId, setFaxTokenId] = useState('');
  const prefix = useMemo(() => (theme.mailboxHint || theme.mailboxPlaceholder || collection).split('.')[0], [theme, collection]);
  const [readyReceive, setReadyReceive] = useState(true);
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [error, setError] = useState('');
  const [vaultWallet, setVaultWallet] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [entries, setEntries] = useState<RolofaxEntry[]>([]);
  const [ensNames, setEnsNames] = useState<Record<string, string>>({});
  /// Free-text filter on the holder wallet: matches address or ENS name.
  const [walletFilter, setWalletFilter] = useState('');
  const [ownedTokenIds, setOwnedTokenIds] = useState<number[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);

  useEffect(() => {
    setFaxTokenId('');
    setStatus('idle');
    setError('');
    setOwnedTokenIds([]);
    void loadEntries();
  }, [collection]);

  useEffect(() => {
    if (!walletAddress || !theme.contract || !theme.chainId) {
      setOwnedTokenIds([]);
      return;
    }
    let cancelled = false;
    setLoadingTokens(true);
    void (async () => {
      try {
        const params = new URLSearchParams({
          wallet: walletAddress,
          contract: theme.contract,
          chainId: String(theme.chainId),
          rpc: theme.rpc,
        });
        const res = await fetch(`/api/nft-tokens?${params}`, { cache: 'no-store' });
        if (res.ok) {
          const json = (await res.json()) as { tokenIds?: number[] };
          if (!cancelled) setOwnedTokenIds(json.tokenIds ?? []);
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setLoadingTokens(false);
    })();
    return () => { cancelled = true; };
  }, [walletAddress, collection, theme.contract, theme.chainId, theme.rpc]);

  async function loadEntries() {
    try {
      const res = await fetch(`/api/telegraph/list?collection=${collection}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: RolofaxEntry[]; error?: string };
      const items = json.items ?? [];
      setEntries(items);
      void resolveEns(items.map((e) => e.wallet));
    } catch {
      setEntries([]);
    }
  }

  async function resolveEns(addresses: string[]) {
    if (addresses.length === 0) return;
    try {
      const res = await fetch('/api/ens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      });
      const json = (await res.json()) as { names?: Record<string, string> };
      if (json.names) setEnsNames((prev) => ({ ...prev, ...json.names }));
    } catch { /* non-fatal — falls back to truncated address */ }
  }

  async function register() {
    setError('');
    setStatus('registering');

    if (!walletAddress) {
      setError('Connect a wallet first.');
      setStatus('error');
      return;
    }

    const tokenPart = faxTokenId.trim().replace(/^\.+/, '');
    if (!tokenPart) {
      setError('Enter your token ID.');
      setStatus('error');
      return;
    }
    const h = `${prefix}.${tokenPart}`.toLowerCase();

    const vault = vaultWallet.trim().toLowerCase();
    const tok = tokenId.trim();
    if (vault && !/^0x[a-f0-9]{40}$/i.test(vault)) {
      setError('Invalid vault wallet address.');
      setStatus('error');
      return;
    }

    try {
      const res = await fetch('/api/telegraph/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: h,
          wallet: walletAddress,
          collection,
          ready: readyReceive,
          readyUntil: 0,
          vaultWallet: vault || undefined,
          tokenId: tok || undefined,
        }),
      });

      const json = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Registration failed');
      }

      setStatus('registered');
      setFaxTokenId('');
      void loadEntries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStatus('error');
    }
  }

  async function removeEntry(entry: RolofaxEntry) {
    if (!walletAddress) return;
    if (entry.wallet.toLowerCase() !== walletAddress.toLowerCase()) {
      setError('You can only remove your own entries.');
      return;
    }
    try {
      const res = await fetch('/api/telegraph/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: entry.handle,
          wallet: entry.wallet,
          collection: entry.collection,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || 'Removal failed');
      }
      void loadEntries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Removal failed');
    }
  }

  const communityTotal = entries.length;
  const readyCount = entries.filter((e) => e.ready).length;

  /// Entries whose holder matches the wallet filter. Matches a substring of
  /// the address (so a pasted 0x… prefix works) or of the ENS name, case-
  /// insensitively. An empty filter passes everything through.
  const filterQuery = walletFilter.trim().toLowerCase();
  const visibleEntries = filterQuery
    ? entries.filter((e) => {
        const w = e.wallet.toLowerCase();
        const ens = (ensNames[w] || '').toLowerCase();
        return w.includes(filterQuery) || ens.includes(filterQuery);
      })
    : entries;

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-10" style={{ backgroundColor: '#c8c0ae' }}>
      <header className="mx-auto mb-5 flex max-w-6xl items-center justify-between border-b border-[#575244] pb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radar size={20} /></div>
          <div>
            <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">ROLOFAX<span style={{ color: theme.accent }}>™</span></h1>
            <p className="text-[11px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Player directory</p>
          </div>
        </div>
        <Link href="/" className="key-shadow text-[11px] sm:text-[12px] font-bold uppercase tracking-[.12em] underline text-[#625e52] whitespace-nowrap"><ArrowLeft size={13} className="inline" /> Fax</Link>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <SkinPanel theme={theme} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            <span>Join the player directory</span>
            <span className="flex items-center gap-2 text-[#456049]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#56705a]" /> Active</span>
          </div>

          <div className="p-5 md:p-8 space-y-4">
            <div className="border-2 border-[#e65b2f] bg-[#f5dcc8] p-3 text-center">
              <p className="text-[12px] font-black uppercase tracking-[.14em] text-[#8a3e1e]">⚡ Launch promotion — first 100 entries get 5 fax credits</p>
            </div>

            <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">
              Connect your wallet to add your chonk/deadfellaz/normie/pow NFT to the directory and claim your @fax. Players can find your handle to build a chain.
            </p>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Community</span>
              <select
                value={collection}
                onChange={(e) => setCollection(e.target.value as CollectionKey)}
                className="key-shadow w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-[12px] font-bold uppercase"
              >
                {(['chonk', 'deadfellaz', 'normie', 'pow'] as const).map((k) => (
                  <option key={k} value={k}>{getCollectionTheme(k).collectionName}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Fax handle</span>
              {/* Fixed-height slot. This position cycles through three states —
                  loading message, "none found" message, and the token dropdown —
                  which have different intrinsic heights, so the panel jumped
                  once a wallet's NFTs resolved. Reserving the dropdown's height
                  keeps the layout still through every state. */}
              {walletAddress && (
                <div className="mb-2 flex h-[34px] items-center">
                  {ownedTokenIds.length > 0 ? (
                    <select
                      value={faxTokenId}
                      onChange={(e) => setFaxTokenId(e.target.value)}
                      className="h-[34px] w-full border border-[#847d6e] bg-[#eee8dc] px-3 text-xs outline-none focus:border-[#e65b2f]"
                    >
                      <option value="">Select your {theme.collectionName} token…</option>
                      {ownedTokenIds.map((tid) => (
                        <option key={tid} value={String(tid)}>{prefix}.{tid}@fax</option>
                      ))}
                    </select>
                  ) : loadingTokens ? (
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]"><Loader2 size={12} className="animate-spin" /> Loading your {theme.collectionName} tokens…</p>
                  ) : (
                    <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]">No {theme.collectionName} tokens found in your wallet</p>
                  )}
                </div>
              )}
              <div className="flex items-start gap-2">
                {/* Preview of the identity being registered. Updates from either
                    the dropdown or the manual field, since both write faxTokenId. */}
                <FaxHandleThumb handle={faxTokenId ? `${prefix}.${faxTokenId}` : ''} size={69} label="Your fax identity" />
                <div className="flex min-w-0 flex-1">
                  <span className="border border-r-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-sm font-bold">{prefix}.</span>
                  <input
                    value={faxTokenId}
                    onChange={(e) => setFaxTokenId(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="1234"
                    inputMode="numeric"
                    className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                  />
                  <span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@fax</span>
                </div>
              </div>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]">{ownedTokenIds.length > 0 ? 'Select from dropdown or type your token ID' : 'Enter your ' + theme.collectionName + ' token ID'}</span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Vault wallet (optional, Delegate.xyz)</span>
              <input
                value={vaultWallet}
                onChange={(e) => setVaultWallet(e.target.value)}
                placeholder="0x..."
                className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-sm outline-none focus:border-[#e65b2f]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Token ID (optional, for delegation)</span>
              <input
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                placeholder="e.g. 123"
                className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-sm outline-none focus:border-[#e65b2f]"
              />
            </label>

            <div className="border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[.18em] block mb-1">Wallet</span>
                {walletAddress && (
                  <button
                    onClick={() => void disconnectWallet(activeWallet, { authenticated, logout })}
                    className="text-[11px] font-bold uppercase underline text-[#a94228]"
                  >
                    Sign out
                  </button>
                )}
              </div>
              {walletAddress ? (
                <span className="font-mono text-xs">{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span>
              ) : (
                <span className="text-[#625e52] text-xs">No wallet connected</span>
              )}
            </div>

            <label className="flex items-center gap-2 text-[12px] font-bold uppercase">
              <input
                type="checkbox"
                checked={readyReceive}
                onChange={(e) => setReadyReceive(e.target.checked)}
                className="h-4 w-4 accent-[#e65b2f]"
              />
              Signal ready to receive faxes
            </label>

            {!walletAddress ? (
              <button
                onClick={() => connectWallet()}
                className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white"
              >
                <Users size={17} /> Connect wallet to rolofax
              </button>
            ) : (
              <button
                onClick={() => void register()}
                disabled={status === 'registering'}
                className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:opacity-50"
              >
                {status === 'registering' ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                Join Rolofax Directory
              </button>
            )}

            {status === 'registered' && (
              <div className="border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold">
                <Check size={15} className="inline" /> Registered. You are in the Day-1 directory.
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </SkinPanel>

        <SkinPanel
          theme={theme}
          className="machine-shadow h-full overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c0b9a9]"
          contentClassName="flex h-full flex-col"
        >
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            <span>{theme.collectionName} — Active player radar</span>
            <span>{readyCount}/{communityTotal} ready</span>
          </div>

          {/* FIXED height, not max-height: the list grows from empty to full as
              entries load, and with max-height that growth resized the whole
              panel after the NFTs populated. A fixed box reserves the space up
              front, so the panel is the same height before and after. */}
          {/* Filter by holder wallet. Static strip, so it does not change the
              panel height as data loads. Sits outside the scroll box so it stays
              put while the list scrolls. */}
          <div className="flex items-center gap-2 border-b border-[#8f8878] bg-[#c1b9a7] px-5 py-2 md:px-8">
            <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-[.16em] text-[#625e52]">Filter by EOA</span>
            <input
              value={walletFilter}
              onChange={(e) => setWalletFilter(e.target.value)}
              placeholder="0x… or name.eth"
              spellCheck={false}
              className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-1.5 font-mono text-xs outline-none focus:border-[#e65b2f]"
            />
            {walletAddress && (
              <button
                type="button"
                onClick={() => setWalletFilter(walletFilter.toLowerCase() === walletAddress.toLowerCase() ? '' : walletAddress)}
                title="Show only my identities"
                className={`key-shadow whitespace-nowrap border px-2 py-1.5 text-[10px] font-bold uppercase ${walletFilter.toLowerCase() === walletAddress.toLowerCase() ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
              >
                Mine
              </button>
            )}
            {walletFilter && (
              <button type="button" onClick={() => setWalletFilter('')} title="Clear filter" className="text-[#625e52] hover:text-[#a94228]">
                <X size={14} />
              </button>
            )}
            {filterQuery && (
              <span className="whitespace-nowrap text-[10px] font-bold uppercase text-[#847d6e]">{visibleEntries.length}/{entries.length}</span>
            )}
          </div>

          <div className="h-[500px] overflow-y-auto bg-[#c8c0ae] p-5 md:p-8">
            {entries.length === 0 ? (
              <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">No players registered for {theme.collectionName} yet. Be the first.</p>
            ) : visibleEntries.length === 0 ? (
              <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">No {theme.collectionName} identities held by a wallet matching “{walletFilter.trim()}”.</p>
            ) : (
              <div className="space-y-2">
                {visibleEntries.map((entry) => {
                  const isOwn = walletAddress && entry.wallet.toLowerCase() === walletAddress.toLowerCase();
                  return (
                  <div key={entry.handle} className={`flex items-center justify-between gap-3 border border-[#847d6e] bg-[#eee8dc] px-3 py-2 ${isOwn ? '' : 'hover:border-[#e65b2f]'} transition-colors`}>
                    <div className="flex flex-1 items-center gap-3">
                      <NftThumbnail handle={entry.handle} collection={entry.collection} />
                      <div>
                        <p className="text-xs font-bold">{entry.handle}@fax</p>
                        <p className="text-[11px] uppercase tracking-wider text-[#625e52]">{ensNames[entry.wallet.toLowerCase()] ?? `${entry.wallet.slice(0, 6)}…${entry.wallet.slice(-4)}`}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.ready ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-[#456049]"><span className="h-2 w-2 rounded-full bg-[#56705a]" /> Ready</span>
                      ) : (
                        <span className="text-[11px] font-bold uppercase text-[#625e52]">Registered</span>
                      )}
                      {!isOwn && (
                        <Link
                          href={`/?to=${entry.handle}@fax`}
                          className="key-shadow flex items-center gap-1 border border-[#77705f] bg-[#d8d0bf] px-2 py-1 text-[11px] font-bold uppercase hover:bg-[#e65b2f] hover:text-white hover:border-[#983b21] transition-colors"
                          title={`Send fax to ${entry.handle}@fax`}
                        >
                          <Send size={10} /> Fax
                        </Link>
                      )}
                      {isOwn && (
                        <span className="text-[11px] font-bold uppercase text-[#847d6e]">You</span>
                      )}
                      {isOwn && (
                        <button
                          onClick={() => void removeEntry(entry)}
                          className="text-[#a94228] hover:text-[#c0392b]"
                          title="Remove from radar"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Community mark + live headcount. Sits below the scrolling list and
              shares its horizontal padding, so the logo lines up with the rows
              above rather than the panel edge. */}
          {/* mt-auto pins this to the panel's bottom even when the grid stretches
              the panel past its content. The logo box has a FIXED height, so the
              footer does not reflow when the image decodes or when the list
              above changes length — that reflow was what made the counter jump
              between collections. */}
          <div className="relative mt-auto px-5 py-4 md:px-8">
            {/* Fixed-height box: reserved before the image decodes, and immune to
                the per-collection scale, so the footer never reflows. mb-5 lifts
                the mark clear of the counter below it. */}
            <div
              className="mx-auto flex w-full items-center justify-center"
              style={{ height: LOGO_BOX_HEIGHT, marginBottom: LOGO_BOTTOM_GAP }}
            >
              {COLLECTION_LOGOS[collection] && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={collection}
                  src={COLLECTION_LOGOS[collection].src}
                  alt={`${theme.collectionName} logo`}
                  width={COLLECTION_LOGOS[collection].w}
                  height={COLLECTION_LOGOS[collection].h}
                  /* Width-driven: height follows the file's own aspect, capped
                     by the box so nothing can overflow it. */
                  className="h-auto max-w-full object-contain"
                  style={{
                    width: LOGO_BASE_WIDTH * COLLECTION_LOGOS[collection].scale,
                    maxHeight: LOGO_BOX_HEIGHT,
                    transform: COLLECTION_LOGOS[collection].lift
                      ? `translateY(-${COLLECTION_LOGOS[collection].lift}px)`
                      : undefined,
                  }}
                />
              )}
            </div>
            {/* Inset by the panel's content padding so it lines up with the Join
                Rolofax Directory button, which sits one padding-step above its
                own panel's bottom edge. */}
            <div className="mt-3 flex justify-end sm:absolute sm:bottom-5 sm:right-5 sm:mt-0 md:bottom-8 md:right-8">
              <OdometerCounter
                key={collection}
                value={communityTotal}
                label={`Active ${theme.collectionName} players`}
              />
            </div>
          </div>
        </SkinPanel>
      </div>
    </main>
  );
}
