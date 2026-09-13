'use client';

/// InTray — the received-fax gallery for the standalone NFTfax office.
///
/// Chain-letter game loop:
///   1. A received fax lands here as a card with an 8-day Thermal-Fade countdown.
///   2. FORWARD it onward (keeps the chain alive) — this unlocks the mint.
///      You may attach a new image to the forward; it becomes the next link.
///   3. MINT TO BASE (the tradeable collectible) — only after forwarding.
///   4. SAVE TO GNOSIS (permanence) — rescues the fax from the fade at any time.
/// Unsaved / unminted faxes decay after 8 days so the gallery stays uncluttered.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, Coins, Archive, Clock, Lock, LayersArrowDown, X, Upload, Link2, Stamp, Ghost, Sun, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import { compositeChain, prepareImage, CHAIN_OPS, type ChainOp, type OverlayPlacement } from '../lib/image';
import { MINT_CONFIG, SAVE_CONFIG, isPlaceholderAddress, switchToChain, MINT_PAUSED, MINT_RESUME_AT } from '../lib/contracts';
import { buildMintTx, sendMintTx, pinFaxMetadata, encodeSaveFax, parseFaxIdentity, checkSmartWalletMintEligibility } from '../lib/fax-mint';
import { DEFAULT_JAM_MS, getChainTimerMs, MAX_CREDITS } from '../lib/fax-credits';

const OP_ICON: Record<ChainOp, typeof Stamp> = { stamp: Stamp, ghost: Ghost, illuminate: Sun };

/// Per-collection on-chain mint-limit reminder, shown above the tray tab
/// strip whenever the connected mailbox resolves to a known collection.
/// Chonk's claimed[] mapping has no chain dimension (mintFaxOnChain resolves
/// the real sourceTokenId via on-chain ownerOf, so it can't be composited) —
/// one mint ever. DeadFellaz/POW/Normie mint via mintFaxDirect, where
/// sourceTokenId is app-encoded per chain (see encodeCompositeSourceTokenId
/// in fax-mint.ts) — one mint per chain.
const MINT_LIMIT_NOTICE: Record<string, string> = {
  chonk: 'EACH CHONK @FAX ACCOUNT CAN MINT ONLY ONE FAX CHAIN NFT.',
  pow: 'A POW NFT @FAX ACCOUNT CAN ONLY MINT ONE FAX CHAIN NFT PER CHAIN.',
  deadfellaz: 'A DEADFELLAZ @FAX ACCOUNT CAN ONLY MINT ONE FAX CHAIN NFT PER CHAIN.',
  normie: 'A NORMIE @FAX ACCOUNT CAN ONLY MINT ONE FAX CHAIN NFT PER CHAIN.',
};

const DECAY_MS = 8 * 24 * 60 * 60 * 1000; // 8-day decay
/// How long to wait for the wallet provider before falling back to the
/// injected one. Guards against a provider promise that never settles.
const PROVIDER_TIMEOUT_MS = 4000;

const DEFAULT_PLACEMENT: OverlayPlacement = { x: 0.5, y: 0.5, scale: 1, cropX: 0, cropY: 0, cropW: 1, cropH: 1 };

interface InboxFax {
  id: string;
  from: string;
  to?: string;
  format: string;
  channel?: 'public' | 'private';
  encrypted?: boolean;
  createdAt: number;
  forwarded?: boolean;
  forwardedTrayId?: string;
  chainTrayId?: string;
  sourceTrayId?: string;
  rootTrayId?: string;
  chainDepth?: number;
  chainTimerDuration?: number;
  chainParticipants?: string[];
  mintedBase?: { mintedAt: number; baseTx: string | null; baseTokenId: string | number | null } | null;
  savedGnosis?: { savedAt: number; gnosisTx: string | null } | null;
  recipientForwarded?: boolean;
  sourceMintedBase?: boolean;
  reroutedAt?: number | null;
  pinnedURI?: string | null;
  coverNote?: string;
}

interface RelaySuggestion {
  handle: string;
  wallet: string;
  collection: string;
}

type TabKey = 'inbox' | 'sent' | 'saved' | 'minted';

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

interface InTrayProps {
  local: string;
  wallet: string;
  domain?: string;
  rolofaxOptions?: { handle: string; collection: string }[];
  /**
   * Returns the connected wallet's EIP-1193 provider (e.g. Privy's
   * `activeWallet.getEthereumProvider()`). Falling back to `window.ethereum`
   * is wrong when the connected wallet is managed by Privy (embedded wallet,
   * or an external wallet not injected as `window.ethereum`) — the mint
   * button would silently skip the on-chain transaction and record
   * off-chain only, with no wallet prompt.
   */
  getEthereumProvider?: () => Promise<Eip1193Provider>;
}

