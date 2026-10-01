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
import { Cctv, ExternalLink, Maximize2, Minus, Plus, Printer, Send, Wifi, WifiOff, X } from 'lucide-react';
import { playFaxHandshake, primeFaxAudio } from '../lib/fax-audio';
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
  /// The minter's hop — resolved by the leaderboard. Artwork and iframe use this.
  displayTrayId?: string;
  /// Base transaction that minted it.
  txHash?: string;
  /// Bumps when the display tray's bitmap is repaired in place; busts image caches.
  imageVersion?: number;
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
  /// Set when `?key=` selects the nftfax.app print queue (the printer is on
  /// another continent and polls for jobs). Enables the daemon-status readout.
  queueKey: string;
  pollMs: number;
  cam: CamSource;
  pip: 'br' | 'bl' | 'tr' | 'tl';
  test: boolean;
  /// Automatic print on every new mint. Off by default: the venue operator
  /// drives the machine with the PRINT button; unattended prints were firing
  /// during setup and printing before the cover-note modal was even opened.
  auto: boolean;
  facing: 'user' | 'environment';
}

// Contract enum: NONE=0, CHONK=1, DEADFELLAZ=2, POW=3, NORMIE=4.
const COMMUNITY_KEY: Record<number, CollectionKey> = { 1: 'chonk', 2: 'deadfellaz', 3: 'pow', 4: 'normie' };
const PREFIX: Record<CollectionKey, string> = { chonk: 'chonk', deadfellaz: 'dfz', pow: 'atom', normie: 'normie' };

const PRINT_OVERLAY_MS = 14_000;
const DEFAULTS: Options = { middleware: '', queueKey: '', pollMs: 8000, cam: { kind: 'off' }, pip: 'br', test: false, auto: false, facing: 'environment' };

function short(addr: string): string { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }
/// chainDepth is the fax's POSITION in the chain (the origin send is 1). Hops
/// are forwards, so hop = position − 1. Shown as the single orange numeral;
/// the tier name is not repeated beside it.
function hopsOf(m: { chainDepth?: number }): number { return Math.max(0, (m.chainDepth ?? 1) - 1); }
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
  // `?key=K` alone means: use the built-in queue on this origin. The physical
  // machine's daemon polls it with the same key, so no venue networking exists.
  const key = p.get('key') || '';
  return {
    middleware: p.get('middleware') || (key ? `${window.location.origin}/api/exhibit/print?key=${encodeURIComponent(key)}` : ''),
    queueKey: key,
    pollMs: Math.max(3, Number(p.get('poll') || 8)) * 1000,
    // The printer cam defaults to the relay: it is a public gallery feed, and
    // the bare /exhibit URL should show the machine. `cam=off` hides it.
    cam: parseCam(p.get('cam') ?? 'whep:https://nftfax.app/cam/printer/whep'),
    pip: pip === 'bl' || pip === 'tr' || pip === 'tl' ? pip : 'br',
    test: p.get('test') === '1',
    auto: p.get('auto') === '1',
    facing: p.get('facing') === 'user' ? 'user' : 'environment',
  };
}

// ── Featured fax: iframe with decay fallback ─────────────────────────────────

/// Tray permalinks decay after eight days. The tray API is checked first so a
/// decayed fax falls back to the immutable on-chain artwork instead of an
/// iframe showing "not found" to a room full of people.
/// Pixel dissolve, drawn on a canvas over the frame. Random blocks fill in
/// then clear — the look of a thermal fax burning out. Runs once per `trigger`
/// change; the caller fires it when the handshake finishes.
function DissolveOverlay({ trigger }: { trigger: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!trigger) return;
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const parent = c.parentElement;
    const W = c.width = parent?.clientWidth || 600;
    const H = c.height = parent?.clientHeight || 800;
    const B = 10;                                   // block size
    const cols = Math.ceil(W / B), rows = Math.ceil(H / B);
    const order = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const IN = 900, HOLD = 250, OUT = 900;         // ms
    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      let covered: number;
      if (t < IN) covered = t / IN;
      else if (t < IN + HOLD) covered = 1;
      else if (t < IN + HOLD + OUT) covered = 1 - (t - IN - HOLD) / OUT;
      else { ctx.clearRect(0, 0, W, H); return; }
      const n = Math.floor(order.length * covered);
      ctx.fillStyle = '#1a1a1a';
      for (let k = 0; k < n; k++) { const i = order[k]; ctx.fillRect((i % cols) * B, Math.floor(i / cols) * B, B, B); }
      // A scatter of paper-coloured "sparkle" blocks at the moving edge.
      ctx.fillStyle = '#f4f1e8';
      for (let k = n; k < Math.min(order.length, n + cols); k++) { if (Math.random() < 0.25) { const i = order[k]; ctx.fillRect((i % cols) * B, Math.floor(i / cols) * B, B, B); } }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [trigger]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-20 h-full w-full" />;
}

