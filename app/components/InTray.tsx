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
import { Loader2, Send, Coins, Archive, Clock, Lock, Radio, X, Upload, Link2, Stamp, Ghost, Sun } from 'lucide-react';
import { compositeChain, CHAIN_OPS, type ChainOp } from '../lib/image';
import { MINT_CONFIG, SAVE_CONFIG, isPlaceholderAddress, switchToChain } from '../lib/contracts';

const OP_ICON: Record<ChainOp, typeof Stamp> = { stamp: Stamp, ghost: Ghost, illuminate: Sun };

const DECAY_MS = 8 * 24 * 60 * 60 * 1000;

interface InboxFax {
  id: string;
  from: string;
  format: string;
  channel?: 'public' | 'private';
  encrypted?: boolean;
  createdAt: number;
  forwarded?: boolean;
  chainTrayId?: string;
  chainDepth?: number;
  mintedBase?: { mintedAt: number; baseTx: string | null; baseTokenId: string | number | null } | null;
  savedGnosis?: { savedAt: number; gnosisTx: string | null } | null;
}

interface InTrayProps {
  local: string;
  wallet: string;
}

function contrastForElapsed(ms: number): number {
  if (ms <= 2 * 24 * 60 * 60 * 1000) return 1.0;
  if (ms <= 4 * 24 * 60 * 60 * 1000) return 0.75;
  if (ms <= 6 * 24 * 60 * 60 * 1000) return 0.5;
  return 0.28;
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'JAMMED';
  const d = Math.floor(msLeft / 86_400_000);
  const h = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function FaxThumb({ id, encrypted, elapsed, className = 'h-40' }: { id: string; encrypted?: boolean; elapsed: number; className?: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (encrypted) return;
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
  }, [id, encrypted]);

  if (encrypted) {
    return (
      <div className={`grid w-full place-items-center bg-[#25251f] text-[#8a836f] ${className}`}>
        <div className="text-center"><Lock size={22} className="mx-auto mb-1" /><p className="text-[8px] uppercase tracking-widest">Encrypted · view in console</p></div>
      </div>
    );
  }
  if (failed) {
    return <div className={`grid w-full place-items-center bg-[#d5cebf] text-[8px] uppercase text-[#6e685a] ${className}`}>No preview</div>;
  }
  if (!src) {
    return <div className={`grid w-full place-items-center bg-[#e7e0d1] ${className}`}><Loader2 className="animate-spin text-[#847d6e]" size={18} /></div>;
  }
  return (
    <div className={`w-full overflow-hidden bg-[#e7e0d1] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Fax ${id}`} className="h-full w-full object-contain grayscale" style={{ filter: `grayscale(1) contrast(${contrastForElapsed(elapsed)})`, opacity: 0.4 + 0.6 * contrastForElapsed(elapsed) }} />
    </div>
  );
}