function formatCountdown(msLeftToJam: number): string {
  if (msLeftToJam <= 0) return 'LINE JAMMED';
  const d = Math.floor(msLeftToJam / 86_400_000);
  const h = Math.floor((msLeftToJam % 86_400_000) / 3_600_000);
  const m = Math.floor((msLeftToJam % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function FaxThumb({ id, encrypted, elapsed, jammed, className = 'h-40', overrideSrc, href, jamMs = DEFAULT_JAM_MS, zoom = 1 }: { id: string; encrypted?: boolean; elapsed: number; jammed?: boolean; className?: string; overrideSrc?: string; href?: string; jamMs?: number; zoom?: number }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (encrypted || overrideSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tray/${id}`, { cache: 'no-store' });
        const data = await res.json() as { dataBase64?: string; format?: string };
        if (!cancelled && data.dataBase64) {
          setSrc(`data:image/${data.format || 'png'};base64,${data.dataBase64}`);
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, encrypted, overrideSrc]);

  // A composite preview overrides the fetched bitmap and renders at full
  // colour inside the same fax frame.
  if (overrideSrc) {
    return (
      <div className={`w-full overflow-auto bg-[#e7e0d1] ${className}`} style={{ cursor: zoom > 1 ? 'grab' : 'default' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={overrideSrc} alt={`Composite ${id}`} className="h-full w-full object-contain" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }} />
      </div>
    );
  }

  if (encrypted) {
    return (
      <div className={`grid w-full place-items-center bg-[#25251f] text-[#8a836f] ${className}`}>
        <div className="text-center"><Lock size={22} className="mx-auto mb-1" /><p className="text-[11px] uppercase tracking-widest">Encrypted · view in console</p></div>
      </div>
    );
  }
  if (failed) {
    return <div className={`grid w-full place-items-center bg-[#d5cebf] text-[11px] uppercase text-[#6e685a] ${className}`}>No preview</div>;
  }
  if (!src) {
    return <div className={`grid w-full place-items-center bg-[#e7e0d1] ${className}`}><Loader2 className="animate-spin text-[#847d6e]" size={18} /></div>;
  }
  const thumb = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`Fax ${id}`} className="h-full w-full object-contain" />
  );
  return (
    <div className={`w-full overflow-hidden bg-[#e7e0d1] ${className}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block h-full w-full">
          {thumb}
        </a>
      ) : thumb}
    </div>
  );
}

export default function InTray({ local, wallet, domain = 'nftmail.box', rolofaxOptions = [], getEthereumProvider }: InTrayProps) {
  const [faxes, setFaxes] = useState<InboxFax[]>([]);
  const [sentFaxes, setSentFaxes] = useState<InboxFax[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('inbox');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState('');
  const [forwardFor, setForwardFor] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [forwardedTrayId, setForwardedTrayId] = useState('');
  const [forwardFileName, setForwardFileName] = useState('');
  const [forwardCoverNote, setForwardCoverNote] = useState('');
  const [baseSrc, setBaseSrc] = useState('');
  const [overlaySrc, setOverlaySrc] = useState('');
  const [chainOp, setChainOp] = useState<ChainOp>('ghost');
  const [negative, setNegative] = useState(false);
  const [compositeBase64, setCompositeBase64] = useState('');
  const [compositePreview, setCompositePreview] = useState('');
  const [compositeFormat, setCompositeFormat] = useState<'png' | 'jpg'>('jpg');
  const [compositing, setCompositing] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [overlayPlacement, setOverlayPlacement] = useState<OverlayPlacement>(DEFAULT_PLACEMENT);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<InboxFax | null>(null);
  const [relaySuggestions, setRelaySuggestions] = useState<RelaySuggestion[]>([]);
  const [rerouteTo, setRerouteTo] = useState('');
  const [showReroute, setShowReroute] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [forwardError, setForwardError] = useState('');
  const [replyFor, setReplyFor] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [replyFileName, setReplyFileName] = useState('');
  const [replyBase64, setReplyBase64] = useState('');
  const [replyPreview, setReplyPreview] = useState('');
  const [replyError, setReplyError] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyCoverNote, setReplyCoverNote] = useState('');
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const cleanLocal = useMemo(() => local.trim().toLowerCase().replace(/@nftmail\.box$/, '').replace(/@fax$/, ''), [local]);
  const effectiveDomain = useMemo(() => domain.trim().toLowerCase() || 'nftmail.box', [domain]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingActions = useRef(new Map<string, { promise: Promise<void>; resolve: () => void }>());

  const load = useCallback(async () => {
    if (!cleanLocal || !wallet) return;
    setLoading(true);
    setError('');
    try {
      const [inboxRes, sentRes, creditsRes] = await Promise.all([
        fetch(`/api/tray/inbox?local=${encodeURIComponent(cleanLocal)}&wallet=${encodeURIComponent(wallet)}&domain=${encodeURIComponent(effectiveDomain)}`, { cache: 'no-store' }),
        fetch(`/api/tray/sent?local=${encodeURIComponent(cleanLocal)}&wallet=${encodeURIComponent(wallet)}&domain=${encodeURIComponent(effectiveDomain)}`, { cache: 'no-store' }),
        fetch(`/api/tray/credits?local=${encodeURIComponent(cleanLocal)}&wallet=${encodeURIComponent(wallet)}&domain=${encodeURIComponent(effectiveDomain)}`, { cache: 'no-store' }),
      ]);
      const inboxData = await inboxRes.json() as { faxes?: InboxFax[]; error?: string };
      if (!inboxRes.ok) throw new Error(inboxData.error || 'Could not load fax-tray');
      setFaxes(inboxData.faxes || []);
      if (sentRes.ok) {
        const sentData = await sentRes.json() as { faxes?: InboxFax[] };
        setSentFaxes(sentData.faxes || []);
      }
      if (creditsRes.ok) {
        const creditData = await creditsRes.json() as { credits?: number };
        setCredits(typeof creditData.credits === 'number' ? creditData.credits : null);
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load fax-tray');
    } finally {
      setLoading(false);
    }
  }, [cleanLocal, wallet, effectiveDomain]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function resetForward() {
    setForwardFor('');
    setForwardTo('');
    setForwardFileName('');
    setOverlaySrc('');
    setChainOp('ghost');
    setNegative(false);
    setOverlayPlacement(DEFAULT_PLACEMENT);
    setCompositeBase64('');
    setCompositePreview('');
    setCompositeFormat('jpg');
    setCompositing(false);
    setPreviewZoom(1);
    setForwardError('');
    setForwardCoverNote('');
  }

  // Load the selected fax bitmap so it can be used as the compositing base.
  useEffect(() => {
    if (!selected || selected.encrypted) { setBaseSrc(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tray/${selected.id}`, { cache: 'no-store' });
        const data = await res.json() as { dataBase64?: string; format?: string };
        if (!cancelled && data.dataBase64) setBaseSrc(`data:image/${data.format || 'png'};base64,${data.dataBase64}`);
      } catch { /* preview only */ }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Recompute the composite whenever the overlay, operation, placement, negative toggle, or base changes.
  useEffect(() => {
    if (!overlaySrc || !baseSrc) { setCompositeBase64(''); setCompositePreview(''); return; }
    let cancelled = false;
    setCompositing(true);
    (async () => {
      try {
        const result = await compositeChain(baseSrc, overlaySrc, chainOp, negative, overlayPlacement);
        if (!cancelled) { setCompositeBase64(result.base64); setCompositePreview(result.preview); setCompositeFormat(result.format); }
      } catch (cause: unknown) {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : 'Compositing failed.');
      } finally {
        if (!cancelled) setCompositing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [overlaySrc, baseSrc, chainOp, negative, overlayPlacement]);

  function selectForwardFile(file: File) {
    setNotice('');
    setOverlayPlacement(DEFAULT_PLACEMENT);
    const reader = new FileReader();
    reader.onload = () => { setOverlaySrc(String(reader.result || '')); setForwardFileName(file.name); };
    reader.onerror = () => setNotice('Could not read the selected image.');
    reader.readAsDataURL(file);
  }

  async function forward(fax: InboxFax) {
    if (!forwardTo.includes('@')) { setForwardError('Enter a valid recipient address.'); return; }
    if (overlaySrc && !compositeBase64) { setForwardError('Still compositing your image — try again in a moment.'); return; }
    if ((credits ?? 0) <= 0) { setForwardError('No send credits. Forwarding a fax costs 1 credit.'); setNotice('No send credits. Forwarding a fax costs 1 credit.'); return; }
    setBusyId(fax.id);
    setNotice('');
    setForwardError('');
    try {
      const payload: Record<string, string> = {
        fromLabel: cleanLocal,
        fromDomain: effectiveDomain,
        ownerWallet: wallet,
        to: forwardTo.trim(),
        chainTrayId: fax.id,
        sourceChainDepth: String(fax.chainDepth || 1),
        sourceMintedBase: String(!!fax.mintedBase),
      };
      if (compositeBase64) {
        payload.format = compositeFormat;
        payload.dataBase64 = compositeBase64;
      }
      if (forwardCoverNote.trim()) {
        payload.coverNote = forwardCoverNote.trim().slice(0, 140);
      }
      const res = await fetch('/api/tray/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { error?: string; id?: string };
      if (!res.ok) throw new Error(data.error || 'Forward failed');
      if (data.id) setForwardedTrayId(data.id);
      setNotice(compositeBase64 ? 'Chain extended — your link was composited and forwarded.' : 'Chain forwarded — Base mint unlocked.');
      setSelected((prev) => prev ? { ...prev, forwarded: true, forwardedTrayId: data.id } : prev);
      resetForward();
      await load();
      // Best-effort IPFS+Arweave pin now that the fax is finalized. Pins
      // data.id (the NEW tray just created for the next recipient) — that's
      // the player's own composited hop, i.e. the artwork the collectible
      // should represent. fax.id (the received fax) is only used on-chain as
      // the ownership/provenance trayId argument — see act()'s mint path.
      // Non-fatal: if pinning fails, mint will fall back to baseURI.
      if (data.id) {
        pinFaxMetadata(data.id, cleanLocal).then((uri) => {
          if (uri) {
            setSelected((prev) => prev ? { ...prev, pinnedURI: uri } : prev);
          }
        }).catch(() => { /* non-fatal */ });
      }
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : 'Forward failed';
      setForwardError(msg);
      setNotice(msg);
    } finally {
      setBusyId('');
    }
  }

  function resetReply() {
    setReplyFor('');
    setReplyTo('');
    setReplyFileName('');
    setReplyBase64('');
    setReplyPreview('');
    setReplyError('');
    setReplyBusy(false);
    setReplyCoverNote('');
  }

  function selectReplyFile(file: File) {
    setReplyError('');
    (async () => {
      try {
        const prepared = await prepareImage(file);
        setReplyBase64(prepared.base64);
        setReplyPreview(prepared.preview);
        setReplyFileName(file.name);
      } catch (cause: unknown) {
        setReplyError(cause instanceof Error ? cause.message : 'Image processing failed.');
      }
    })();
  }

  // Reply starts a brand-new chain addressed back to the original sender —
  // it is the same plain "send" used to originate a fax, so it never touches
  // the source fax's chainTrayId, hop credits, or decay timer.
  async function sendReply(fax: InboxFax) {
    if (!replyTo.includes('@')) { setReplyError('Enter a valid recipient address.'); return; }
    if (!replyBase64) { setReplyError('Add an image to send.'); return; }
    setReplyBusy(true);
    setReplyError('');
    setNotice('');
    try {
      const res = await fetch('/api/tray/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLabel: cleanLocal,
          fromDomain: effectiveDomain,
          ownerWallet: wallet,
          to: replyTo.trim(),
          format: 'jpg',
          dataBase64: replyBase64,
          colorMode: 'greyscale',
          ...(replyCoverNote.trim() ? { coverNote: replyCoverNote.trim().slice(0, 140) } : {}),
        }),
      });
      const data = await res.json() as { error?: string; id?: string };
      if (!res.ok) throw new Error(data.error || 'Reply failed');
      setNotice('Reply sent as a new chain.');
      resetReply();
      await load();
    } catch (cause: unknown) {
      const msg = cause instanceof Error ? cause.message : 'Reply failed';
      setReplyError(msg);
    } finally {
      setReplyBusy(false);
    }
  }

  async function act(fax: InboxFax, kind: 'mint' | 'save') {
    // Mint and Save both act on the fax the CALLER received, not the one they
    // forwarded onward — the ownership check (/api/tray/inbox) only recognizes
    // The tray ID used for API calls (ownership verification). On the Sent
    // tab, the mint/save API searches the caller's inbox for this ID, so it
    // must be the RECEIVED fax (fax.sourceTrayId), not the sent fax.
    // On the Inbox/Saved tab, fax.id is the received fax in the inbox.
    const targetId = activeTab === 'sent' ? (fax.sourceTrayId || fax.id) : fax.id;
    if (kind === 'mint' && (credits ?? 0) <= 0) {
      setNotice('No send credits. Minting a fax costs 1 credit.');
      return;
    }
    const pendingKey = `${kind}:${targetId}`;
    const existing = pendingActions.current.get(pendingKey);
    if (existing) {
      setBusyId(fax.id);
      try {
        await existing.promise;
      } finally {
        setBusyId('');
      }
      return;
    }
    let resolve!: () => void;
    const pending = new Promise<void>((res) => { resolve = res; });
    pendingActions.current.set(pendingKey, { promise: pending, resolve });
    setBusyId(fax.id);
    setNotice('');
    try {
      const cfg = kind === 'mint' ? MINT_CONFIG : SAVE_CONFIG;
      const placeholder = isPlaceholderAddress(cfg.contract);
      let txHash: string | null = null;

      // Resolve a wallet provider, preferring Privy's active wallet and
      // falling back to the injected one (MetaMask).
      //
      // The timeout matters as much as the catch: if a malformed EIP-6963
      // announcement wedges wagmi/mipd's provider store (see the guard in
      // layout.tsx), getEthereumProvider() can never settle at all — not
      // reject. Awaiting it bare then hangs the mint forever with the button
      // stuck busy, no MetaMask prompt, and no error to show the user.
      let provider: Eip1193Provider | undefined;
      if (getEthereumProvider) {
        provider = await Promise.race([
          getEthereumProvider().catch(() => undefined),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PROVIDER_TIMEOUT_MS)),
        ]);
      }
      if (!provider && typeof window !== 'undefined') {
        provider = (window as { ethereum?: Eip1193Provider }).ethereum ?? undefined;
        if (provider) console.warn('[fax] Privy provider unavailable — using window.ethereum');
      }
      if (provider && !placeholder) {
        await switchToChain(provider, cfg.chain);
      }

      if (kind === 'mint' && provider && !placeholder) {
        // Pre-mint check: detect EIP-7702 smart accounts (MetaMask DeleGators)
        // and verify they have enough ETH to cover the mint fee + gas. This
        // catches the problem BEFORE MetaMask shows a popup, so the user sees
        // a clear message instead of a cryptic Panic(0x11) after confirming.
        // Smart accounts route value-bearing txs through redeemDelegations,
        // which fails with Panic(0x11) due to a NativeBalanceChangeEnforcer
        // gas-reserve underflow bug in MetaMask's delegation framework.
        const smartWalletError = await checkSmartWalletMintEligibility(provider, wallet, MINT_CONFIG.chain.rpcUrl);
        if (smartWalletError) throw new Error(smartWalletError);
        // The ARTWORK/metadata must reflect the fax the caller forwarded onward
        // (their own composited hop), not the received fax — minting is only
        // unlocked after forwarding, so the collectible should represent what
        // the player actually contributed.
        // On the Sent tab, fax.id IS the forwarded hop (the sent fax itself).
        // On the Inbox/Saved tab, fax.forwardedTrayId is the forwarded hop.
        const mintTrayId = activeTab === 'sent' ? fax.id : (fax.forwardedTrayId || fax.id);
        let tokenURI = fax.pinnedURI || undefined;
        if (!tokenURI) {
          tokenURI = await pinFaxMetadata(mintTrayId, cleanLocal).catch(() => null) || undefined;
        }
        // The mint always identifies the token via the CALLER's own mailbox
        // identity (cleanLocal) — the fax being minted is always one the caller
        // received and forwarded. On the Sent tab, fax.to is the downstream
        // recipient the caller forwarded to, not the caller themselves, so it
        // must not be used here.
        const tx = await buildMintTx({ local: cleanLocal, connectedWallet: wallet, trayId: mintTrayId, rootTrayId: fax.rootTrayId, tokenURI });
        if (tx.error) throw new Error(tx.error);
        const sent = await sendMintTx(provider, wallet, tx);
        if (sent.error) throw new Error(sent.error);
        if (!sent.txHash) throw new Error('Wallet did not return a transaction hash.');
        txHash = sent.txHash;
      } else if (kind === 'mint' && !provider && !placeholder) {
        throw new Error('No wallet available. Connect an EVM wallet (MetaMask) to mint to Base.');
      }

      if (kind === 'save') {
        // Gasless-first Save to Gnosis: server-side relayer pays the xDAI gas.
        // Same artwork-identity rule as mint above — prefer the forwarded hop.
        const saveTrayId = activeTab === 'sent' ? fax.id : (fax.forwardedTrayId || fax.id);
        let tokenURI = fax.pinnedURI || undefined;
        if (!tokenURI) {
          tokenURI = await pinFaxMetadata(saveTrayId, cleanLocal).catch(() => null) || undefined;
        }
        if (!tokenURI) throw new Error('Could not pin fax metadata for saving.');

        // Try gasless relayer first.
        const gaslessRes = await fetch(`/api/tray/${targetId}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            local: cleanLocal,
            domain: effectiveDomain,
            ownerWallet: wallet,
            gasless: true,
            tokenURI,
          }),
        });
        if (gaslessRes.ok) {
          txHash = 'gasless'; // marker only; actual tx recorded by the server
        } else {
          const gaslessErr = await gaslessRes.json().catch(() => ({ error: 'Gasless save failed' })) as { error?: string };
          const needsWalletFallback = /relayer not configured|daily gasless save cap reached/i.test(gaslessErr.error || '');
          if (!needsWalletFallback) throw new Error(gaslessErr.error || 'Gasless save failed');

          // Fallback: wallet-signed on-chain Gnosis save via FaxTray contract.
          if (!provider || placeholder) throw new Error(gaslessErr.error || 'Gasless save unavailable and wallet not connected.');
          await switchToChain(provider, cfg.chain);
          const saveData = encodeSaveFax(wallet, targetId, tokenURI);
          const sent = await sendMintTx(provider, wallet, { to: cfg.contract, data: saveData, value: '0x0', chainId: cfg.chain.hexId, rpcUrl: cfg.chain.rpcUrl });
          if (sent.error) throw new Error(sent.error);
          if (!sent.txHash) throw new Error('Wallet did not return a transaction hash.');
          txHash = sent.txHash;
        }
      }

      // For gasless saves, the server already recorded the on-chain tx; skip the second POST.
      if (kind === 'save' && txHash === 'gasless') {
        setNotice('Saved to Gnosis — permanence anchored (gasless).');
        await load();
        return;
      }

      const res = await fetch(`/api/tray/${targetId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local: cleanLocal,
          domain: effectiveDomain,
          ownerWallet: wallet,
          chainId: cfg.chain.id,
          contract: cfg.contract,
          ...(kind === 'mint' ? { baseTx: txHash } : { gnosisTx: txHash }),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || `${kind} failed`);
      if (placeholder) {
        setNotice(kind === 'mint'
          ? `Recorded off-chain — ${cfg.chain.name} mint contract not deployed yet (placeholder).`
          : `Rescued from decay — ${cfg.chain.name} archive contract not deployed yet (placeholder).`);
      } else {
        setNotice(kind === 'mint' ? 'Minted to Base — collectible recorded.' : 'Saved to Gnosis — permanence anchored.');
      }
      await load();
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : `${kind} failed`);
    } finally {
      setBusyId('');
      pendingActions.current.delete(pendingKey);
      resolve();
    }
  }

  function openDetail(fax: InboxFax) {
    setSelected(fax);
    setBusyId('');
    resetForward();
    resetReply();
    setForwardedTrayId('');
    setShowReroute(false);
    setRelaySuggestions([]);
    setRerouteTo('');
  }

  async function deleteFax(fax: InboxFax) {
    setBusyId(fax.id);
    setNotice('');
    try {
      const res = await fetch(`/api/tray/${fax.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ local: cleanLocal, ownerWallet: wallet }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setNotice('Fax deleted from tray.');
      setSelected(null);
      await load();
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : 'Delete failed');
    } finally {
      setBusyId('');
    }
  }

  async function fetchRelaySuggestions(fax: InboxFax) {
    try {
      const res = await fetch(`/api/tray/relay-suggest?chainTrayId=${encodeURIComponent(fax.chainTrayId || fax.id)}&excludeRecipient=${encodeURIComponent(fax.to || '')}&excludeSender=${encodeURIComponent(cleanLocal)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { suggestions?: RelaySuggestion[] };
        setRelaySuggestions(data.suggestions || []);
      }
    } catch { /* non-fatal */ }
  }

  async function reroute(fax: InboxFax) {
    if (!rerouteTo.includes('@')) { setNotice('Enter a valid recipient address.'); return; }
    setBusyId(fax.id);
    setNotice('');
    try {
      const res = await fetch(`/api/tray/${fax.id}/reroute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLabel: fax.from || cleanLocal,
          ownerWallet: wallet,
          to: rerouteTo.trim(),
          chainTrayId: fax.chainTrayId || fax.id,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Re-route failed');
      setNotice(`Re-routed to ${rerouteTo.trim()} — original recipient's mint disabled.`);
      setShowReroute(false);
      setRerouteTo('');
      setSelected(null);
      await load();
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : 'Re-route failed');
    } finally {
      setBusyId('');
    }
  }

  const mintLimitAlert = useMemo(() => {
    const identity = parseFaxIdentity(cleanLocal);
    const notice = identity ? MINT_LIMIT_NOTICE[identity.collection] : null;
    // Only count this user's own mints, not upstream source mints.
    const hasMinted = faxes.some((f) => f.mintedBase) || sentFaxes.some((f) => f.mintedBase);
    return notice ? { notice, hasMinted } : null;
  }, [cleanLocal, faxes, sentFaxes]);

  const sentMintedIds = useMemo(() => new Set(
    sentFaxes.filter((f) => f.mintedBase).map((f) => f.id),
  ), [sentFaxes]);

  const displayedFaxes: InboxFax[] = useMemo(() => {
    if (activeTab === 'sent') return sentFaxes;
    if (activeTab === 'saved') return faxes.filter((f) => f.savedGnosis);
    if (activeTab === 'minted') {
      const inboxMinted = faxes.filter((f) => f.mintedBase);
      const inboxMintedIds = new Set(inboxMinted.map((f) => f.id));
      const sentMinted = sentFaxes.filter((f) => f.mintedBase && !inboxMintedIds.has(f.id));
      return [...inboxMinted, ...sentMinted];
    }
    // Fax-Tray: show all received faxes (forwarded/minted retained with status badges)
    return faxes.filter((f) => !f.savedGnosis);
  }, [activeTab, faxes, sentFaxes, sentMintedIds]);

  if (!cleanLocal || !wallet) {
    return (
      <div className="grid min-h-[220px] place-items-center border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center">
        <div><LayersArrowDown size={26} className="mx-auto mb-3 text-[#847d6e]" /><p className="font-bold uppercase">CONNECT + ADD YOUR FAX HANDLE TO THE ROLOFAX</p><p className="mt-2 text-[12px] uppercase tracking-wider text-[#696457]">Start a Chain, Fax an image to a player in the Rolofax. CHECK YOUR FAX-TRAY, YOU'VE GOT FAX?</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black uppercase">Tray</h2>
        </div>
        <div className="flex items-center gap-3">
          {credits !== null && (
            <span className="border border-[#77705f] bg-[#d8d0bf] px-2 py-2 text-[12px] font-bold uppercase text-[#615c50]">Send credits: {credits}/{MAX_CREDITS}</span>
          )}
          <button onClick={() => void load()} disabled={loading} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[12px] font-bold uppercase disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin" size={13} /> : 'Refresh'}
          </button>
        </div>
      </div>

      {mintLimitAlert && (
        <div className={`mb-4 border-l-4 p-3 text-[12px] font-bold uppercase ${mintLimitAlert.hasMinted ? 'border-[#a94228] bg-[#e2c9bc] text-[#a94228]' : 'border-[#26417d] bg-[#d3ddf2] text-[#26417d]'}`}>{mintLimitAlert.notice}</div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-[#8f8878]">
        {([['inbox', `in-Tray (${faxes.filter(f => !f.savedGnosis).length})`], ['sent', `Sent (${sentFaxes.length})`], ['saved', `Saved (${faxes.filter(f => f.savedGnosis).length})`], ['minted', `Minted (${faxes.filter(f => f.mintedBase).length + sentMintedIds.size})`]] as [TabKey, string][]).map(([key, label]) => (
          <button key={key} onClick={() => { setActiveTab(key); setNotice(''); }} className={`px-4 py-2 text-[12px] font-bold uppercase tracking-wider transition ${activeTab === key ? 'border-b-2 border-[#e65b2f] text-[#25251f]' : 'text-[#615c50] hover:text-[#4a4638]'}`}>
            {label}
          </button>
        ))}
      </div>

      {notice && <div className="mb-4 border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold uppercase">{notice}</div>}
      {error && <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase">FAULT: {error}</div>}

      {!loading && displayedFaxes.length === 0 && (
        <div className="grid min-h-[180px] place-items-center border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center">
          <div><Clock size={24} className="mx-auto mb-3 text-[#847d6e]" /><p className="font-bold uppercase">{activeTab === 'inbox' ? 'Tray empty' : activeTab === 'sent' ? 'Nothing sent' : activeTab === 'saved' ? 'Nothing saved' : 'Nothing minted'}</p><p className="mt-2 text-[12px] uppercase tracking-wider text-[#696457]">{activeTab === 'inbox' ? 'Received faxes appear here and fade after 8 days unless saved.' : ''}</p></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-[75%]">
        {displayedFaxes.map((fax) => {
          const sourceMinted = !!fax.sourceMintedBase;
          const chainDepth = fax.chainDepth || 1;
          const jamMs = fax.chainTimerDuration || getChainTimerMs(chainDepth, sourceMinted) || DEFAULT_JAM_MS;
          const elapsed = now - fax.createdAt;
          const msLeftToJam = jamMs - elapsed;
          const permanent = !!fax.savedGnosis || !!fax.mintedBase;
          const isDead = chainDepth > 11;
          const jammed = activeTab === 'inbox' && !permanent && (isDead || elapsed > jamMs);
          const canForward = activeTab !== 'sent' && !permanent && !jammed && !fax.forwarded && !fax.encrypted;
          return (
            <div key={fax.id} onClick={() => openDetail(fax)} className="machine-shadow cursor-pointer overflow-hidden border border-[#8f8878] bg-[#c8c0ae] hover:ring-2 hover:ring-[#e65b2f]">
              <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-3 py-2 text-[11px] font-bold uppercase tracking-[.14em]">
                <span title={`T/#${fax.id.toUpperCase()}`}>T/#{fax.id.slice(0, 3).toUpperCase()}…</span>
                <div className="flex items-center gap-2">
                  {canForward && <span className="text-[#e65b2f] underline">FORWARD</span>}
                  <span className={permanent ? 'text-[#456049]' : jammed ? 'text-[#a94228]' : 'text-[#615c50]'}>
                    {permanent ? 'PERMANENT' : formatCountdown(msLeftToJam)}
                  </span>
                </div>
              </div>

              <div className="relative">
                <FaxThumb id={fax.id} encrypted={fax.encrypted} elapsed={permanent ? 0 : elapsed} jammed={jammed} jamMs={jamMs} href={`https://nftmail.box/tray/${fax.id}`} />
                {jammed && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="bg-[#f4f2ed]/80 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-[#a94228]">LINE JAMMED</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 p-3">
                <p className="truncate text-[12px] font-bold uppercase text-[#4a4638]">{activeTab === 'sent' && fax.sourceTrayId ? `Fwd from T/#${fax.sourceTrayId.toUpperCase()}` : activeTab === 'sent' ? `To: ${fax.to || '?'}` : `From: ${fax.from}`}</p>
                <div className="flex flex-wrap gap-1">
                  {fax.forwarded && <span className="border border-[#7fa178] bg-[#dbe6d6] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#3d5a40]">Forwarded</span>}
                  {fax.mintedBase && <span className="border border-[#3d6fd6] bg-[#d3ddf2] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#26417d]">Base</span>}
                  {fax.savedGnosis && <span className="border border-[#c08a2f] bg-[#f0e4cd] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#7a5a15]">Gnosis</span>}
                  {fax.sourceMintedBase && <span className="border border-[#3d6fd6] bg-[#d3ddf2] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#26417d]">Source Minted</span>}
                  {fax.chainDepth && fax.chainDepth > 1 && <span className="border border-[#7a6a5a] bg-[#e3dcc8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#5a4d3e]">Link {fax.chainDepth}</span>}
                  {jamMs < DEFAULT_JAM_MS && !permanent && !jammed && <span className="border border-[#b85a2f] bg-[#f5dcc8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#8a3e1e]">Timer {jamMs < 60 * 60 * 1000 ? Math.round(jamMs / 60000) + 'm' : Math.round(jamMs / 3.6e6) + 'h'}</span>}
                  {activeTab === 'sent' && fax.recipientForwarded && <span className="border border-[#7fa178] bg-[#dbe6d6] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#3d5a40]">Recipient forwarded</span>}
                  {activeTab === 'sent' && fax.reroutedAt && <span className="border border-[#b85a2f] bg-[#f5dcc8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#8a3e1e]">Re-routed</span>}
                </div>
                {activeTab === 'sent' && !fax.recipientForwarded && !fax.reroutedAt && !fax.encrypted && (() => {
                  const sentElapsed = now - fax.createdAt;
                  const relayWindowMs = 24 * 60 * 60 * 1000;
                  if (sentElapsed >= relayWindowMs) {
                    return <p className="text-[11px] uppercase tracking-wide text-[#b85a2f]">⚡ Relay window open — click to re-route</p>;
                  } else {
                    const remaining = Math.ceil((relayWindowMs - sentElapsed) / (60 * 60 * 1000));
                    return <p className="text-[11px] uppercase tracking-wide text-[#6e685a]">Relay opens in {remaining}h</p>;
                  }
                })()}
                {activeTab === 'inbox' && !permanent && !jammed && !fax.forwarded && !fax.encrypted && <p className="text-[11px] uppercase tracking-wide text-[#6e685a]">Forward to unlock Base mint</p>}
                {activeTab === 'inbox' && !permanent && jammed && !fax.encrypted && <p className="text-[11px] uppercase tracking-wide text-[#a94228]">LINE JAMMED — start a new chain with {fax.from}</p>}
                {activeTab === 'inbox' && !permanent && jammed && !fax.encrypted && (
                  <button onClick={(e) => { e.stopPropagation(); void deleteFax(fax); }} disabled={busyId === fax.id} className="text-[11px] font-bold uppercase text-[#a94228] underline hover:text-[#c0392b] disabled:opacity-50">
                    {busyId === fax.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
                {activeTab === 'sent' && fax.forwarded && !fax.mintedBase && <p className="text-[11px] uppercase tracking-wide text-[#26417d]">Mint available — click to mint</p>}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#25251f]/80 p-4" onClick={() => { resetForward(); resetReply(); setSelected(null); setNotice(''); }}>
          <div className="machine-shadow flex h-[75vh] w-[75vw] flex-col overflow-hidden border border-[#8f8878] bg-[#c8c0ae]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.24em] text-[#615c50]">Transmission detail</p>
                <h3 className="text-lg font-black uppercase">T/#{selected.id.toUpperCase()}</h3>
              </div>
              <button onClick={() => { resetForward(); resetReply(); setSelected(null); setNotice(''); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] p-2"><X size={16} /></button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[1.2fr_1fr]">
              {/* Left: the fax (or live composite preview) */}
              <div className="flex min-h-0 flex-col border-b border-[#918978] bg-[#e7e0d1] p-4 lg:border-b-0 lg:border-r">
                {(() => {
                  const forwardedId = forwardedTrayId;
                  const showForwardedImage = !compositePreview && !!forwardedId && !selected.mintedBase && !selected.savedGnosis;
                  const displayId = showForwardedImage ? forwardedId : selected.id;
                  const isForwardedImage = showForwardedImage;
                  return (
                    <>
                      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#e7e0d1]">
                        <FaxThumb
                          id={displayId}
                          encrypted={compositePreview ? false : selected.encrypted}
                          elapsed={compositePreview ? 0 : isForwardedImage ? 0 : now - selected.createdAt}
                          jammed={activeTab === 'inbox' && !compositePreview && !isForwardedImage && !selected.savedGnosis && !selected.mintedBase && (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase))}
                          overrideSrc={compositePreview || undefined}
                          className="h-full"
                          zoom={previewZoom}
                        />
                        {compositing && <div className="absolute inset-0 grid place-items-center bg-[#e7e0d1]/80"><Loader2 className="animate-spin" /></div>}
                        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded border border-[#847d6e] bg-[#c8c0ae]/90 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={() => setPreviewZoom((z) => Math.max(1, z - 0.25))}
                            className="text-[#4a4638] hover:text-[#e65b2f] disabled:opacity-30"
                            disabled={previewZoom <= 1}
                          >
                            <ZoomOut size={14} />
                          </button>
                          <span className="text-[10px] font-bold tabular-nums text-[#4a4638]">{Math.round(previewZoom * 100)}%</span>
                          <button
                            type="button"
                            onClick={() => setPreviewZoom((z) => Math.min(4, z + 0.25))}
                            className="text-[#4a4638] hover:text-[#e65b2f] disabled:opacity-30"
                            disabled={previewZoom >= 4}
                          >
                            <ZoomIn size={14} />
                          </button>
                        </div>
                      </div>
                      {compositePreview ? (
                        <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#7a5a15]">Live composite · {CHAIN_OPS.find((o) => o.id === chainOp)?.label} operation</p>
                      ) : isForwardedImage ? (
                        <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#26417d]">Forwarded link · T/#{displayId.toUpperCase()} · mint/save this image</p>
                      ) : null}
                    </>
                  );
                })()}
              </div>

              {/* Right: metadata + actions + chain builder */}
              <div className="min-h-0 overflow-auto bg-[#bbb3a2] p-5">
                <div className="mb-5 grid gap-1.5 text-[12px] font-bold uppercase text-[#4a4638]">
                  <p>{activeTab === 'sent' && selected.forwarded ? `Forwarded from: ${selected.from}` : activeTab === 'sent' ? `To: ${selected.to || '?'}` : `From: ${selected.from}`}</p>
                  <p>{activeTab === 'sent' && selected.forwarded ? 'Forwarded' : activeTab === 'sent' ? 'Sent' : 'Received'}: {formatDate(selected.createdAt)}</p>
                  {selected.chainDepth && selected.chainDepth > 1 && <p className="flex items-center gap-1 text-[#5a4d3e]"><Link2 size={12} /> Chain link {selected.chainDepth}</p>}
                  {selected.chainTrayId && <p className="text-[#6e685a]">Previous link: T/#{selected.chainTrayId.toUpperCase()}</p>}
                  {activeTab === 'sent' && selected.recipientForwarded && <p className="text-[#3d5a40]">✓ Recipient forwarded this fax</p>}
                  {activeTab === 'sent' && selected.reroutedAt && <p className="text-[#8a3e1e]">⚡ Re-routed at {formatDate(selected.reroutedAt)}</p>}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {selected.forwarded && <span className="border border-[#7fa178] bg-[#dbe6d6] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#3d5a40]">Forwarded</span>}
                    {selected.mintedBase && <span className="border border-[#3d6fd6] bg-[#d3ddf2] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#26417d]">Base</span>}
                    {selected.savedGnosis && <span className="border border-[#c08a2f] bg-[#f0e4cd] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#7a5a15]">Gnosis</span>}
                  </div>
                </div>

                {selected.coverNote && (
                  <div className="mb-5 border-l-4 border-[#8f8878] bg-[#e7e0d1] p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#6e685a]">Cover note</p>
                    <p className="text-[12px] font-normal normal-case text-[#3a362c]">{selected.coverNote}</p>
                  </div>
                )}

                {/* Re-route panel for sent faxes (relay window) */}
                {activeTab === 'sent' && !selected.recipientForwarded && !selected.reroutedAt && !selected.encrypted && (() => {
                  const sentElapsed = now - selected.createdAt;
                  const relayWindowMs = 24 * 60 * 60 * 1000;
                  const relayOpen = sentElapsed >= relayWindowMs;
                  if (!relayOpen) {
                    const remaining = Math.ceil((relayWindowMs - sentElapsed) / (60 * 60 * 1000));
                    return (
                      <div className="mb-5 border-l-4 border-[#8f8878] bg-[#e7e0d1] p-3 text-[12px] font-bold uppercase text-[#6e685a]">
                        Relay window opens in {remaining}h. If the recipient hasn't forwarded by then, you can re-route this fax to a new player.
                      </div>
                    );
                  }
                  return (
                    <div className="mb-5 border-2 border-[#b85a2f] bg-[#f5dcc8] p-4">
                      <p className="mb-3 text-[12px] font-bold uppercase tracking-[.14em] text-[#8a3e1e]">⚡ Relay window open</p>
                      <p className="mb-3 text-[12px] text-[#4a4638]">The recipient hasn't forwarded this fax. Re-route it to a new player to keep the chain alive. The original recipient can still forward but their mint is disabled.</p>
                      {!showReroute ? (
                        <button onClick={() => { setShowReroute(true); void fetchRelaySuggestions(selected); }} className="key-shadow w-full border border-[#983b21] bg-[#e65b2f] px-3 py-3 text-[12px] font-black uppercase text-white">
                          Re-route this fax
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <input
                            value={rerouteTo}
                            onChange={(e) => setRerouteTo(e.target.value)}
                            placeholder="newplayer@nftmail.box or newplayer@fax"
                            className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                          />
                          {relaySuggestions.length > 0 && (
                            <div>
                              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#6e685a]">Suggested from Rolofax</p>
                              <div className="flex flex-wrap gap-1">
                                {relaySuggestions.map((s) => (
                                  <button key={s.handle} onClick={() => setRerouteTo(`${s.handle}@fax`)} className="border border-[#77705f] bg-[#d8d0bf] px-2 py-1 text-[11px] font-bold uppercase hover:bg-[#eee8dc]">
                                    {s.handle}@fax
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button onClick={() => void reroute(selected)} disabled={busyId === selected.id || !rerouteTo.includes('@')} className="key-shadow flex flex-1 items-center justify-center gap-1 border border-[#983b21] bg-[#e65b2f] px-3 py-3 text-[12px] font-black uppercase text-white disabled:opacity-50">
                              {busyId === selected.id ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />} Confirm re-route
                            </button>
                            <button onClick={() => { setShowReroute(false); setRerouteTo(''); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-3 text-[12px] font-bold uppercase">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {selected.forwarded && !selected.mintedBase && (
                  <div className="mb-5 border-2 border-[#3d6fd6] bg-[#d3ddf2] p-4">
                    <p className="mb-2 text-[12px] font-black uppercase tracking-[.14em] text-[#26417d]">✓ Forwarded — Mint unlocked</p>
                    <p className="mb-3 text-[12px] text-[#26417d]">You've passed the chain on. Mint this fax to Base as a permanent collectible.</p>
                    <a href={`https://nftmail.box/tray/${forwardedTrayId || selected.id}`} target="_blank" rel="noreferrer" className="mb-3 flex items-center gap-1 text-[11px] font-bold uppercase text-[#26417d] underline">
                      <ExternalLink size={11} /> View public fax
                    </a>
                    {MINT_PAUSED ? (
                      <div className="border-2 border-dashed border-[#8f8878] bg-[#e7e0d1] p-3 text-center">
                        <p className="text-[12px] font-black uppercase text-[#615c50]">Minting Paused</p>
                        <p className="mt-1 text-[11px] uppercase text-[#6e685a]">Resumes on V2 contract — {MINT_RESUME_AT}</p>
                      </div>
                    ) : (
                      <button onClick={() => void act(selected, 'mint')} disabled={busyId === selected.id || (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase))} className="key-shadow flex w-full items-center justify-center gap-2 border border-[#26417d] bg-[#3d6fd6] px-3 py-3 text-[12px] font-black uppercase text-white disabled:opacity-50">
                        {busyId === selected.id ? <Loader2 className="animate-spin" size={14} /> : <Coins size={14} />} Mint to Base
                      </button>
                    )}
                  </div>
                )}

                {activeTab === 'inbox' && (
                <div className="mb-5 grid grid-cols-4 gap-2">
                  <button onClick={() => { if (forwardFor === selected.id) { resetForward(); return; } resetReply(); setForwardFor(selected.id); }} disabled={busyId === selected.id || selected.forwarded || selected.encrypted || (!selected.savedGnosis && !selected.mintedBase && (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase)))} className={`key-shadow flex items-center justify-center gap-1 border px-2 py-3 text-[11px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40 ${forwardFor === selected.id ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}>
                    <Send size={12} /> Forward
                  </button>
                  <button
                    onClick={() => {
                      if (replyFor === selected.id) { resetReply(); return; }
                      resetForward();
                      setReplyFor(selected.id);
                      setReplyTo(selected.from);
                    }}
                    disabled={busyId === selected.id || selected.encrypted}
                    className={`key-shadow flex items-center justify-center gap-1 border px-2 py-3 text-[11px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40 ${replyFor === selected.id ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}
                  >
                    <Send size={12} className="-scale-x-100" /> Reply
                  </button>
                  <button onClick={() => void act(selected, 'mint')} disabled={MINT_PAUSED || busyId === selected.id || selected.encrypted || !selected.forwarded || !!selected.mintedBase || (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase))} className="key-shadow flex items-center justify-center gap-1 border border-[#3d6fd6] bg-[#d3ddf2] px-2 py-3 text-[11px] font-bold uppercase text-[#26417d] disabled:cursor-not-allowed disabled:opacity-40" title={MINT_PAUSED ? `Minting resumes ${MINT_RESUME_AT}` : undefined}>
                    <Coins size={12} /> {MINT_PAUSED ? 'Paused' : 'Mint'}
                  </button>
                  <button onClick={() => void act(selected, 'save')} disabled={busyId === selected.id || !!selected.savedGnosis || !selected.forwarded} className="key-shadow flex items-center justify-center gap-1 border border-[#c08a2f] bg-[#f0e4cd] px-2 py-3 text-[11px] font-bold uppercase text-[#7a5a15] disabled:cursor-not-allowed disabled:opacity-40">
                    <Archive size={12} /> Save
                  </button>
                </div>
                )}

                {activeTab === 'inbox' && replyFor === selected.id && (
                  <div className="mb-5 border-t-2 border-dashed border-[#8f8878] pt-5">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-[.18em]">Reply — starts a new chain</p>
                    <p className="mb-3 text-[11px] text-[#6e685a]">Off-the-record: this does not touch the original chain, its credits, or its decay timer.</p>

                    {replyError && (
                      <div className="mb-3 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase text-[#a94228]">{replyError}</div>
                    )}

                    <input
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      placeholder="collection.1234@fax"
                      className="mb-3 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                    />

                    <div className="mb-3">
                      <textarea
                        value={replyCoverNote}
                        onChange={(e) => setReplyCoverNote(e.target.value.slice(0, 140))}
                        placeholder="Add cover note (optional, 140 chars max)…"
                        rows={2}
                        className="w-full resize-none border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-sm outline-none focus:border-[#e65b2f]"
                      />
                      <p className="mt-1 text-right text-[10px] font-bold uppercase text-[#6e685a]">{replyCoverNote.length}/140</p>
                    </div>

                    <button
                      onClick={() => replyFileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) selectReplyFile(file); }}
                      className="paper-noise relative mb-3 grid w-full min-h-[110px] place-items-center overflow-hidden border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-4 text-center transition hover:bg-[#eee8dc]"
                    >
                      {replyPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={replyPreview} alt="Your image" className="max-h-[90px] max-w-full object-contain grayscale" />
                      ) : (
                        <div><div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full border border-[#9a9282] bg-[#d5cebf]"><Upload size={18} /></div><p className="text-[12px] font-bold uppercase">Add an image to reply with</p><p className="text-[11px] uppercase text-[#696457]">PNG · JPG · BMP</p></div>
                      )}
                    </button>
                    <input ref={replyFileInputRef} type="file" accept=".png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) selectReplyFile(file); }} />
                    {replyFileName && <p className="mb-3 text-[11px] font-bold uppercase text-[#615c50]">{replyFileName}</p>}

                    <div className="flex gap-2">
                      <button onClick={() => void sendReply(selected)} disabled={replyBusy} className="key-shadow flex flex-1 items-center justify-center gap-1 border border-[#983b21] bg-[#e65b2f] px-3 py-3 text-[12px] font-black uppercase text-white disabled:opacity-50">
                        {replyBusy ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />} Send reply
                      </button>
                      <button onClick={() => { const to = replyTo; resetReply(); setReplyFor(selected.id); setReplyTo(to); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-3 text-[12px] font-bold uppercase">Clear</button>
                    </div>
                  </div>
                )}
                {activeTab === 'sent' && !selected.mintedBase && !selected.savedGnosis && !MINT_PAUSED && !selected.encrypted && (selected.sourceTrayId || selected.chainTrayId || selected.recipientForwarded || selected.forwarded) && (
                <div className="mb-5 grid grid-cols-2 gap-2">
                  <button onClick={() => void act(selected, 'mint')} disabled={busyId === selected.id || (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase))} className="key-shadow flex items-center justify-center gap-1 border border-[#3d6fd6] bg-[#d3ddf2] px-2 py-3 text-[11px] font-bold uppercase text-[#26417d] disabled:cursor-not-allowed disabled:opacity-40">
                    <Coins size={12} /> Mint to Base
                  </button>
                  <button onClick={() => void act(selected, 'save')} disabled={busyId === selected.id || !!selected.savedGnosis} className="key-shadow flex items-center justify-center gap-1 border border-[#c08a2f] bg-[#f0e4cd] px-2 py-3 text-[11px] font-bold uppercase text-[#7a5a15] disabled:cursor-not-allowed disabled:opacity-40">
                    <Archive size={12} /> Save
                  </button>
                </div>
                )}
                {activeTab === 'saved' && !selected.mintedBase && !MINT_PAUSED && !selected.encrypted && selected.forwarded && (
                <div className="mb-5 grid grid-cols-1 gap-2">
                  <button onClick={() => void act(selected, 'mint')} disabled={busyId === selected.id || (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase))} className="key-shadow flex items-center justify-center gap-1 border border-[#3d6fd6] bg-[#d3ddf2] px-2 py-3 text-[11px] font-bold uppercase text-[#26417d] disabled:cursor-not-allowed disabled:opacity-40">
                    <Coins size={12} /> Mint to Base
                  </button>
                </div>
                )}

                {activeTab === 'inbox' && !selected.savedGnosis && !selected.mintedBase && !selected.forwarded && !selected.encrypted && (now - selected.createdAt) > (selected.chainTimerDuration || getChainTimerMs(selected.chainDepth || 1, !!selected.sourceMintedBase)) && (
                  <button onClick={() => void deleteFax(selected)} disabled={busyId === selected.id} className="mb-5 w-full border border-[#a94228] bg-[#e2c9bc] py-2 text-[11px] font-bold uppercase text-[#a94228] hover:bg-[#c0392b] hover:text-white disabled:opacity-50">
                    {busyId === selected.id ? 'Deleting…' : 'Delete jammed fax'}
                  </button>
                )}

                {forwardFor === selected.id && (
                  <div className="border-t-2 border-dashed border-[#8f8878] pt-5">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-[.18em]">Continue the chain</p>

                    {forwardError && (
                      <div className="mb-3 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase text-[#a94228]">{forwardError}</div>
                    )}

                    {(() => {
                      const sender = selected.from.replace(/@.*$/, '').toLowerCase();
                      const opts = rolofaxOptions.filter((e) => e.handle !== sender);
                      return (
                        <div className="mb-2">
                          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[.16em] text-[#615c50]">Rolofax directory</span>
                          <select
                            value={forwardTo.includes('@fax') ? forwardTo.replace(/@fax$/, '') : ''}
                            onChange={(e) => { const h = e.target.value; setForwardTo(h ? `${h}@fax` : ''); }}
                            disabled={opts.length === 0}
                            className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-xs outline-none focus:border-[#e65b2f] disabled:opacity-60"
                          >
                            <option value="">{opts.length === 0 ? 'No other Rolofax players available' : 'Select a Rolofax address…'}</option>
                            {opts.map((entry) => (
                              <option key={entry.handle} value={entry.handle}>{entry.handle}@fax ({entry.collection})</option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}

                    <input
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                      placeholder="collection.1234@fax"
                      className="mb-3 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                    />

                    <div className="mb-3">
                      <textarea
                        value={forwardCoverNote}
                        onChange={(e) => setForwardCoverNote(e.target.value.slice(0, 140))}
                        placeholder="Add cover note (optional, 140 chars max)…"
                        rows={2}
                        className="w-full resize-none border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-sm outline-none focus:border-[#e65b2f]"
                      />
                      <p className="mt-1 text-right text-[10px] font-bold uppercase text-[#6e685a]">{forwardCoverNote.length}/140</p>
                    </div>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) selectForwardFile(file); }}
                      className="paper-noise relative mb-3 grid w-full min-h-[110px] place-items-center overflow-hidden border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-4 text-center transition hover:bg-[#eee8dc]"
                    >
                      {overlaySrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={overlaySrc} alt="Your image" className="max-h-[90px] max-w-full object-contain grayscale" />
                      ) : (
                        <div><div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full border border-[#9a9282] bg-[#d5cebf]"><Upload size={18} /></div><p className="text-[12px] font-bold uppercase">Add your image to the chain</p><p className="text-[11px] uppercase text-[#696457]">PNG · JPG · BMP</p></div>
                      )}
                    </button>
                    <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) selectForwardFile(file); }} />
                    {forwardFileName && <p className="mb-3 text-[11px] font-bold uppercase text-[#615c50]">{forwardFileName} {compositeBase64 ? `· ${Math.round(compositeBase64.length * 0.75 / 1024)} KB` : ''}</p>}

                    {overlaySrc && (
                      <div className="mb-4">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#615c50]">Chain operation</p>
                          <button
                            onClick={() => setNegative((n) => !n)}
                            className={`border px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${negative ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf] text-[#4a4638]'}`}
                            title="Invert the uploaded image (RGB only) before blending"
                          >
                            Negative {negative ? '· On' : '· Off'}
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {CHAIN_OPS.map((opt) => {
                            const Icon = OP_ICON[opt.id];
                            const active = chainOp === opt.id;
                            return (
                              <button key={opt.id} onClick={() => setChainOp(opt.id)} title={opt.hint} className={`key-shadow flex flex-col items-center gap-1 border px-1 py-3 text-[11px] font-black uppercase ${active ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}>
                                <Icon size={16} /> {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-[#4a4638]">{CHAIN_OPS.find((o) => o.id === chainOp)?.hint}</p>

                        <div className="mt-4 space-y-2 border-t border-[#8f8878] pt-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#615c50]">Placement & crop</p>
                            <button
                              type="button"
                              onClick={() => setOverlayPlacement(DEFAULT_PLACEMENT)}
                              className="text-[10px] font-bold uppercase text-[#4a4638] underline"
                            >
                              Reset
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase text-[#4a4638]">
                            <label className="space-y-0.5">X <input type="range" min="0" max="1" step="0.01" value={overlayPlacement.x} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, x: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="space-y-0.5">Y <input type="range" min="0" max="1" step="0.01" value={overlayPlacement.y} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, y: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="col-span-2 space-y-0.5">Scale <input type="range" min="0.1" max="3" step="0.05" value={overlayPlacement.scale} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, scale: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="space-y-0.5">Crop X <input type="range" min="0" max="1" step="0.01" value={overlayPlacement.cropX} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, cropX: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="space-y-0.5">Crop Y <input type="range" min="0" max="1" step="0.01" value={overlayPlacement.cropY} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, cropY: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="space-y-0.5">Crop W <input type="range" min="0.01" max="1" step="0.01" value={overlayPlacement.cropW} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, cropW: parseFloat(e.target.value) }))} className="w-full" /></label>
                            <label className="space-y-0.5">Crop H <input type="range" min="0.01" max="1" step="0.01" value={overlayPlacement.cropH} onChange={(e) => setOverlayPlacement((prev) => ({ ...prev, cropH: parseFloat(e.target.value) }))} className="w-full" /></label>
                          </div>
                        </div>
                      </div>
                    )}
                    {!overlaySrc && <p className="mb-4 text-[11px] text-[#6e685a]">No image? The existing fax is forwarded unchanged.</p>}

                    <div className="flex gap-2">
                      <button onClick={() => void forward(selected)} disabled={busyId === selected.id || compositing} className="key-shadow flex flex-1 items-center justify-center gap-1 border border-[#983b21] bg-[#e65b2f] px-3 py-3 text-[12px] font-black uppercase text-white disabled:opacity-50">
                        {busyId === selected.id ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />} Send forward
                      </button>
                      <button onClick={() => { const to = forwardTo; resetForward(); setForwardFor(selected.id); setForwardTo(to); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-3 text-[12px] font-bold uppercase">Clear</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