function FeaturedFax({ mint, highlight, faxing, cc, zoom, onZoom, dissolve, onResolved }: { mint: Mint; highlight: boolean; faxing: boolean; cc?: string; zoom: number; onZoom: (z: number) => void; dissolve: number; onResolved?: (trayId: string) => void }) {
  // ONE round trip. The embed page owns the not-found case and is handed the
  // token's immutable artwork as a fallback, so there is no pre-check fetch.
  const displayId = mint.displayTrayId || mint.trayId;
  useEffect(() => { onResolved?.(displayId); }, [displayId, onResolved]);

  const params = new URLSearchParams({ embed: '1', fallback: `/api/metadata/${mint.tokenId}/image` });
  if (faxing) { params.set('status', 'faxing'); if (cc) params.set('cc', cc); }

  // The embed reports its sheet height (postMessage). The iframe is sized to
  // that height so it never scrolls internally - it cannot be scrolled from
  // outside and is pointer-transparent - and the CONTAINER scrolls instead.
  const viewport = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState<number>(0);
  const [viewH, setViewH] = useState<number>(0);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; id?: string; height?: number };
      if (d?.type === 'nftfax-embed-size' && d.id === displayId && typeof d.height === 'number') setContentH(d.height);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [displayId]);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el); setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setContentH(0); }, [displayId]);

  // "Fit" = the whole sheet visible in the frame (zoom may be < 1). Two pixels
  // of slack: at exactly viewH a sub-pixel rounding error can make the wrapper
  // one pixel too tall and summon a scrollbar.
  const fit = contentH && viewH ? Math.min(1, (viewH - 2) / contentH) : 1;
  const atFit = Math.abs(zoom - fit) < 0.01;

  // Tap toggles fit <-> 100%; a drag pans. The iframe is pointer-transparent,
  // so both land on the container; distinguish by movement.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current; down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
    onZoom(atFit ? 1 : fit);
  };

  const frame = highlight
    ? 'border-[#e65b2f] shadow-[0_0_0_5px_rgba(230,91,47,.35),0_0_50px_rgba(230,91,47,.5)]'
    : 'border-[#3d6fd6] shadow-[0_0_0_3px_rgba(61,111,214,.3)]';

  const h = contentH || viewH || 800;
  return (
    <div className={`relative h-full w-full border-4 bg-[#1a1a1a] transition-all duration-700 ${frame}`}>
      {/* scrollbar-gutter: stable reserves the scrollbar's width whether or not
          it is showing. Without it, FIT flickered: the bar appearing narrowed the
          container, the 90%-wide sheet reflowed shorter, the embed reported a
          smaller height, the bar vanished, the width grew back, and round again.
          At FIT nothing can overflow, so scrolling is simply off. */}
      <div
        ref={viewport}
        className={`h-full w-full cursor-zoom-in [scrollbar-width:thin] ${atFit ? 'overflow-hidden' : 'overflow-auto'}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        style={{ touchAction: 'pan-x pan-y', scrollbarGutter: 'stable' }}
      >
        {/* Wrapper = scaled content size, so the container scrolls exactly as far
            as the zoomed sheet extends. The iframe keeps the container width as
            its layout viewport (so the 90%-wide sheet is truly full width) and
            is scaled from the top-left. */}
        <div style={{ width: `${zoom * 100}%`, height: h * zoom, position: 'relative' }}>
          <iframe
            key={`${displayId}:${faxing ? 'faxing' : 'idle'}`}
            src={`/tray/${displayId}?${params.toString()}`}
            title={`T/#${displayId.toUpperCase()}`}
            scrolling="no"
            className="pointer-events-none absolute left-0 top-0 border-0 bg-[#1a1a1a]"
            style={{ width: `${100 / zoom}%`, height: h, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
            sandbox="allow-same-origin allow-scripts"
          />
        </div>
      </div>
      <DissolveOverlay trigger={dissolve} />
      <div className="pointer-events-none absolute left-0 top-0 flex items-center gap-2 bg-[#25251f]/90 px-3 py-1.5 text-[11px] font-black uppercase tracking-[.16em] text-[#efe8d8]">
        <span className={`h-2 w-2 rounded-full ${highlight ? 'animate-pulse bg-[#e65b2f]' : 'bg-[#7fa178]'}`} />
        Minted · FAX CHAIN #{mint.tokenId}
      </div>
      {/* Zoom for detail, up to 3x; the % button snaps back to fit. */}
      <div className="absolute right-0 top-0 z-30 flex items-center gap-1 bg-[#25251f]/90 px-1.5 py-1 text-[#efe8d8]">
        <button onClick={() => onZoom(Math.max(fit, +(zoom - 0.5).toFixed(2)))} title="Zoom out" className="p-1 disabled:opacity-30" disabled={zoom <= fit + 0.01}><Minus size={14} /></button>
        <button onClick={() => onZoom(atFit ? 1 : fit)} title={atFit ? 'Actual size' : 'Fit to window'} className="min-w-[4ch] text-center text-[10px] font-bold underline-offset-2 hover:underline">{atFit ? 'FIT' : `${Math.round(zoom * 100)}%`}</button>
        <button onClick={() => onZoom(Math.min(3, +(zoom + 0.5).toFixed(2)))} title="Zoom in" className="p-1 disabled:opacity-30" disabled={zoom >= 3}><Plus size={14} /></button>
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
      onError(/404/.test(reason) ? 'camera offline at the machine — reconnecting' : `${reason} — reconnecting`);
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
  /// Manual "pseudo-forward": the operator faxes the featured transmission to
  /// the physical machine. Distinct from the automatic mint print: it opens a
  /// cover-note modal, plays the handshake HERE, and is labelled OUTGOING.
  const [outgoing, setOutgoing] = useState<Mint | null>(null);   // modal open for this mint
  const [faxingId, setFaxingId] = useState<number | null>(null); // header shows FAXING for this token
  const [coverNote, setCoverNote] = useState('');
  const [soundOn, setSoundOn] = useState(true);
  /// Zoom for the featured fax: 1 = fit, up to 3x; pan by dragging.
  const [zoom, setZoom] = useState(1);
  /// Remote printer daemon status, from the queue. Null when not using the queue.
  const [printer, setPrinter] = useState<{ daemonOnline: boolean; pending: number; printed: number; lastError: string | null; daemonInfo: string | null } | null>(null);
  useEffect(() => {
    if (!opts.queueKey) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/exhibit/print?key=${encodeURIComponent(opts.queueKey)}&status=1`, { cache: 'no-store' });
        if (r.ok && !stop) setPrinter(await r.json());
      } catch { /* leave the last reading */ }
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => { stop = true; clearInterval(t); };
  }, [opts.queueKey]);
  /// Increments when a transmission finishes; the frame runs its dissolve once per value.
  const [dissolve, setDissolve] = useState(0);
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
  const notifyMiddleware = useCallback(async (mint: Mint, extra: { event: 'mint' | 'fax'; coverNote?: string; from?: string; cc?: string } = { event: 'mint' }): Promise<'none' | 'ok' | 'failed'> => {
    if (!opts.middleware) return 'none';
    const origin = window.location.origin;
    const key = COMMUNITY_KEY[mint.community];
    const payload = {
      ...extra,
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
      imageUrl: `${origin}/api/tray/${mint.displayTrayId || mint.trayId}/image${mint.imageVersion ? `?v=${mint.imageVersion}` : ''}`,
      trayUrl: `${origin}/tray/${mint.displayTrayId || mint.trayId}`,
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
    if (soundOn) playFaxHandshake();
    if (printTimer.current) clearTimeout(printTimer.current);
    printTimer.current = setTimeout(() => setPrinting(null), PRINT_OVERLAY_MS);
    void notifyMiddleware(mint).then((delivered) => {
      setEvents((prev) => [{ at: Date.now(), mint, delivered }, ...prev].slice(0, 12));
    });
  }, [notifyMiddleware, soundOn]);

  // ── Outgoing transmission (operator-initiated) ────────────────────────────
  const OUTGOING_FROM = 'Marfa@fax';
  const OUTGOING_CC = 'LocalMachine@fax';
  const [liveCc, setLiveCc] = useState('');
  const sendOutgoing = useCallback(() => {
    const mint = outgoing;
    if (!mint) return;
    const note = coverNote.trim().slice(0, 140);
    setOutgoing(null);
    setCoverNote('');
    setLiveCc(note);
    setFeatured(mint);
    setFaxingId(mint.tokenId);
    setPrinting(mint);
    if (printTimer.current) clearTimeout(printTimer.current);
    // The sound comes from this page. Hold the FAXING header for as long as
    // the handshake plays, then a beat, so the visual and the audio agree.
    const ms = soundOn ? playFaxHandshake() : 0;
    printTimer.current = setTimeout(() => { setFaxingId((cur) => (cur === mint.tokenId ? null : cur)); setLiveCc(''); setPrinting(null); setDissolve((n) => n + 1); }, Math.max(ms, 6000) + 1500);
    void notifyMiddleware(mint, { event: 'fax', coverNote: note || undefined, from: OUTGOING_FROM, cc: OUTGOING_CC }).then((delivered) => {
      setEvents((prev) => [{ at: Date.now(), mint, delivered }, ...prev].slice(0, 12));
    });
  }, [outgoing, coverNote, soundOn, notifyMiddleware]);

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
          // New mints always come to the front. They only PRINT when ?auto=1.
          if (opts.auto) fresh.forEach((m, i) => setTimeout(() => firePrint(m), i * 4000));
          else { setFeatured(fresh[fresh.length - 1]); setZoom(1); }
        }
      } catch (err) {
        if (!cancelled) { setOnline(false); console.warn('[exhibit] poll failed', err); }
      }
    }
    void tick();
    const id = setInterval(tick, opts.pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [opts.pollMs, opts.test, opts.auto, firePrint]);

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
          {/* The FAX CHAIN mark ships with its own dark tile (#24251f) baked into
              the SVG, so it fills the box edge to edge with no padding. */}
          <div className="h-10 w-10 overflow-hidden rounded-sm bg-[#24251f] xl:h-14 xl:w-14">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/faxchain.svg" alt="FAX CHAIN" className="h-full w-full" />
          </div>
          <div>
            <h1 className="text-xl font-black leading-none tracking-[-0.06em] xl:text-3xl">NFTFAX MACHINE<span className="text-[#e65b2f]">™</span></h1>
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
              <FeaturedFax mint={featured} highlight={(!!printing && printing.tokenId === featured.tokenId) || faxingId === featured.tokenId} faxing={faxingId === featured.tokenId} cc={liveCc} zoom={zoom} onZoom={setZoom} dissolve={dissolve} onResolved={setFeaturedTrayId} />
            ) : (
              <div className="grid h-full place-items-center border-4 border-dashed border-[#8f8878] text-[12px] font-bold uppercase tracking-[.2em] text-[#625e52]">
                {!hydrated ? 'Loading…' : online ? 'Waiting for the first transmission…' : 'Reconnecting…'}
              </div>
            )}
          </div>
          {featured && (
            <div className="grid grid-cols-[1fr_auto] items-stretch gap-4 border-t-2 border-[#575244] pt-2">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Latest transmission</p>
                <p className="text-lg font-black tracking-[-0.03em] xl:text-2xl">T/#{(featuredTrayId || featured.trayId).toUpperCase()}</p>
                <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[.1em] text-[#3d5a40] xl:text-[12px]">
                  {featured.minterEns || short(featured.minter)} · {handleFor(featured)} · {collectionFor(featured)}
                </p>
              </div>
              {/* Right column: the Base link sits on the heading's baseline, right-
                  aligned, with Hop beneath it. A popup, not a tab: the tablet is
                  pinned to this app and a new tab would be a dead end. */}
              <div className="flex flex-col items-end justify-between self-stretch">
                {featured.txHash ? (
                  <button
                    onClick={() => window.open(`https://basescan.org/tx/${featured.txHash}`, 'nftfax-mint-tx', 'popup=yes,width=980,height=760,noopener')}
                    className="inline-flex items-center gap-1 whitespace-nowrap text-[9px] font-bold uppercase tracking-[.2em] text-[#3d5840] underline xl:text-[11px]"
                  >
                    View Mint Tx on Base <ExternalLink size={10} />
                  </button>
                ) : <span />}
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[.2em] text-[#625e52] xl:text-[11px]">Hop</p>
                  <p className="text-lg font-black leading-none text-[#e65b2f] xl:text-2xl">{hopsOf(featured)}</p>
                </div>
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
                    {f.from.replace(/@fax$/, '')} · hop {hopsOf(f)}
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
                    onClick={() => { setFeatured(m); setZoom(1); }}
                    title={`FAX CHAIN #${m.tokenId} · ${handleFor(m)}`}
                    className={`relative aspect-[3/4] overflow-hidden border-[3px] bg-[#25251f] text-left transition-all ${isFeatured ? 'border-[#e65b2f] shadow-[0_0_18px_rgba(230,91,47,.5)]' : 'border-[#3d6fd6]'}`}
                  >
                    {/* next/image resizes through sharp and caches on disk, so the
                        tablet pulls a small thumbnail instead of the ~700KB master. */}
                    {/* Keyed by the DISPLAY tray, not the token: if the resolved hop
                        ever changes, the URL changes with it, so neither the browser,
                        Cloudflare nor next/image can pin a stale image for a day. */}
                    <Image src={`/api/tray/${m.displayTrayId || m.trayId}/image${m.imageVersion ? `?v=${m.imageVersion}` : ''}`} alt="" fill sizes="(min-width: 1280px) 220px, 160px" className="object-cover opacity-95" loading="lazy" />
                    <span className="absolute bottom-0 left-0 right-0 truncate bg-[#25251f]/85 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[.08em] text-[#efe8d8] xl:text-[10px]">
                      #{m.tokenId} · hop {hopsOf(m)}
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
                {opts.queueKey
                  ? printer
                    ? <><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${printer.daemonOnline ? 'bg-[#3d5a40]' : 'bg-[#a94228]'}`} />{printer.daemonOnline ? `Machine online${printer.daemonInfo ? ` · ${printer.daemonInfo}` : ''}` : 'Machine offline'}{printer.pending ? ` · ${printer.pending} queued` : ''}{printer.lastError ? ` · ${printer.lastError}` : ''}</>
                    : 'Queue · checking machine…'
                  : opts.middleware ? `→ ${opts.middleware.replace(/^https?:\/\//, '')}` : 'no middleware · display only'}
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
        <div className={`absolute ${pipClass} z-30 w-[48vw] min-w-[400px] max-w-[720px] overflow-hidden border-[3px] border-[#25251f] bg-black shadow-[0_16px_48px_rgba(0,0,0,.5)]`}>
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
      <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 opacity-80 hover:opacity-100">
        {/* PIP: always present so the affordance exists before a stream is
            configured; without a source it explains rather than does nothing. */}
        <button
          onClick={() => { primeFaxAudio(); if (camKind === 'off') setCamError('no printer cam configured — add ?cam=whep:<url>'); else setCamOn((v) => !v); }}
          title="Printer cam (PIP)"
          className="border border-[#77705f] bg-[#d8d0bf]/90 p-2.5 text-[#625e52]"
        >
          {/* Three states: faded = no camera stream (none configured, or the feed
              is down); orange = a stream exists but the operator hid the PIP;
              solid = PIP showing live video. */}
          <Cctv size={16} className={camKind === 'off' || (camOn && camError) ? 'opacity-40' : camOn ? '' : 'text-[#e65b2f]'} />
        </button>
        {/* PRINT: the operator's pseudo-forward to the physical machine. Orange
            with a glow — it is the one control a visitor should notice. */}
        <button
          onClick={() => { primeFaxAudio(); const m = featured ?? board?.mints[0]; if (m) { setOutgoing(m); setCoverNote(''); } }}
          title="Fax this transmission to the machine"
          className="border-2 border-[#983b21] bg-[#e65b2f] p-2.5 text-white shadow-[0_0_18px_rgba(230,91,47,.75),0_0_40px_rgba(230,91,47,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(230,91,47,.95),0_0_60px_rgba(230,91,47,.5)]"
        >
          <Printer size={18} />
        </button>
        {canFullscreen && (
          <button onClick={() => void document.documentElement.requestFullscreen?.()} title="Fullscreen" className="border border-[#77705f] bg-[#d8d0bf]/90 p-2 text-[#625e52]">
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* ── Outgoing transmission modal ───────────────────────────────────── */}
      {/* Top-anchored, not centred: on the tablet the on-screen keyboard rises
          over the lower half of the screen and would cover SEND FAX. */}
      {outgoing && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-[#25251f]/80 p-4 pt-[4vh]" onClick={() => setOutgoing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md border-[3px] border-[#e65b2f] bg-[#f4f1e8] font-mono text-[#2a2a2a] shadow-[0_0_60px_rgba(230,91,47,.5)]">
            <div className="flex items-center justify-between border-b-2 border-dashed border-[#999] px-4 py-3">
              <span className="text-[11px] font-bold tracking-[.16em] text-[#e65b2f]">CARBON COPY TRANSMISSION · FAX PRINT</span>
              <button onClick={() => setOutgoing(null)} className="text-[#666] hover:text-[#a94228]"><X size={16} /></button>
            </div>
            <div className="space-y-2 px-4 py-3 text-[11px]">
              <p className="text-[#888]">FROM: <b className="text-[#2a2a2a]">{OUTGOING_FROM}</b></p>
              <p className="text-[#888]">CC: <b className="text-[#2a2a2a]">{OUTGOING_CC}</b></p>
              <p className="text-[#888]">RE: <b className="text-[#2a2a2a]">T/#{(featuredTrayId || outgoing.trayId).toUpperCase()} · FAX CHAIN #{outgoing.tokenId}</b></p>
              <label className="block pt-2">
                <span className="mb-1 block text-[9px] tracking-[.16em] text-[#888]">CC: COVER NOTE · {140 - coverNote.length} left</span>
                <textarea
                  value={coverNote}
                  onChange={(e) => setCoverNote(e.target.value.slice(0, 140))}
                  maxLength={140}
                  rows={3}
                  autoFocus
                  placeholder="Optional. Printed above the fax."
                  className="w-full resize-none border border-[#999] bg-[#e8e4d8] px-3 py-2 text-[12px] outline-none focus:border-[#e65b2f]"
                />
              </label>
              <label className="flex items-center gap-2 pt-1 text-[10px] text-[#666]">
                <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} className="accent-[#e65b2f]" /> Play handshake on this device
              </label>
            </div>
            <div className="flex gap-2 border-t-2 border-dashed border-[#999] px-4 py-3">
              <button onClick={() => setOutgoing(null)} className="flex-1 border border-[#999] bg-[#e8e4d8] py-2.5 text-[11px] font-bold tracking-[.12em] text-[#666]">CANCEL</button>
              <button onClick={sendOutgoing} className="flex flex-1 items-center justify-center gap-2 border-2 border-[#983b21] bg-[#e65b2f] py-2.5 text-[11px] font-black tracking-[.12em] text-white shadow-[0_0_18px_rgba(230,91,47,.7)]">
                <Send size={13} /> SEND FAX
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print overlay ─────────────────────────────────────────────────── */}
      {printing && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center px-3">
          <div className="flex max-w-full items-center gap-3 border-[3px] border-[#e65b2f] bg-[#25251f] px-4 py-2.5 text-[#efe8d8] shadow-[0_0_60px_rgba(230,91,47,.6)] xl:gap-5 xl:px-8 xl:py-4">
            <Printer className="h-7 w-7 shrink-0 animate-pulse text-[#e65b2f] xl:h-9 xl:w-9" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.25em] text-[#e65b2f] xl:text-[12px] xl:tracking-[.3em]">NFTFAX Transmission</p>
              <p className="truncate text-base font-black tracking-[-0.03em] xl:text-2xl">T/#{printing.trayId.toUpperCase()} · FAX CHAIN #{printing.tokenId}</p>
              <p className="truncate text-[9px] font-bold uppercase tracking-[.1em] text-[#c7c0b0] xl:text-[12px]">
                {printing.minterEns || short(printing.minter)} · {collectionFor(printing)} · hop {hopsOf(printing)}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
