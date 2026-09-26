'use client';

/// /exhibit — the Marfa exhibition dashboard.
///
/// A venue display for a real thermal printer housed in a replica fax machine.
/// It watches the public leaderboard for new FAX CHAIN mints and, on each one:
///
///   1. features the minted fax full-size (an iframe of its /tray permalink),
///   2. runs a "printing" overlay so the room knows something is happening,
///   3. POSTs the event to a local middleware (`?middleware=http://…`) which
///      drives the Bluetooth printer and the fax handshake audio.
///
/// A webcam feed of the physical print shows picture-in-picture.
///
/// TARGET DEVICE: a tablet in landscape (iPad 1024×768 up to 1366×1024, or an
/// Android equivalent), run as a Home Screen web app under Guided Access /
/// kiosk mode. Everything is sized to fit that viewport with no scrolling.
///
/// WHY THIS LIVES ON nftfax.app AND NOT A LOCAL FILE
/// Both nftfax.app and nftmail.box send `X-Frame-Options: SAMEORIGIN`, so a
/// page served from anywhere else cannot iframe a tray permalink.
///
/// WHY OPTIONS COME FROM window.location, NOT useSearchParams
/// useSearchParams forces a client-side-rendering bailout, and Next renders a
/// Suspense fallback until the client tree resolves. On the iPad that fallback
/// ("Warming up the fax machine…") was all that ever appeared. Reading the
/// query string in an effect lets the full shell server-render and hydrate
/// normally, so the display is never blocked behind a boundary.
///
/// URL parameters
///   middleware=<url>   POST each mint event here (default: none)
///   poll=<seconds>     leaderboard poll interval (default 8)
///   cam=whep:<url>     printer cam via WebRTC/WHEP — sub-second (Cloudflare Stream, MediaMTX)
///   cam=<https url>    printer cam via any embeddable player iframe (YouTube, Twitch, …)
///   cam=local          this device's own camera (only useful if the printer is beside it)
///   cam=0 / omitted    no printer cam
///   pip=br|bl|tr|tl    printer-cam corner (default br)
///   test=1             fire a print event for the latest mint on load
///
/// Keys (when a keyboard is attached): F fullscreen · C camera · T test · Esc

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
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

interface PublicFax {
  id: string;
  from: string;
  to?: string;
  chainDepth?: number;
  createdAt?: number;
}

interface Telegraph {
  totalPublic?: number;
  uniqueSenders?: number;
  uniqueRecipients?: number;
  velocity24h?: number;
  /// Most recently sent public faxes, newest first. Not necessarily minted.
  recent?: PublicFax[];
}

interface PrintEvent {
  at: number;
  mint: Mint;
  delivered: 'none' | 'ok' | 'failed';
}

/// Where the printer-cam video comes from. The printer is with the operator;
/// the display is at the venue, so the feed is almost always a remote stream
/// rather than the tablet's own camera.
type CamSource =
  | { kind: 'off' }
  | { kind: 'local' }                       // this device's camera (getUserMedia)
  | { kind: 'whep'; url: string }           // WebRTC via WHEP — sub-second (Cloudflare Stream, MediaMTX)
  | { kind: 'iframe'; url: string };        // any embeddable player (YouTube, Twitch, Cloudflare iframe)

interface Options {
  middleware: string;
  pollMs: number;
  cam: CamSource;
  pip: 'br' | 'bl' | 'tr' | 'tl';
  test: boolean;
  facing: 'user' | 'environment';
}

// Contract enum: NONE=0, CHONK=1, DEADFELLAZ=2, POW=3, NORMIE=4.
const COMMUNITY_KEY: Record<number, CollectionKey> = { 1: 'chonk', 2: 'deadfellaz', 3: 'pow', 4: 'normie' };
const PREFIX: Record<CollectionKey, string> = { chonk: 'chonk', deadfellaz: 'dfz', pow: 'atom', normie: 'normie' };

