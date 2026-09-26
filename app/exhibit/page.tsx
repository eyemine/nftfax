'use client';

/// /exhibit — the Marfa exhibition dashboard.
///
/// A venue display for a real thermal printer housed in a replica fax machine.
/// It watches the public leaderboard for new FAX CHAIN mints and, on each one:
///
///   1. features the minted fax full-size (an iframe of its /tray permalink),
///   2. runs a "printing" overlay so the room knows something is happening,
///   3. POSTs the event to a local middleware (`?middleware=http://localhost:…`)
///      which drives the Bluetooth printer and the fax handshake audio.
///
/// A webcam feed of the physical print shows picture-in-picture.
///
/// WHY THIS LIVES ON nftfax.app AND NOT A LOCAL FILE
/// Both nftfax.app and nftmail.box send `X-Frame-Options: SAMEORIGIN`, so a
/// page served from anywhere else cannot iframe a tray permalink. Serving the
/// dashboard from the same origin is the only clean way to embed the fax.
/// (Chrome and Firefox treat http://localhost as a secure context, so the
/// POST from this HTTPS page to a local middleware is allowed; the middleware
/// must answer CORS with `Access-Control-Allow-Origin: https://nftfax.app`.)
///
/// URL parameters
///   middleware=<url>   POST each mint event here (default: none)
///   poll=<seconds>     leaderboard poll interval (default 8)
///   cam=0              disable the webcam PIP
///   pip=br|bl|tr|tl    webcam corner (default br)
///   test=1             fire a print event for the latest mint on load
///
/// Keys: F fullscreen · C toggle camera · T test print event · Esc dismiss

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, CameraOff, Maximize2, Printer, Radio, Wifi, WifiOff } from 'lucide-react';
import { OdometerCounter } from '../components/OdometerCounter';
import { tierForChainDepth } from '../lib/draw';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';

// ── Types ────────────────────────────────────────────────────────────────────

interface Mint {
  tokenId: number;
  minter: string;
  minterEns?: string | null;
  community: number;
  sourceTokenId: number;
  trayId: string;
  chainDepth?: number;
  rootTrayId?: string;
}

interface Leaderboard {
  mints: Mint[];
  mintsTotal: number;
  uniqueMintersTotal: number;
  contractBalanceEth?: string;
  leaderboard: { collection: string; mints: number; communities: number }[];
}

interface Telegraph {
  totalPublic?: number;
  uniqueSenders?: number;
  uniqueRecipients?: number;
  velocity24h?: number;
}

interface PrintEvent {
  at: number;
  mint: Mint;
  delivered: 'none' | 'ok' | 'failed';
}

// Contract enum: NONE=0, CHONK=1, DEADFELLAZ=2, POW=3, NORMIE=4.
const COMMUNITY_KEY: Record<number, CollectionKey> = { 1: 'chonk', 2: 'deadfellaz', 3: 'pow', 4: 'normie' };
const PREFIX: Record<CollectionKey, string> = { chonk: 'chonk', deadfellaz: 'dfz', pow: 'atom', normie: 'normie' };

const PRINT_OVERLAY_MS = 14_000;