export default function InTray({ local, wallet }: InTrayProps) {
  const [faxes, setFaxes] = useState<InboxFax[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState('');
  const [forwardFor, setForwardFor] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [forwardFileName, setForwardFileName] = useState('');
  const [baseSrc, setBaseSrc] = useState('');
  const [overlaySrc, setOverlaySrc] = useState('');
  const [chainOp, setChainOp] = useState<ChainOp>('stamp');
  const [compositeBase64, setCompositeBase64] = useState('');
  const [compositePreview, setCompositePreview] = useState('');
  const [compositing, setCompositing] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<InboxFax | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cleanLocal = useMemo(() => local.trim().toLowerCase().replace(/@nftmail\.box$/, ''), [local]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!cleanLocal || !wallet) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/tray/inbox?local=${encodeURIComponent(cleanLocal)}&wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
      const data = await res.json() as { faxes?: InboxFax[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not load in-tray');
      setFaxes(data.faxes || []);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load in-tray');
    } finally {
      setLoading(false);
    }
  }, [cleanLocal, wallet]);

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
    setChainOp('stamp');
    setCompositeBase64('');
    setCompositePreview('');
    setCompositing(false);
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

  // Recompute the composite whenever the overlay, operation, or base changes.
  useEffect(() => {
    if (!overlaySrc || !baseSrc) { setCompositeBase64(''); setCompositePreview(''); return; }
    let cancelled = false;
    setCompositing(true);
    (async () => {
      try {
        const result = await compositeChain(baseSrc, overlaySrc, chainOp);
        if (!cancelled) { setCompositeBase64(result.base64); setCompositePreview(result.preview); }
      } catch (cause: unknown) {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : 'Compositing failed.');
      } finally {
        if (!cancelled) setCompositing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [overlaySrc, baseSrc, chainOp]);

  function selectForwardFile(file: File) {
    setNotice('');
    const reader = new FileReader();
    reader.onload = () => { setOverlaySrc(String(reader.result || '')); setForwardFileName(file.name); };
    reader.onerror = () => setNotice('Could not read the selected image.');
    reader.readAsDataURL(file);
  }

  async function forward(fax: InboxFax) {
    if (!forwardTo.includes('@')) { setNotice('Enter a valid recipient address.'); return; }
    if (overlaySrc && !compositeBase64) { setNotice('Still compositing your image — try again in a moment.'); return; }
    setBusyId(fax.id);
    setNotice('');
    try {
      const payload: Record<string, string> = {
        fromLabel: cleanLocal,
        ownerWallet: wallet,
        to: forwardTo.trim(),
        chainTrayId: fax.id,
      };
      if (compositeBase64) {
        payload.format = 'jpg';
        payload.dataBase64 = compositeBase64;
      }
      const res = await fetch('/api/tray/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Forward failed');
      setNotice(compositeBase64 ? 'Chain extended — your link was composited and forwarded.' : 'Chain forwarded — Base mint unlocked.');
      resetForward();
      setSelected(null);
      await load();
    } catch (cause: unknown) {
      setNotice(cause instanceof Error ? cause.message : 'Forward failed');
    } finally {
      setBusyId('');
    }
  }

  async function act(fax: InboxFax, kind: 'mint' | 'save') {
    setBusyId(fax.id);
    setNotice('');
    try {
      const cfg = kind === 'mint' ? MINT_CONFIG : SAVE_CONFIG;
      const placeholder = isPlaceholderAddress(cfg.contract);
      const txHash: string | null = null;

      const provider = typeof window !== 'undefined' ? (window as { ethereum?: Parameters<typeof switchToChain>[0] }).ethereum : undefined;
      if (provider && !placeholder) {
        await switchToChain(provider, cfg.chain);
      }

      const res = await fetch(`/api/tray/${fax.id}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local: cleanLocal,
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
    }
  }

  function openDetail(fax: InboxFax) {
    setSelected(fax);
    resetForward();
  }

  if (!cleanLocal || !wallet) {
    return (
      <div className="grid min-h-[220px] place-items-center border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center">
        <div><Radio size={26} className="mx-auto mb-3 text-[#847d6e]" /><p className="font-bold uppercase">Connect + name your mailbox</p><p className="mt-2 text-[10px] uppercase tracking-wider text-[#696457]">Enter your NFTmail mailbox and connect a wallet to load your in-tray.</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#615c50]">Incoming transmissions</p>
          <h2 className="mt-1 text-xl font-black uppercase">In-Tray {faxes.length > 0 && <span className="text-[#e65b2f]">({faxes.length})</span>}</h2>
        </div>
        <button onClick={() => void load()} disabled={loading} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={13} /> : 'Refresh'}
        </button>
      </div>

      {notice && <div className="mb-4 border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[10px] font-bold uppercase">{notice}</div>}
      {error && <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold uppercase">FAULT: {error}</div>}

      {!loading && faxes.length === 0 && (
        <div className="grid min-h-[180px] place-items-center border-2 border-dashed border-[#817a6c] bg-[#e7e0d1] p-6 text-center">
          <div><Clock size={24} className="mx-auto mb-3 text-[#847d6e]" /><p className="font-bold uppercase">Tray empty</p><p className="mt-2 text-[10px] uppercase tracking-wider text-[#696457]">Received faxes appear here and fade after 8 days unless saved.</p></div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {faxes.map((fax) => {
          const elapsed = now - fax.createdAt;
          const msLeft = DECAY_MS - elapsed;
          const permanent = !!fax.savedGnosis || !!fax.mintedBase;
          const jammed = !permanent && msLeft <= 0;
          return (
            <div key={fax.id} onClick={() => openDetail(fax)} className="machine-shadow cursor-pointer overflow-hidden border border-[#8f8878] bg-[#c8c0ae] hover:ring-2 hover:ring-[#e65b2f]">
              <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-3 py-2 text-[9px] font-bold uppercase tracking-[.14em]">
                <span>T/#{fax.id.slice(0, 4).toUpperCase()}</span>
                <span className={permanent ? 'text-[#456049]' : jammed ? 'text-[#a94228]' : 'text-[#615c50]'}>
                  {permanent ? 'PERMANENT' : formatCountdown(msLeft)}
                </span>
              </div>

              <FaxThumb id={fax.id} encrypted={fax.encrypted} elapsed={jammed ? DECAY_MS : elapsed} />

              <div className="space-y-2 p-3">
                <p className="truncate text-[10px] font-bold uppercase text-[#4a4638]">From: {fax.from}</p>
                <div className="flex flex-wrap gap-1">
                  {fax.forwarded && <span className="border border-[#7fa178] bg-[#dbe6d6] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#3d5a40]">Forwarded</span>}
                  {fax.mintedBase && <span className="border border-[#3d6fd6] bg-[#d3ddf2] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#26417d]">Base</span>}
                  {fax.savedGnosis && <span className="border border-[#c08a2f] bg-[#f0e4cd] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#7a5a15]">Gnosis</span>}
                  {fax.chainDepth && fax.chainDepth > 1 && <span className="border border-[#7a6a5a] bg-[#e3dcc8] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#5a4d3e]">Link {fax.chainDepth}</span>}
                </div>
                {!fax.forwarded && !fax.encrypted && <p className="text-[8px] uppercase tracking-wide text-[#6e685a]">Forward to unlock Base mint</p>}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#25251f]/80 p-4" onClick={() => { resetForward(); setSelected(null); }}>
          <div className="machine-shadow flex h-[75vh] w-[75vw] flex-col overflow-hidden border border-[#8f8878] bg-[#c8c0ae]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.24em] text-[#615c50]">Transmission detail</p>
                <h3 className="text-lg font-black uppercase">T/#{selected.id.slice(0, 4).toUpperCase()}</h3>
              </div>
              <button onClick={() => { resetForward(); setSelected(null); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] p-2"><X size={16} /></button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[1.2fr_1fr]">
              {/* Left: the fax (or live composite preview) */}
              <div className="flex min-h-0 flex-col border-b border-[#918978] bg-[#e7e0d1] p-4 lg:border-b-0 lg:border-r">
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                  {compositePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={compositePreview} alt="Composite preview" className="max-h-full max-w-full object-contain grayscale" />
                  ) : (
                    <FaxThumb id={selected.id} encrypted={selected.encrypted} elapsed={now - selected.createdAt} className="h-full" />
                  )}
                  {compositing && <div className="absolute inset-0 grid place-items-center bg-[#e7e0d1]/80"><Loader2 className="animate-spin" /></div>}
                </div>
                {compositePreview && (
                  <p className="mt-2 text-center text-[8px] font-bold uppercase tracking-widest text-[#7a5a15]">Live composite · {CHAIN_OPS.find((o) => o.id === chainOp)?.label} operation</p>
                )}
              </div>

              {/* Right: metadata + actions + chain builder */}
              <div className="min-h-0 overflow-auto bg-[#bbb3a2] p-5">
                <div className="mb-5 grid gap-1.5 text-[10px] font-bold uppercase text-[#4a4638]">
                  <p>From: {selected.from}</p>
                  <p>Received: {formatDate(selected.createdAt)}</p>
                  {selected.chainDepth && selected.chainDepth > 1 && <p className="flex items-center gap-1 text-[#5a4d3e]"><Link2 size={12} /> Chain link {selected.chainDepth}</p>}
                  {selected.chainTrayId && <p className="text-[#6e685a]">Previous link: T/#{selected.chainTrayId.slice(0, 4).toUpperCase()}</p>}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {selected.forwarded && <span className="border border-[#7fa178] bg-[#dbe6d6] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#3d5a40]">Forwarded</span>}
                    {selected.mintedBase && <span className="border border-[#3d6fd6] bg-[#d3ddf2] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#26417d]">Base</span>}
                    {selected.savedGnosis && <span className="border border-[#c08a2f] bg-[#f0e4cd] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#7a5a15]">Gnosis</span>}
                  </div>
                </div>

                <div className="mb-5 grid grid-cols-3 gap-2">
                  <button onClick={() => setForwardFor(forwardFor === selected.id ? '' : selected.id)} disabled={busyId === selected.id || selected.forwarded || selected.encrypted} className={`key-shadow flex items-center justify-center gap-1 border px-2 py-3 text-[9px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40 ${forwardFor === selected.id ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}>
                    <Send size={12} /> Forward
                  </button>
                  <button onClick={() => void act(selected, 'mint')} disabled={busyId === selected.id || selected.encrypted || !selected.forwarded || !!selected.mintedBase} className="key-shadow flex items-center justify-center gap-1 border border-[#3d6fd6] bg-[#d3ddf2] px-2 py-3 text-[9px] font-bold uppercase text-[#26417d] disabled:cursor-not-allowed disabled:opacity-40">
                    <Coins size={12} /> Mint
                  </button>
                  <button onClick={() => void act(selected, 'save')} disabled={busyId === selected.id || !!selected.savedGnosis} className="key-shadow flex items-center justify-center gap-1 border border-[#c08a2f] bg-[#f0e4cd] px-2 py-3 text-[9px] font-bold uppercase text-[#7a5a15] disabled:cursor-not-allowed disabled:opacity-40">
                    <Archive size={12} /> Save
                  </button>
                </div>

                {forwardFor === selected.id && (
                  <div className="border-t-2 border-dashed border-[#8f8878] pt-5">
                    <p className="mb-3 text-[9px] font-bold uppercase tracking-[.18em]">Continue the chain</p>

                    <input
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                      placeholder="next@nftmail.box"
                      className="mb-3 w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                    />

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
                        <div><div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full border border-[#9a9282] bg-[#d5cebf]"><Upload size={18} /></div><p className="text-[10px] font-bold uppercase">Add your image to the chain</p><p className="text-[9px] uppercase text-[#696457]">PNG · JPG · BMP</p></div>
                      )}
                    </button>
                    <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.bmp,image/png,image/jpeg,image/bmp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) selectForwardFile(file); }} />
                    {forwardFileName && <p className="mb-3 text-[9px] font-bold uppercase text-[#615c50]">{forwardFileName} {compositeBase64 ? `· ${Math.round(compositeBase64.length * 0.75 / 1024)} KB` : ''}</p>}

                    {overlaySrc && (
                      <div className="mb-4">
                        <p className="mb-2 text-[8px] font-bold uppercase tracking-[.18em] text-[#615c50]">Chain operation</p>
                        <div className="grid grid-cols-3 gap-2">
                          {CHAIN_OPS.map((opt) => {
                            const Icon = OP_ICON[opt.id];
                            const active = chainOp === opt.id;
                            return (
                              <button key={opt.id} onClick={() => setChainOp(opt.id)} title={opt.hint} className={`key-shadow flex flex-col items-center gap-1 border px-1 py-3 text-[9px] font-black uppercase ${active ? 'border-[#983b21] bg-[#e65b2f] text-white' : 'border-[#77705f] bg-[#d8d0bf]'}`}>
                                <Icon size={16} /> {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[9px] text-[#4a4638]">{CHAIN_OPS.find((o) => o.id === chainOp)?.hint}</p>
                      </div>
                    )}
                    {!overlaySrc && <p className="mb-4 text-[9px] text-[#6e685a]">No image? The existing fax is forwarded unchanged.</p>}

                    <div className="flex gap-2">
                      <button onClick={() => void forward(selected)} disabled={busyId === selected.id || compositing} className="key-shadow flex flex-1 items-center justify-center gap-1 border border-[#983b21] bg-[#e65b2f] px-3 py-3 text-[10px] font-black uppercase text-white disabled:opacity-50">
                        {busyId === selected.id ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />} Send forward
                      </button>
                      <button onClick={() => { const to = forwardTo; resetForward(); setForwardFor(selected.id); setForwardTo(to); }} className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-3 text-[10px] font-bold uppercase">Clear</button>
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
