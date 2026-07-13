'use client';

/// InTray — the received-fax gallery for the standalone NFTfax office.
///
/// Chain-letter game loop:
///   1. A received fax lands here as a card with an 8-day Thermal-Fade countdown.
///   2. FORWARD it onward (keeps the chain alive) — this unlocks the mint.
///   3. MINT TO BASE (the tradeable collectible) — only after forwarding.
///   4. SAVE TO GNOSIS (permanence) — rescues the fax from the fade at any time.
/// Unsaved / unminted faxes decay after 8 days so the gallery stays uncluttered.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, Coins, Archive, Clock, Lock, Radio } from 'lucide-react';
import { MINT_CONFIG, SAVE_CONFIG, isPlaceholderAddress, switchToChain } from '../lib/contracts';

const DECAY_MS = 8 * 24 * 60 * 60 * 1000;

interface InboxFax {
  id: string;
  from: string;
  format: string;
  channel?: 'public' | 'private';
  encrypted?: boolean;
  createdAt: number;
  forwarded?: boolean;
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

function FaxThumb({ id, encrypted, elapsed }: { id: string; encrypted?: boolean; elapsed: number }) {
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
      <div className="grid h-40 w-full place-items-center bg-[#25251f] text-[#8a836f]">
        <div className="text-center"><Lock size={22} className="mx-auto mb-1" /><p className="text-[8px] uppercase tracking-widest">Encrypted · view in console</p></div>
      </div>
    );
  }
  if (failed) {
    return <div className="grid h-40 w-full place-items-center bg-[#d5cebf] text-[8px] uppercase text-[#6e685a]">No preview</div>;
  }
  if (!src) {
    return <div className="grid h-40 w-full place-items-center bg-[#e7e0d1]"><Loader2 className="animate-spin text-[#847d6e]" size={18} /></div>;
  }
  return (
    <div className="h-40 w-full overflow-hidden bg-[#e7e0d1]">
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
  const [notice, setNotice] = useState('');
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

  async function forward(fax: InboxFax) {
    if (!forwardTo.includes('@')) { setNotice('Enter a valid recipient address.'); return; }
    setBusyId(fax.id);
    setNotice('');
    try {
      const res = await fetch('/api/tray/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromLabel: cleanLocal, ownerWallet: wallet, to: forwardTo.trim(), chainTrayId: fax.id }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Forward failed');
      setNotice('Chain forwarded — Base mint unlocked.');
      setForwardFor('');
      setForwardTo('');
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

      // Point the wallet at the target chain (Base for mint, Gnosis for save).
      // On-chain broadcast is skipped while the contract is a placeholder; the
      // action is still recorded off-chain by the worker.
      const provider = typeof window !== 'undefined' ? (window as { ethereum?: Parameters<typeof switchToChain>[0] }).ethereum : undefined;
      if (provider && !placeholder) {
        await switchToChain(provider, cfg.chain);
        // TODO: encode cfg.signature + broadcast via eth_sendTransaction, set txHash.
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
          const busy = busyId === fax.id;
          return (
            <div key={fax.id} className="machine-shadow overflow-hidden border border-[#8f8878] bg-[#c8c0ae]">
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
                </div>

                {forwardFor === fax.id ? (
                  <div className="space-y-2">
                    <input value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="next@nftmail.box" className="w-full border border-[#847d6e] bg-[#eee8dc] px-2 py-2 text-[11px] outline-none focus:border-[#e65b2f]" />
                    <div className="flex gap-2">
                      <button onClick={() => void forward(fax)} disabled={busy} className="key-shadow flex flex-1 items-center justify-center gap-1 border border-[#983b21] bg-[#e65b2f] px-2 py-2 text-[9px] font-black uppercase text-white disabled:opacity-50">
                        {busy ? <Loader2 className="animate-spin" size={12} /> : <Send size={12} />} Send
                      </button>
                      <button onClick={() => { setForwardFor(''); setForwardTo(''); }} className="border border-[#77705f] bg-[#d8d0bf] px-2 py-2 text-[9px] font-bold uppercase">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      onClick={() => { setForwardFor(fax.id); setForwardTo(''); setNotice(''); }}
                      disabled={busy || jammed || fax.encrypted}
                      title={fax.encrypted ? 'Encrypted faxes cannot be forwarded into the public chain' : jammed ? 'Fax has jammed (decayed)' : 'Forward the chain onward'}
                      className="key-shadow flex items-center justify-center gap-1 border border-[#77705f] bg-[#d8d0bf] px-1 py-2 text-[8px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send size={11} /> Fwd
                    </button>
                    <button
                      onClick={() => void act(fax, 'mint')}
                      disabled={busy || jammed || fax.encrypted || !fax.forwarded || !!fax.mintedBase}
                      title={fax.encrypted ? 'Private faxes cannot be minted' : !fax.forwarded ? 'Forward first to unlock minting' : fax.mintedBase ? 'Already minted' : 'Mint to Base'}
                      className="key-shadow flex items-center justify-center gap-1 border border-[#3d6fd6] bg-[#d3ddf2] px-1 py-2 text-[8px] font-bold uppercase text-[#26417d] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Coins size={11} /> Mint
                    </button>
                    <button
                      onClick={() => void act(fax, 'save')}
                      disabled={busy || (jammed && !fax.savedGnosis) || !!fax.savedGnosis}
                      title={fax.savedGnosis ? 'Already saved' : 'Save to Gnosis (permanence)'}
                      className="key-shadow flex items-center justify-center gap-1 border border-[#c08a2f] bg-[#f0e4cd] px-1 py-2 text-[8px] font-bold uppercase text-[#7a5a15] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Archive size={11} /> Save
                    </button>
                  </div>
                )}
                {!fax.forwarded && !fax.encrypted && forwardFor !== fax.id && (
                  <p className="text-[8px] uppercase tracking-wide text-[#6e685a]">Forward to unlock Base mint</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