const PRINT_OVERLAY_MS = 14_000;
const DEFAULTS: Options = { middleware: '', pollMs: 8000, cam: { kind: 'off' }, pip: 'br', test: false, facing: 'environment' };

function short(addr: string): string { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
function handleFor(m: Mint): string {
  const key = COMMUNITY_KEY[m.community];
  return key ? `${PREFIX[key]}.${m.sourceTokenId}@fax` : `#${m.sourceTokenId}`;
}
function collectionFor(m: Mint): string {
  const key = COMMUNITY_KEY[m.community];
  return key ? getCollectionTheme(key).collectionName : 'Unknown';
}
// The leaderboard labels collections inconsistently ("POWNFT", "chonks"), so
// compare on a normalised key: lowercase, alphanumerics only.
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

function parseCam(raw: string | null): CamSource {
  const v = (raw || '').trim();
  if (!v || v === '0' || v === 'off') return { kind: 'off' };
  if (v === '1' || v === 'local') return { kind: 'local' };
  if (v.startsWith('whep:')) return { kind: 'whep', url: v.slice(5) };
  if (/^https?:\/\//i.test(v)) return { kind: 'iframe', url: v };
  return { kind: 'off' };
}

function readOptions(): Options {
  const p = new URLSearchParams(window.location.search);
  const pip = p.get('pip');
  return {
    middleware: p.get('middleware') || '',
    pollMs: Math.max(3, Number(p.get('poll') || 8)) * 1000,
    cam: parseCam(p.get('cam')),
    pip: pip === 'bl' || pip === 'tr' || pip === 'tl' ? pip : 'br',
    test: p.get('test') === '1',
    facing: p.get('facing') === 'user' ? 'user' : 'environment',
  };
}

// ── Featured fax: iframe with decay fallback ─────────────────────────────────

/// Tray permalinks decay after eight days. The tray API is checked first so a
/// decayed fax falls back to the immutable on-chain artwork instead of an
/// iframe showing "not found" to a room full of people.
function FeaturedFax({ mint, highlight, onResolved }: { mint: Mint; highlight: boolean; onResolved?: (trayId: string) => void }) {
  // The tray to embed: the hop the MINTER sent. The on-chain trayId is that
  // hop for current mints, but for older mints it is the RECEIVED fax, whose
  // forwardedTrayId is the minter's remix. Decide by identity — if the minter
  // is the tray's recipient, follow the forward; if the sender, show as-is
  // (its forwardedTrayId would be the NEXT player's hop, not the minted one).
  const [display, setDisplay] = useState<{ trayId: string; alive: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDisplay(null);
    void (async () => {
      try {
        const res = await fetch(`/api/tray/${mint.trayId}`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setDisplay({ trayId: mint.trayId, alive: false }); return; }
        const doc = await res.json() as { from?: string; to?: string; forwardedTrayId?: string };
        const me = handleFor(mint).toLowerCase();
        const isRecipient = doc.to?.toLowerCase() === me && doc.from?.toLowerCase() !== me;
        const target = isRecipient && doc.forwardedTrayId ? doc.forwardedTrayId : mint.trayId;
        let alive = true;
        if (target !== mint.trayId) {
          const r2 = await fetch(`/api/tray/${target}`, { cache: 'no-store' });
          alive = r2.ok;
        }
        if (!cancelled) { setDisplay({ trayId: target, alive }); onResolved?.(target); }
      } catch { if (!cancelled) setDisplay({ trayId: mint.trayId, alive: false }); }
    })();
    return () => { cancelled = true; };
  }, [mint, onResolved]);
  const trayAlive = display ? display.alive : null;
  const displayId = display?.trayId ?? mint.trayId;

  const frame = highlight
    ? 'border-[#e65b2f] shadow-[0_0_0_5px_rgba(230,91,47,.35),0_0_50px_rgba(230,91,47,.5)]'
    : 'border-[#3d6fd6] shadow-[0_0_0_3px_rgba(61,111,214,.3)]';

  return (
    <div className={`relative h-full w-full overflow-hidden border-4 bg-[#25251f] transition-all duration-700 ${frame}`}>
      {trayAlive === false ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/metadata/${mint.tokenId}/image`} alt={`FAX CHAIN #${mint.tokenId}`} className="h-full w-full object-contain" />
      ) : (
        <iframe
          key={displayId}
          src={`/tray/${displayId}?embed=1`}
          title={`T/#${displayId.toUpperCase()}`}
          className="h-full w-full border-0 bg-[#c8c0ae]"
          sandbox="allow-same-origin allow-scripts"
        />
      )}
      <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-2 bg-[#25251f]/90 px-3 py-1.5 text-[11px] font-black uppercase tracking-[.16em] text-[#efe8d8]">
        <span className={`h-2 w-2 rounded-full ${highlight ? 'animate-pulse bg-[#e65b2f]' : 'bg-[#7fa178]'}`} />
        Minted · FAX CHAIN #{mint.tokenId}
      </div>
    </div>
  );
}

// ── Remote stream via WHEP (WebRTC-HTTP Egress Protocol) ─────────────────────

/// Plays a live WebRTC stream with sub-second latency. WHEP is the standard
/// playback half of what OBS's WHIP output publishes; Cloudflare Stream Live
/// and MediaMTX both serve it. Receive-only: one POST of our SDP offer, one
/// answer back, then the media flows peer-to-peer (or via the provider's edge).
/// Reconnects with backoff so a dropped stream at the fax machine does not
/// leave a frozen frame on the gallery wall.
function WhepPlayer({ url, onError }: { url: string; onError: (msg: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (stopped) return;
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.ontrack = (e) => { if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0]; };
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'connected') { attempt = 0; onError(''); }
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') scheduleRetry('stream dropped');
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        const answer = await res.text();
        if (stopped || !pc) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      } catch (err) {
        scheduleRetry(err instanceof Error ? err.message : 'connect failed');
      }
    }
    function scheduleRetry(reason: string) {
      if (stopped) return;
      onError(`${reason} — reconnecting`);
      pc?.close(); pc = null;
      const wait = Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4));
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, wait);
    }
    void connect();
    return () => { stopped = true; if (retry) clearTimeout(retry); pc?.close(); };
  }, [url, onError]);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video ref={videoRef} autoPlay muted playsInline className="block aspect-video w-full object-cover" />;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ExhibitPage() {
  const [opts, setOpts] = useState<Options>(DEFAULTS);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  /// Minted grid, accumulated across pages as the operator scrolls. The
  /// collection caps at 2,222, so this must page rather than fetch everything:
  /// the leaderboard route decodes logs per request and a 2,000-item response
  /// would be both slow and pointless for a display that shows two rows.
  const [mintPages, setMintPages] = useState<Mint[]>([]);
  const [mintPage, setMintPage] = useState(1);
  const [mintsExhausted, setMintsExhausted] = useState(false);
  const loadingPage = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [telegraph, setTelegraph] = useState<Telegraph | null>(null);
  const [online, setOnline] = useState(true);
  const [featured, setFeatured] = useState<Mint | null>(null);
  const [printing, setPrinting] = useState<Mint | null>(null);
  const [events, setEvents] = useState<PrintEvent[]>([]);
  const [camOn, setCamOn] = useState(false);
  const camKind = opts.cam.kind;
  const [camError, setCamError] = useState('');
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [featuredTrayId, setFeaturedTrayId] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);

  const lastSeenTokenId = useRef<number | null>(null);
  const printTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const testFired = useRef(false);

  // Options from the URL, read once on the client. See the header comment for
  // why this is not useSearchParams.
  useEffect(() => {
    const o = readOptions();
    setOpts(o);
    setCamOn(o.cam.kind !== 'off');
    setCanFullscreen(typeof document.documentElement.requestFullscreen === 'function');
    setHydrated(true);
    // Tell the inline diagnostic (layout.tsx) the React bundle is alive.
    document.getElementById('exhibit-diag-hyd')?.replaceChildren('hydrated');
  }, []);

  // ── Middleware hook ───────────────────────────────────────────────────────
  const notifyMiddleware = useCallback(async (mint: Mint): Promise<'none' | 'ok' | 'failed'> => {
    if (!opts.middleware) return 'none';
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
      // The thermal printer wants pixels, not a web page.
      imageUrl: `${origin}/api/metadata/${mint.tokenId}/image`,
      trayUrl: `${origin}/tray/${mint.trayId}`,
    };
    try {
      const res = await fetch(opts.middleware, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return res.ok ? 'ok' : 'failed';
    } catch (err) {
      console.error('[exhibit] middleware POST failed', err);
      return 'failed';
    }
  }, [opts.middleware]);

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
        const res = await fetch('/api/tray/leaderboard?pageSize=24', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as Leaderboard;
        if (cancelled) return;
        setOnline(true);
        setBoard(data);
        // Merge: the poll's first page is always the freshest; keep anything
        // older we already paged in, deduped by token id.
        setMintPages((prev) => {
          const seen = new Set(data.mints.map((m) => m.tokenId));
          return [...data.mints, ...prev.filter((m) => !seen.has(m.tokenId))];
        });
        const newest = data.mints[0];
        if (!newest) return;
        if (lastSeenTokenId.current === null) {
          // First load: show the latest, but do not "print" history.
          lastSeenTokenId.current = newest.tokenId;
          setFeatured((f) => f ?? newest);
          if (opts.test && !testFired.current) { testFired.current = true; firePrint(newest); }
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
    const id = setInterval(tick, opts.pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [opts.pollMs, opts.test, firePrint]);

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
    if (!camOn || camKind !== 'local') return;
    let stream: MediaStream | null = null;
    void (async () => {
      try {
        // Optional chaining: older WebViews and non-secure contexts have no
        // mediaDevices at all, and that must degrade to a message, not a crash.
        const md = navigator.mediaDevices;
        if (!md?.getUserMedia) throw new Error('camera API unavailable');
        stream = await md.getUserMedia({ video: { facingMode: opts.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamError('');
      } catch (err) {
        setCamError(err instanceof Error ? err.message : 'camera unavailable');
      }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [camOn, camKind, opts.facing]);

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

  // ── Infinite scroll for the minted grid ───────────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || mintsExhausted) return;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loadingPage.current) return;
      loadingPage.current = true;
      try {
        const next = mintPage + 1;
        const res = await fetch(`/api/tray/leaderboard?page=${next}&pageSize=24`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as Leaderboard;
        if (data.mints.length === 0) { setMintsExhausted(true); return; }
        setMintPages((prev) => {
          const seen = new Set(prev.map((m) => m.tokenId));
          return [...prev, ...data.mints.filter((m) => !seen.has(m.tokenId))];
        });
        setMintPage(next);
      } finally {
        loadingPage.current = false;
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mintPage, mintsExhausted]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const mintedGrid = mintPages;
  // Latest public transmissions — what just went through the machine. Shown
  // above the mints without a frame and without tap-to-feature: only a minted
  // hop is a permanent exhibit; a public fax may still be mid-chain and decays.
  const latestPublic = useMemo(() => (telegraph?.recent ?? []).slice(0, 6), [telegraph]);
  const perCollection = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of board?.leaderboard ?? []) out[norm(row.collection)] = (out[norm(row.collection)] || 0) + row.mints;
    return out;
  }, [board]);

  const pipClass = { br: 'bottom-3 right-3', bl: 'bottom-3 left-3', tr: 'top-[4.5rem] right-3', tl: 'top-[4.5rem] left-3' }[opts.pip];

  return (
    // h-[100dvh] rather than fixed inset-0: Safari's toolbar changes the
    // viewport height, and dvh tracks it. Landscape is the primary layout;
    // portrait stacks so a rotated tablet still shows everything.
    <main className="grid h-[100dvh] w-screen grid-rows-[auto_1fr] overflow-hidden bg-[#c8c0ae] text-[#25251f] font-mono">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b-2 border-[#575244] bg-[#b5ad9d] px-4 py-2 xl:gap-6 xl:px-8 xl:py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8] xl:h-14 xl:w-14"><Radio className="h-5 w-5 xl:h-7 xl:w-7" /></div>
          <div>
            <h1 className="text-xl font-black leading-none tracking-[-0.06em] xl:text-3xl">FAX CHAIN<span className="text-[#e65b2f]">.</span></h1>
            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.25em] text-[#625e52] xl:text-[12px] xl:tracking-[.3em]">nftfax.app · live · Marfa</p>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-px border border-[#8f8878] bg-[#8f8878]">
          {([
            ['Public faxes', telegraph?.totalPublic ?? '—'],
            ['Senders', telegraph?.uniqueSenders ?? '—'],
            ['Recipients', telegraph?.uniqueRecipients ?? '—'],
            ['Wallets', board?.uniqueMintersTotal ?? '—'],
            ['24h', telegraph?.velocity24h ?? '—'],
            ['Pool ETH', board?.contractBalanceEth ?? '—'],
          ] as [string, string | number][]).map(([label, value]) => (
            <div key={label} className="bg-[#c8c0ae] px-2 py-1 text-center xl:px-4 xl:py-2">
              <p className="text-base font-black leading-none text-[#e65b2f] xl:text-2xl">{value}</p>
              <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[.12em] text-[#615c50] xl:text-[10px] xl:tracking-[.16em]">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[8px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[10px]">Minted on Base</p>
            <OdometerCounter value={board?.mintsTotal ?? 0} digits={4} height={34} label="FAX CHAIN mints" />
          </div>
          <div className={`flex items-center gap-1 text-[10px] font-bold uppercase ${online ? 'text-[#3d5a40]' : 'text-[#a94228]'}`}>
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <section className="grid min-h-0 grid-cols-[1.4fr_1fr] gap-3 p-3 portrait:grid-cols-1 portrait:grid-rows-[1.2fr_1fr] xl:gap-6 xl:p-6">

        {/* Featured fax */}
        <div className="grid min-h-0 grid-rows-[1fr_auto] gap-2">
          <div className="min-h-0">
            {featured ? (
              <FeaturedFax mint={featured} highlight={!!printing && printing.tokenId === featured.tokenId} onResolved={setFeaturedTrayId} />
            ) : (
              <div className="grid h-full place-items-center border-4 border-dashed border-[#8f8878] text-[12px] font-bold uppercase tracking-[.2em] text-[#625e52]">
                {!hydrated ? 'Loading…' : online ? 'Waiting for the first transmission…' : 'Reconnecting…'}
              </div>
            )}
          </div>
          {featured && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-3 border-t-2 border-[#575244] pt-2">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Latest transmission</p>
                <p className="text-lg font-black tracking-[-0.03em] xl:text-2xl">T/#{(featuredTrayId || featured.trayId).toUpperCase()}</p>
                <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[.1em] text-[#3d5a40] xl:text-[12px]">
                  {featured.minterEns || short(featured.minter)} · {handleFor(featured)} · {collectionFor(featured)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Hop</p>
                <p className="text-lg font-black leading-none text-[#e65b2f] xl:text-2xl">{featured.chainDepth ?? 1}</p>
                <p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#625e52] xl:text-[11px]">{tierForChainDepth(featured.chainDepth)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-2 xl:gap-4">
          <div className="grid grid-cols-4 gap-px border border-[#8f8878] bg-[#8f8878]">
            {(['chonk', 'deadfellaz', 'pow', 'normie'] as CollectionKey[]).map((key) => {
              const name = getCollectionTheme(key).collectionName;
              return (
                <div key={key} className="bg-[#c8c0ae] px-2 py-1 text-center xl:py-2">
                  <p className="text-base font-black leading-none xl:text-xl">{perCollection[norm(name)] ?? 0}</p>
                  <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[.1em] text-[#615c50] xl:text-[10px]">{name}</p>
                </div>
              );
            })}
          </div>

          {/* One scroll area, two sections: latest public transmissions (no frame,
              not tappable) above the minted collectibles (blue frame, tap to
              feature). Three columns of larger tiles; the minted section pages
              in as it scrolls, so it can reach the full 2,222 without loading
              them up front. */}
          <div className="min-h-0 overflow-y-auto pr-1 [scrollbar-width:thin]">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Latest transmissions</p>
            <div className="grid grid-cols-3 gap-2">
              {latestPublic.map((f) => (
                <div key={f.id} title={`T/#${f.id.toUpperCase()} · ${f.from} → ${f.to ?? '…'}`} className="relative aspect-[3/4] overflow-hidden bg-[#eee8dc]">
                  <Image src={`/api/tray/${f.id}/image`} alt="" fill sizes="(min-width: 1280px) 220px, 160px" className="object-cover" loading="lazy" />
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-[#25251f]/80 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.08em] text-[#efe8d8] xl:text-[10px]">
                    {f.from.replace(/@fax$/, '')} · hop {f.chainDepth ?? 1}
                  </span>
                </div>
              ))}
              {latestPublic.length === 0 && <p className="col-span-3 text-[10px] font-bold uppercase text-[#847d6e]">No public transmissions yet</p>}
            </div>

            <p className="mb-1 mt-3 text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">
              Minted · tap to feature · {mintedGrid.length} of {board?.mintsTotal ?? '…'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {mintedGrid.map((m) => {
                const isFeatured = featured?.tokenId === m.tokenId;
                return (
                  <button
                    key={m.tokenId}
                    onClick={() => setFeatured(m)}
                    title={`FAX CHAIN #${m.tokenId} · ${handleFor(m)}`}
                    className={`relative aspect-[3/4] overflow-hidden border-[3px] bg-[#25251f] text-left transition-all ${isFeatured ? 'border-[#e65b2f] shadow-[0_0_18px_rgba(230,91,47,.5)]' : 'border-[#3d6fd6]'}`}
                  >
                    {/* next/image resizes through sharp and caches on disk, so the
                        tablet pulls a small thumbnail instead of the ~700KB master. */}
                    <Image src={`/api/metadata/${m.tokenId}/image`} alt="" fill sizes="(min-width: 1280px) 220px, 160px" className="object-cover opacity-95" loading="lazy" />
                    <span className="absolute bottom-0 left-0 right-0 truncate bg-[#25251f]/85 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[.08em] text-[#efe8d8] xl:text-[10px]">
                      #{m.tokenId} · hop {m.chainDepth ?? 1}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Sentinel: when this scrolls into view, the next page loads. */}
            <div ref={sentinelRef} className="h-6 text-center text-[9px] font-bold uppercase text-[#847d6e]">
              {mintsExhausted ? (mintedGrid.length ? 'End of collection' : '') : mintedGrid.length ? 'Loading earlier…' : ''}
            </div>
          </div>

          {/* Event log */}
          <div className="border-t-2 border-[#575244] pt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Print events</p>
              <p className="truncate text-[8px] font-bold uppercase tracking-[.1em] text-[#847d6e] xl:text-[10px]">
                {opts.middleware ? `→ ${opts.middleware.replace(/^https?:\/\//, '')}` : 'no middleware · display only'}
              </p>
            </div>
            <ul className="mt-1 max-h-16 space-y-0.5 overflow-hidden text-[9px] font-bold uppercase tracking-[.06em] xl:max-h-24 xl:text-[11px]">
              {events.length === 0 && <li className="text-[#847d6e]">None yet · tap the printer button to test</li>}
              {events.map((e) => (
                <li key={`${e.at}-${e.mint.tokenId}`} className="flex items-center gap-2">
                  <Printer size={10} className={e.delivered === 'failed' ? 'text-[#a94228]' : 'text-[#3d5a40]'} />
                  <span className="text-[#625e52]">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="truncate">#{e.mint.tokenId} · {handleFor(e.mint)}</span>
                  <span className={`ml-auto whitespace-nowrap ${e.delivered === 'ok' ? 'text-[#3d5a40]' : e.delivered === 'failed' ? 'text-[#a94228]' : 'text-[#847d6e]'}`}>
                    {e.delivered === 'ok' ? 'printed' : e.delivered === 'failed' ? 'unreachable' : 'display only'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Webcam PIP ────────────────────────────────────────────────────── */}
      {camOn && camKind !== 'off' && (
        <div className={`absolute ${pipClass} z-30 w-[24vw] min-w-[200px] max-w-[360px] overflow-hidden border-[3px] border-[#25251f] bg-black shadow-[0_16px_48px_rgba(0,0,0,.5)]`}>
          {opts.cam.kind === 'whep' ? (
            <WhepPlayer url={opts.cam.url} onError={setCamError} />
          ) : opts.cam.kind === 'iframe' ? (
            <iframe
              src={opts.cam.url}
              title="Printer cam"
              className="block aspect-video w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video ref={videoRef} autoPlay muted playsInline className="block aspect-video w-full object-cover" />
          )}
          <div className="absolute left-0 top-0 flex items-center gap-1.5 bg-[#25251f]/85 px-2 py-0.5 text-[9px] font-black uppercase tracking-[.16em] text-[#efe8d8]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e65b2f]" /> Printer cam
          </div>
          {camError && <p className="absolute inset-x-0 bottom-0 bg-[#a94228] px-2 py-0.5 text-[9px] font-bold uppercase text-white">{camError}</p>}
        </div>
      )}

      {/* ── Touch controls — a tablet has no keyboard ─────────────────────── */}
      <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 opacity-60 hover:opacity-100">
        {camKind !== 'off' && (
          <button onClick={() => setCamOn((v) => !v)} title="Toggle printer cam" className="border border-[#77705f] bg-[#d8d0bf]/90 p-2 text-[#625e52]">
            {camOn ? <Camera size={14} /> : <CameraOff size={14} />}
          </button>
        )}
        <button onClick={() => { const m = featured ?? board?.mints[0]; if (m) firePrint(m); }} title="Test print event" className="border border-[#77705f] bg-[#d8d0bf]/90 p-2 text-[#625e52]">
          <Printer size={14} />
        </button>
        {canFullscreen && (
          <button onClick={() => void document.documentElement.requestFullscreen?.()} title="Fullscreen" className="border border-[#77705f] bg-[#d8d0bf]/90 p-2 text-[#625e52]">
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* ── Print overlay ─────────────────────────────────────────────────── */}
      {printing && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.25rem] z-40 flex justify-center px-3 xl:top-[5.5rem]">
          <div className="flex max-w-full items-center gap-3 border-[3px] border-[#e65b2f] bg-[#25251f] px-4 py-2.5 text-[#efe8d8] shadow-[0_0_60px_rgba(230,91,47,.6)] xl:gap-5 xl:px-8 xl:py-4">
            <Printer className="h-7 w-7 shrink-0 animate-pulse text-[#e65b2f] xl:h-9 xl:w-9" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.25em] text-[#e65b2f] xl:text-[12px] xl:tracking-[.3em]">Incoming transmission · printing</p>
              <p className="truncate text-base font-black tracking-[-0.03em] xl:text-2xl">T/#{printing.trayId.toUpperCase()} · FAX CHAIN #{printing.tokenId}</p>
              <p className="truncate text-[9px] font-bold uppercase tracking-[.1em] text-[#c7c0b0] xl:text-[12px]">
                {printing.minterEns || short(printing.minter)} · {collectionFor(printing)} · hop {printing.chainDepth ?? 1} · {tierForChainDepth(printing.chainDepth)}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
