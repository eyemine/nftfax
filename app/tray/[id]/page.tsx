'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Lock, Radio, X } from 'lucide-react';
import Link from 'next/link';

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
}

const JAM_MS = 72 * 60 * 60 * 1000;

function contrastForElapsed(ms: number): number {
  if (ms <= 24 * 60 * 60 * 1000) return 1.0;
  if (ms >= JAM_MS) return 0.1;
  const window = JAM_MS - 24 * 60 * 60 * 1000;
  const t = (ms - 24 * 60 * 60 * 1000) / window;
  return 0.7 - t * 0.3;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function FaxContent({ doc }: { doc: TrayDocument }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - doc.createdAt;
  const jammed = elapsed > JAM_MS;
  const src = useMemo(() => {
    if (!doc.dataBase64) return '';
    return `data:image/${doc.format || 'png'};base64,${doc.dataBase64}`;
  }, [doc.dataBase64, doc.format]);

  return (
    <main className="min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radio size={21} /></div>
            <div>
              <h1 className="text-2xl font-black tracking-[-0.08em]">NFTFAX<span className="text-[#e65b2f]">®</span></h1>
              <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#625e52]">Internet document transmission office</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase">Open office</Link>
        </header>

        <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
            <span>Public transmission T/#{doc.id.slice(0, 4).toUpperCase()}</span>
            <span className={jammed ? 'text-[#a94228]' : 'text-[#456049]'}>{jammed ? 'LINE JAMMED' : 'LINE OPEN'}</span>
          </div>

          <div className="grid gap-6 p-5 md:p-8 lg:grid-cols-[1fr_340px]">
            <div className="flex min-h-[360px] items-center justify-center overflow-hidden border border-[#918978] bg-[#e7e0d1] p-4">
              {doc.encrypted || doc.channel === 'private' ? (
                <div className="grid place-items-center text-center text-[#8a836f]">
                  <Lock size={32} className="mb-2" />
                  <p className="text-[10px] font-bold uppercase">This transmission is private</p>
                  <p className="text-[9px] uppercase tracking-wider text-[#6e685a]">Open in your NFTmail console to decrypt.</p>
                </div>
              ) : jammed ? (
                <div className="grid w-full place-items-center bg-[#f4f2ed] text-[9px] font-bold uppercase tracking-widest text-[#9a9282]">
                  LINE JAMMED
                </div>
              ) : src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`Fax ${doc.id}`} className="max-h-full max-w-full object-contain grayscale" style={{ filter: `grayscale(1) contrast(${contrastForElapsed(elapsed)})`, opacity: 0.4 + 0.6 * contrastForElapsed(elapsed) }} />
              ) : (
                <Loader2 className="animate-spin text-[#847d6e]" />
              )}
            </div>

            <div className="space-y-4 text-[10px] font-bold uppercase text-[#4a4638]">
              <p className="border-b border-[#8f8878] pb-2">From: {doc.from}</p>
              {doc.to && <p className="border-b border-[#8f8878] pb-2">To: {doc.to}</p>}
              <p className="border-b border-[#8f8878] pb-2">Received: {formatDate(doc.createdAt)}</p>
              {typeof doc.chainDepth === 'number' && (
                <p className="border-b border-[#8f8878] pb-2">Chain link: {doc.chainDepth}</p>
              )}
              <p className="pt-2 text-[8px] uppercase tracking-wider text-[#6e685a]">
                Public faxes are thermal paper. This link decays after 72 hours unless saved.
              </p>
            </div>
          </div>
        </div>

        <footer className="mt-5 text-center text-[8px] font-bold uppercase tracking-[.14em] text-[#575347]">
          Powered by NFTmail.box / ERC-8004 identity
        </footer>
      </div>
    </main>
  );
}

export default function TrayPage() {
  const params = useParams();
  const id = (params?.id as string) || '';
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

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#c8c0ae]">
        <div className="text-center"><Loader2 className="mx-auto animate-spin text-[#847d6e]" size={32} /><p className="mt-3 text-[10px] font-bold uppercase text-[#6e685a]">Receiving transmission…</p></div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#c8c0ae] px-6 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-sm border border-[#8f8878] bg-[#d8d0bf]"><X size={22} className="text-[#a94228]" /></div>
          <h1 className="text-lg font-black uppercase">Transmission not found</h1>
          <p className="mt-2 text-[10px] uppercase text-[#6e685a]">{error || 'This fax has faded or the ID is invalid.'}</p>
          <Link href="/" className="mt-4 inline-block key-shadow border border-[#77705f] bg-[#d8d0bf] px-4 py-2 text-[10px] font-bold uppercase">Return to office</Link>
        </div>
      </div>
    );
  }

  return <FaxContent doc={doc} />;
}
