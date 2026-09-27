'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Lock, LayersArrowDown, X } from 'lucide-react';
import Link from 'next/link';
import { FAX_THEME } from '../../lib/theme';
import { SkinPanel } from '../../components/SkinPanel';

interface TrayDocument {
  id: string;
  from: string;
  to?: string;
  format: string;
  channel?: 'public' | 'private';
  encrypted?: boolean;
  dataBase64?: string;
  createdAt: number;
  chainDepth?: number;
  chainTimerDuration?: number;
  minted?: { tokenId: number | null; tx: string | null; at: number | null } | null;
  coverNote?: string;
}

const DEFAULT_JAM_MS = 72 * 60 * 60 * 1000;

function contrastForElapsed(ms: number, maxMs = DEFAULT_JAM_MS): number {
  if (ms <= 24 * 60 * 60 * 1000) return 1.0;
  if (ms >= maxMs) return 0.1;
  const window = maxMs - 24 * 60 * 60 * 1000;
  const t = (ms - 24 * 60 * 60 * 1000) / window;
  return 0.7 - t * 0.3;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}


/// The exhibition frame's rendering: a faithful copy of the nftmail.box public
/// permalink (which cannot be iframed from here because of SAMEORIGIN), with
/// exactly one addition — a TO: line under FROM:. Same near-black page, same
/// 630px sheet of paper, same Courier, same dashed rules, same greyscale
/// pixelated bitmap, same footer text.
///
/// Two states are surfaced on the header's right edge without changing the
/// layout: MINTED · FAX CHAIN #N when the fax is a collectible, and OUTGOING
/// TRANSMISSION · FAXING during a print event (?status=faxing). When minted,
/// the footer gains a MINT TRANSACTION link.
function EmbedFax({ doc, status, src, isMinted, cc }: { doc: TrayDocument; status: string; src: string; isMinted: boolean; cc?: string }) {
  const faxing = status === 'faxing';
  const receivedAt = new Date(doc.createdAt).toLocaleString();
  const statusText = faxing ? 'OUTGOING TRANSMISSION'
    : isMinted ? `MINTED · FAX CHAIN${doc.minted?.tokenId != null ? ` #${doc.minted.tokenId}` : ''}` : '';
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: '#1a1a1a' }}>
      <div style={{ maxWidth: 630, width: '100%', background: '#f4f1e8', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: '20px 20px 28px', fontFamily: "'Courier New', Courier, monospace", color: '#2a2a2a' }}>
        <div style={{ borderBottom: '2px dashed #999', paddingBottom: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, letterSpacing: 1, color: '#666' }}>
            <span>NFTfax · CLEARTEXT TRANSMISSION</span>
            {statusText && (
              <span style={{ color: faxing ? '#e65b2f' : '#26417d', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {faxing && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: '#e65b2f', marginRight: 6, verticalAlign: 'middle', animation: 'faxpulse 1s infinite' }} />}
                {statusText}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>FROM: {doc.from}</div>
          {doc.to && <div style={{ fontSize: 10, color: '#888' }}>TO: {doc.to}</div>}
          <div style={{ fontSize: 10, color: '#888' }}>T/#{doc.id.toUpperCase()} · {receivedAt}</div>
        </div>

        {doc.coverNote && (
          <div style={{ borderLeft: '3px solid #999', background: '#e8e4d8', padding: '8px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 9, letterSpacing: 1, color: '#888', marginBottom: 4 }}>COVER NOTE</div>
            <div style={{ fontSize: 12, color: '#2a2a2a', whiteSpace: 'pre-wrap' }}>{doc.coverNote}</div>
          </div>
        )}
        {/* The operator's carbon-copy note, passed in from the exhibit during an
            outgoing transmission. Rendered like a cover note but in the accent
            colour so it reads as the live addition it is. */}
        {faxing && cc && (
          <div style={{ borderLeft: '3px solid #e65b2f', background: '#f6e3d9', padding: '8px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 9, letterSpacing: 1, color: '#a94228', marginBottom: 4 }}>CC: COVER NOTE</div>
            <div style={{ fontSize: 12, color: '#2a2a2a', whiteSpace: 'pre-wrap' }}>{cc}</div>
          </div>
        )}

        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Public transmission from ${doc.from}`} style={{ width: '100%', display: 'block', filter: 'grayscale(1) contrast(1.1)', imageRendering: 'pixelated' }} />
        ) : (
          <div style={{ height: 240, display: 'grid', placeItems: 'center', color: '#999', fontSize: 11 }}>LOADING…</div>
        )}

        <div style={{ borderTop: '2px dashed #999', paddingTop: 8, marginTop: 14, fontSize: 9, color: '#999', textAlign: 'center' }}>
          NFTfax · nftfax.app · public image, no scripts, no tracking
        </div>
      </div>
      <style>{`@keyframes faxpulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
    </main>
  );
}

function FaxContent({ doc, embed = false, status = '', cc = '' }: { doc: TrayDocument; embed?: boolean; status?: string; cc?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const jamMs = doc.chainTimerDuration || DEFAULT_JAM_MS;
  const elapsed = now - doc.createdAt;
  // A minted fax is a permanent collectible on Base. The thermal-paper decay
  // and the jam state describe an UNCLAIMED hop running out of time; applying
  // them to a minted one showed every collected fax on the exhibition display
  // as faded and "LINE JAMMED". Minted hops render at full contrast, forever.
  const isMinted = !!doc.minted;
  const jammed = !isMinted && elapsed > jamMs;
  const contrast = isMinted ? 1 : contrastForElapsed(elapsed, jamMs);
  const src = useMemo(() => {
    if (!doc.dataBase64) return '';
    return `data:image/${doc.format || 'png'};base64,${doc.dataBase64}`;
  }, [doc.dataBase64, doc.format]);

  if (embed) return <EmbedFax doc={doc} status={status} src={src} isMinted={isMinted} cc={cc} />;

  return (
    <main className={embed ? 'min-h-screen bg-[#c8c0ae] p-2' : 'min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10'}>
      <div className={embed ? '' : 'mx-auto max-w-5xl'}>
        {!embed && <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><LayersArrowDown size={20} /></div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">{FAX_THEME.siteName}<span style={{ color: FAX_THEME.accent }}>™</span></h1>
              <p className="text-[11px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">{FAX_THEME.tagline}</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-bold uppercase whitespace-nowrap">Office</Link>
        </header>}

        {/* Embed mode is the flat, paper-like rendering the exhibit frames: no
            machine skin, no rounded shadowed panel, one column with the bitmap
            dominant. The full page keeps the skeuomorphic console. */}
        <SkinPanel className={embed ? 'overflow-hidden border border-[#8f8878] bg-[#eee8dc]' : 'machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]'} contentClassName={embed ? 'flex h-full flex-col' : undefined}>
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            <span>Public transmission T/#{doc.id.slice(0, 4).toUpperCase()}</span>
            <span className={isMinted ? 'text-[#26417d]' : jammed ? 'text-[#a94228]' : 'text-[#456049]'}>
              {isMinted ? `MINTED · FAX CHAIN${doc.minted?.tokenId != null ? ` #${doc.minted.tokenId}` : ''}` : jammed ? 'LINE JAMMED' : 'LINE OPEN'}
            </span>
          </div>

          <div className={embed ? 'grid gap-3 p-3' : 'grid gap-6 p-5 md:p-8 lg:grid-cols-[1fr_340px]'}>
            <div>
              {doc.coverNote && (
                <div className="mb-4 border-l-4 border-[#8f8878] bg-[#e7e0d1] p-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#6e685a]">Cover note</p>
                  <p className="text-[13px] text-[#3a362c]">{doc.coverNote}</p>
                </div>
              )}
              <div className={embed ? 'flex items-center justify-center overflow-hidden bg-[#f4f1ea] p-2' : 'flex min-h-[360px] items-center justify-center overflow-hidden border border-[#918978] bg-[#e7e0d1] p-4'}>
              {doc.encrypted || doc.channel === 'private' ? (
                <div className="grid place-items-center text-center text-[#8a836f]">
                  <Lock size={32} className="mb-2" />
                  <p className="text-[12px] font-bold uppercase">This transmission is private</p>
                  <p className="text-[11px] uppercase tracking-wider text-[#6e685a]">Open in your NFTmail console to decrypt.</p>
                </div>
              ) : jammed ? (
                <div className="grid w-full place-items-center bg-[#f4f2ed] text-[11px] font-bold uppercase tracking-widest text-[#9a9282]">
                  LINE JAMMED
                </div>
              ) : src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`Fax ${doc.id}`} className="max-h-full max-w-full object-contain grayscale" style={{ filter: `grayscale(1) contrast(${contrast})`, opacity: 0.4 + 0.6 * contrast }} />
              ) : (
                <Loader2 className="animate-spin text-[#847d6e]" />
              )}
              </div>
            </div>

            <div className="space-y-4 text-[12px] font-bold uppercase text-[#4a4638]">
              <p className="border-b border-[#8f8878] pb-2">From: {doc.from}</p>
              {doc.to && <p className="border-b border-[#8f8878] pb-2">To: {doc.to}</p>}
              <p className="border-b border-[#8f8878] pb-2">Received: {formatDate(doc.createdAt)}</p>
              {typeof doc.chainDepth === 'number' && (
                <p className="border-b border-[#8f8878] pb-2">Chain link: {doc.chainDepth}</p>
              )}
              {isMinted ? (
                <p className="pt-2 text-[11px] uppercase tracking-wider text-[#26417d]">
                  Minted to Base as a permanent collectible.
                  {doc.minted?.tx && (
                    <> <a href={`https://basescan.org/tx/${doc.minted.tx}`} target="_blank" rel="noreferrer" className="underline">View transaction</a></>
                  )}
                </p>
              ) : (
                <p className="pt-2 text-[11px] uppercase tracking-wider text-[#6e685a]">
                  Public faxes are thermal paper. This link decays after 72 hours unless saved.
                </p>
              )}
            </div>
          </div>
        </SkinPanel>

        {!embed && <footer className="mt-5 text-center text-[11px] font-bold uppercase tracking-[.14em] text-[#575347]">
          Powered by NFTmail.box / ERC-8004 identity
        </footer>}
      </div>
    </main>
  );
}

export default function TrayPage() {
  const params = useParams();
  const id = (params?.id as string) || '';
  // ?embed=1 strips the site chrome (header, Office button, footer) so the
  // transmission panel fills the frame. Used by /exhibit, which iframes this
  // page on a gallery display where the surrounding navigation is noise. Read
  // from the URL in an effect rather than useSearchParams to avoid the CSR
  // bailout / Suspense fallback that blanked the exhibit on first load.
  const [embed, setEmbed] = useState(false);
  const [status, setStatus] = useState('');
  const [cc, setCc] = useState('');
  const [fallback, setFallback] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setEmbed(q.get('embed') === '1');
    setStatus(q.get('status') || '');
    setCc((q.get('cc') || '').slice(0, 140));
    // Same-origin image to show if this tray has decayed; the exhibit passes
    // the token's immutable artwork so a gallery frame never shows "not found".
    const fb = q.get('fallback') || '';
    setFallback(/^\/api\//.test(fb) ? fb : '');
  }, []);
  const [doc, setDoc] = useState<TrayDocument | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tray/${id}`, { cache: 'no-store' });
        const data = await res.json() as TrayDocument & { error?: string };
        if (!res.ok) throw new Error(data.error || 'Transmission not found');
        if (!cancelled) setDoc(data);
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load fax');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading && embed) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#1a1a1a', fontFamily: "'Courier New', Courier, monospace" }}>
        <p style={{ fontSize: 11, letterSpacing: 2, color: '#888' }}>LOADING TRANSMISSION…</p>
      </main>
    );
  }
  if ((error || !doc) && embed) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: '#1a1a1a' }}>
        <div style={{ maxWidth: 630, width: '100%', background: '#f4f1e8', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: '20px 20px 28px', fontFamily: "'Courier New', Courier, monospace", color: '#2a2a2a' }}>
          <div style={{ borderBottom: '2px dashed #999', paddingBottom: 10, marginBottom: 14, fontSize: 11, letterSpacing: 1, color: '#666' }}>
            NFTfax · CLEARTEXT TRANSMISSION <span style={{ color: '#26417d', fontWeight: 700 }}>· MINTED · ARCHIVED</span>
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>T/#{id.toUpperCase()} · public copy expired, artwork from the collectible</div>
          </div>
          {fallback ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fallback} alt="Minted artwork" style={{ width: '100%', display: 'block', filter: 'grayscale(1) contrast(1.1)', imageRendering: 'pixelated' }} />
          ) : (
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: '#999', fontSize: 11 }}>TRANSMISSION NOT FOUND</div>
          )}
          <div style={{ borderTop: '2px dashed #999', paddingTop: 8, marginTop: 14, fontSize: 9, color: '#999', textAlign: 'center' }}>NFTfax · nftfax.app · public image, no scripts, no tracking</div>
        </div>
      </main>
    );
  }
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#c8c0ae]">
        <div className="text-center"><Loader2 className="mx-auto animate-spin text-[#847d6e]" size={32} /><p className="mt-3 text-[12px] font-bold uppercase text-[#6e685a]">Loading transmission…</p></div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#c8c0ae] px-6 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-sm border border-[#8f8878] bg-[#d8d0bf]"><X size={22} className="text-[#a94228]" /></div>
          <h1 className="text-lg font-black uppercase">Transmission not found</h1>
          <p className="mt-2 text-[12px] uppercase text-[#6e685a]">{error || 'This fax has faded or the ID is invalid.'}</p>
          <Link href="/" className="mt-4 inline-block key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-2 text-[12px] font-bold uppercase">Return to office</Link>
        </div>
      </div>
    );
  }

  return <FaxContent doc={doc} embed={embed} status={status} cc={cc} />;
}