function short(addr: string): string { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
function handleFor(m: Mint): string {
  const key = COMMUNITY_KEY[m.community];
  return key ? `${PREFIX[key]}.${m.sourceTokenId}@fax` : `#${m.sourceTokenId}`;
}
function collectionFor(m: Mint): string {
  const key = COMMUNITY_KEY[m.community];
  return key ? getCollectionTheme(key).collectionName : 'Unknown';
}

// ── Featured fax: iframe with decay fallback ─────────────────────────────────

/// Tray permalinks decay after eight days. The tray API is checked first so a
/// decayed fax falls back to the immutable on-chain artwork instead of an
/// iframe showing "not found" to a room full of people.
function FeaturedFax({ mint, highlight }: { mint: Mint; highlight: boolean }) {
  const [trayAlive, setTrayAlive] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTrayAlive(null);
    void (async () => {
      try {
        const res = await fetch(`/api/tray/${mint.trayId}`, { cache: 'no-store' });
        if (!cancelled) setTrayAlive(res.ok);
      } catch { if (!cancelled) setTrayAlive(false); }
    })();
    return () => { cancelled = true; };
  }, [mint.trayId]);

  const frame = highlight
    ? 'border-[#e65b2f] shadow-[0_0_0_6px_rgba(230,91,47,.35),0_0_60px_rgba(230,91,47,.5)]'
    : 'border-[#3d6fd6] shadow-[0_0_0_4px_rgba(61,111,214,.3)]';

  return (
    <div className={`relative h-full w-full overflow-hidden border-[6px] bg-[#25251f] transition-all duration-700 ${frame}`}>
      {trayAlive === false ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/metadata/${mint.tokenId}/image`} alt={`FAX CHAIN #${mint.tokenId}`} className="h-full w-full object-contain" />
      ) : (
        <iframe
          key={mint.trayId}
          src={`/tray/${mint.trayId}`}
          title={`T/#${mint.trayId.toUpperCase()}`}
          className="h-full w-full border-0 bg-[#c8c0ae]"
          sandbox="allow-same-origin allow-scripts"
        />
      )}
      <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-2 bg-[#25251f]/90 px-4 py-2 text-[12px] font-black uppercase tracking-[.18em] text-[#efe8d8]">
        <span className={`h-2.5 w-2.5 rounded-full ${highlight ? 'animate-pulse bg-[#e65b2f]' : 'bg-[#7fa178]'}`} />
        Minted · FAX CHAIN #{mint.tokenId}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function ExhibitDashboard() {
  const params = useSearchParams();
  const middleware = params.get('middleware') || '';
  const pollMs = Math.max(3, Number(params.get('poll') || 8)) * 1000;
  const camWanted = params.get('cam') !== '0';
  const pip = (params.get('pip') || 'br') as 'br' | 'bl' | 'tr' | 'tl';
  const testOnLoad = params.get('test') === '1';

  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [telegraph, setTelegraph] = useState<Telegraph | null>(null);
  const [online, setOnline] = useState(true);
  const [featured, setFeatured] = useState<Mint | null>(null);
  const [printing, setPrinting] = useState<Mint | null>(null);
  const [events, setEvents] = useState<PrintEvent[]>([]);
  const [camOn, setCamOn] = useState(camWanted);
  const [camError, setCamError] = useState('');

  const lastSeenTokenId = useRef<number | null>(null);
  const printTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const testFired = useRef(false);

  // ── Middleware hook ───────────────────────────────────────────────────────
  const notifyMiddleware = useCallback(async (mint: Mint): Promise<'none' | 'ok' | 'failed'> => {
    if (!middleware) return 'none';
    const origin = window.location.origin;
    const key = COMMUNITY_KEY[mint.community];
    const payload = {
      event: 'mint',
      at: new Date().toISOString(),
      tokenId: mint.tokenId,
      trayId: mint.trayId,
      handle: handleFor(mint),
      collection: collectionFor(mint),
      collectionKey: key ?? null,
      minter: mint.minter,
      minterEns: mint.minterEns ?? null,
      chainDepth: mint.chainDepth ?? null,
      tier: tierForChainDepth(mint.chainDepth),
      // The thermal printer wants pixels, not a web page. This is the same
      // 1-bit-style artwork the token carries, served as PNG bytes.
      imageUrl: `${origin}/api/metadata/${mint.tokenId}/image`,
      trayUrl: `${origin}/tray/${mint.trayId}`,
    };
    try {
      const res = await fetch(middleware, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return res.ok ? 'ok' : 'failed';
    } catch (err) {
      console.error('[exhibit] middleware POST failed', err);
      return 'failed';
    }
  }, [middleware]);

  // ── Print event ───────────────────────────────────────────────────────────
  const firePrint = useCallback((mint: Mint) => {
    setFeatured(mint);
    setPrinting(mint);
    if (printTimer.current) clearTimeout(printTimer.current);
    printTimer.current = setTimeout(() => setPrinting(null), PRINT_OVERLAY_MS);
    void notifyMiddleware(mint).then((delivered) => {
      setEvents((prev) => [{ at: Date.now(), mint, delivered }, ...prev].slice(0, 12));
    });
  }, [notifyMiddleware]);

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch('/api/tray/leaderboard?pageSize=12', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as Leaderboard;
        if (cancelled) return;
        setOnline(true);
        setBoard(data);
        const newest = data.mints[0];
        if (!newest) return;
        if (lastSeenTokenId.current === null) {
          // First load: show the latest, but do not "print" history.
          lastSeenTokenId.current = newest.tokenId;
          setFeatured((f) => f ?? newest);
          if (testOnLoad && !testFired.current) { testFired.current = true; firePrint(newest); }
        } else if (newest.tokenId > lastSeenTokenId.current) {
          // Fire for every mint we missed, oldest first, so a burst prints all.
          const fresh = data.mints.filter((m) => m.tokenId > (lastSeenTokenId.current as number)).reverse();
          lastSeenTokenId.current = newest.tokenId;
          fresh.forEach((m, i) => setTimeout(() => firePrint(m), i * 4000));
        }
      } catch (err) {
        if (!cancelled) { setOnline(false); console.warn('[exhibit] poll failed', err); }
      }
    }
    void tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs, firePrint, testOnLoad]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch('/api/tray/telegraph', { cache: 'no-store' });
        if (res.ok && !cancelled) setTelegraph(await res.json() as Telegraph);
      } catch { /* summary is decorative; leave the last value */ }
    }
    void tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Webcam PIP ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!camOn) return;
    let stream: MediaStream | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamError('');
      } catch (err) {
        setCamError(err instanceof Error ? err.message : 'camera unavailable');
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [camOn]);

  // ── Keys ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'f' || e.key === 'F') void document.documentElement.requestFullscreen?.();
      if (e.key === 'c' || e.key === 'C') setCamOn((v) => !v);
      if ((e.key === 't' || e.key === 'T') && board?.mints[0]) firePrint(featured ?? board.mints[0]);
      if (e.key === 'Escape') setPrinting(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [board, featured, firePrint]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const recent = useMemo(() => (board?.mints ?? []).slice(0, 8), [board]);
  // The leaderboard labels collections inconsistently ("POWNFT", "chonks",
  // "deadfellaz"), so compare on a normalised key: lowercase, alphanumerics only.
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const perCollection = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of board?.leaderboard ?? []) out[norm(row.collection)] = (out[norm(row.collection)] || 0) + row.mints;
    return out;
  }, [board]);

  const pipClass = { br: 'bottom-6 right-6', bl: 'bottom-6 left-6', tr: 'top-24 right-6', tl: 'top-24 left-6' }[pip];

  return (
    <main className="fixed inset-0 grid grid-rows-[auto_1fr] overflow-hidden bg-[#c8c0ae] text-[#25251f]" style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
      {/* ── Top bar: brand + network summary ─────────────────────────────── */}
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-6 border-b-2 border-[#575244] bg-[#b5ad9d] px-8 py-4">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radio size={28} /></div>
          <div>
            <h1 className="text-3xl font-black leading-none tracking-[-0.06em]">FAX CHAIN<span className="text-[#e65b2f]">.</span></h1>
            <p className="mt-1 text-[12px] font-bold uppercase tracking-[.3em] text-[#625e52]">nftfax.app · live · Marfa</p>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-px border border-[#8f8878] bg-[#8f8878]">
          {([
            ['Public faxes', telegraph?.totalPublic ?? '—'],
            ['Senders', telegraph?.uniqueSenders ?? '—'],
            ['Recipients', telegraph?.uniqueRecipients ?? '—'],
            ['Wallets', board?.uniqueMintersTotal ?? '—'],
            ['24h velocity', telegraph?.velocity24h ?? '—'],
            ['Prize pool', board ? `${board.contractBalanceEth ?? '0'} ETH` : '—'],
          ] as [string, string | number][]).map(([label, value]) => (
            <div key={label} className="bg-[#c8c0ae] px-4 py-2 text-center">
              <p className="text-2xl font-black leading-none text-[#e65b2f]">{value}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#615c50]">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#625e52]">Minted on Base</p>
            <OdometerCounter value={board?.mintsTotal ?? 0} digits={4} height={44} label="FAX CHAIN mints" />
          </div>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase ${online ? 'text-[#3d5a40]' : 'text-[#a94228]'}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />} {online ? 'live' : 'offline'}
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <section className="grid min-h-0 grid-cols-[1.55fr_1fr] gap-6 p-6">
        {/* Featured fax */}
        <div className="grid min-h-0 grid-rows-[1fr_auto] gap-3">
          <div className="min-h-0">
            {featured ? (
              <FeaturedFax mint={featured} highlight={!!printing && printing.tokenId === featured.tokenId} />
            ) : (
              <div className="grid h-full place-items-center border-[6px] border-dashed border-[#8f8878] text-[14px] font-bold uppercase tracking-[.2em] text-[#625e52]">
                {online ? 'Waiting for the first transmission…' : 'Reconnecting…'}
              </div>
            )}
          </div>
          {featured && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-4 border-t-2 border-[#575244] pt-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#625e52]">Latest transmission</p>
                <p className="text-2xl font-black tracking-[-0.03em]">T/#{featured.trayId.toUpperCase()}</p>
                <p className="mt-1 text-[12px] font-bold uppercase tracking-[.12em] text-[#3d5a40]">
                  Minted by {featured.minterEns || short(featured.minter)} · {handleFor(featured)} · {collectionFor(featured)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#625e52]">Chain hop</p>
                <p className="text-2xl font-black text-[#e65b2f]">{featured.chainDepth ?? 1}</p>
                <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#625e52]">{tierForChainDepth(featured.chainDepth)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-4">
          {/* Per-collection */}
          <div className="grid grid-cols-4 gap-px border border-[#8f8878] bg-[#8f8878]">
            {(['chonk', 'deadfellaz', 'pow', 'normie'] as CollectionKey[]).map((key) => {
              const name = getCollectionTheme(key).collectionName;
              const count = perCollection[norm(name)] ?? 0;
              return (
                <div key={key} className="bg-[#c8c0ae] px-3 py-2 text-center">
                  <p className="text-xl font-black leading-none">{count}</p>
                  <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[.12em] text-[#615c50]">{name}</p>
                </div>
              );
            })}
          </div>

          {/* Recent mints — every one is minted, so every frame is highlighted */}
          <div className="min-h-0 overflow-hidden">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[.2em] text-[#625e52]">Recent mints · click to feature</p>
            <div className="grid h-[calc(100%-1.5rem)] grid-cols-4 grid-rows-2 gap-3">
              {recent.map((m) => {
                const isFeatured = featured?.tokenId === m.tokenId;
                return (
                  <button
                    key={m.tokenId}
                    onClick={() => setFeatured(m)}
                    title={`FAX CHAIN #${m.tokenId} · ${handleFor(m)}`}
                    className={`relative min-h-0 overflow-hidden border-4 bg-[#25251f] text-left transition-all ${isFeatured ? 'border-[#e65b2f] shadow-[0_0_24px_rgba(230,91,47,.5)]' : 'border-[#3d6fd6]'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/metadata/${m.tokenId}/image`} alt="" className="h-full w-full object-cover opacity-95" loading="lazy" />
                    <span className="absolute bottom-0 left-0 right-0 bg-[#25251f]/85 px-2 py-1 text-[10px] font-black uppercase tracking-[.1em] text-[#efe8d8]">
                      #{m.tokenId} · hop {m.chainDepth ?? 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Event log */}
          <div className="border-t-2 border-[#575244] pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#625e52]">Print events</p>
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#847d6e]">
                {middleware ? `→ ${middleware.replace(/^https?:\/\//, '')}` : 'no middleware · display only'}
              </p>
            </div>
            <ul className="mt-1 max-h-24 space-y-0.5 overflow-hidden text-[11px] font-bold uppercase tracking-[.08em]">
              {events.length === 0 && <li className="text-[#847d6e]">None yet · press T to test</li>}
              {events.map((e) => (
                <li key={`${e.at}-${e.mint.tokenId}`} className="flex items-center gap-2">
                  <Printer size={11} className={e.delivered === 'failed' ? 'text-[#a94228]' : 'text-[#3d5a40]'} />
                  <span className="text-[#625e52]">{new Date(e.at).toLocaleTimeString()}</span>
                  <span>#{e.mint.tokenId} · {handleFor(e.mint)}</span>
                  <span className={`ml-auto ${e.delivered === 'ok' ? 'text-[#3d5a40]' : e.delivered === 'failed' ? 'text-[#a94228]' : 'text-[#847d6e]'}`}>
                    {e.delivered === 'ok' ? 'sent to printer' : e.delivered === 'failed' ? 'middleware unreachable' : 'display only'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Webcam PIP ────────────────────────────────────────────────────── */}
      {camOn && (
        <div className={`absolute ${pipClass} z-30 w-[22vw] min-w-[280px] overflow-hidden border-4 border-[#25251f] bg-black shadow-[0_20px_60px_rgba(0,0,0,.5)]`}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} autoPlay muted playsInline className="block aspect-video w-full object-cover" />
          <div className="absolute left-0 top-0 flex items-center gap-1.5 bg-[#25251f]/85 px-2 py-1 text-[10px] font-black uppercase tracking-[.16em] text-[#efe8d8]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#e65b2f]" /> Printer cam
          </div>
          {camError && <p className="absolute inset-x-0 bottom-0 bg-[#a94228] px-2 py-1 text-[10px] font-bold uppercase text-white">{camError}</p>}
        </div>
      )}
      <button onClick={() => setCamOn((v) => !v)} title="Toggle camera (C)" className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 border border-[#77705f] bg-[#d8d0bf]/80 p-2 text-[#625e52] opacity-40 hover:opacity-100">
        {camOn ? <Camera size={14} /> : <CameraOff size={14} />}
      </button>
      <button onClick={() => void document.documentElement.requestFullscreen?.()} title="Fullscreen (F)" className="absolute right-6 top-24 z-30 border border-[#77705f] bg-[#d8d0bf]/80 p-2 text-[#625e52] opacity-40 hover:opacity-100">
        <Maximize2 size={14} />
      </button>

      {/* ── Print overlay ─────────────────────────────────────────────────── */}
      {printing && (
        <div className="pointer-events-none absolute inset-x-0 top-[5.5rem] z-40 flex justify-center">
          <div className="flex items-center gap-5 border-4 border-[#e65b2f] bg-[#25251f] px-8 py-4 text-[#efe8d8] shadow-[0_0_80px_rgba(230,91,47,.6)]">
            <Printer size={36} className="animate-pulse text-[#e65b2f]" />
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[.3em] text-[#e65b2f]">Incoming transmission · printing</p>
              <p className="text-2xl font-black tracking-[-0.03em]">T/#{printing.trayId.toUpperCase()} · FAX CHAIN #{printing.tokenId}</p>
              <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#c7c0b0]">
                {printing.minterEns || short(printing.minter)} · {collectionFor(printing)} · hop {printing.chainDepth ?? 1} · {tierForChainDepth(printing.chainDepth)}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/// useSearchParams opts the tree into client-side rendering, and Next requires
/// a Suspense boundary above it so the static shell can still prerender.
export default function ExhibitPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 grid place-items-center bg-[#c8c0ae] text-[13px] font-bold uppercase tracking-[.2em] text-[#625e52]">Warming up the fax machine…</main>}>
      <ExhibitDashboard />
    </Suspense>
  );
}
