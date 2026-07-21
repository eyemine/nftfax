'use client';

import { useEffect, useState } from 'react';
import { Loader2, Radio } from 'lucide-react';
import Link from 'next/link';

interface ChainEntry {
  id: string;
  from: string;
  to: string;
  chainDepth: number;
  createdAt: number;
}

interface TelegraphData {
  totalPublic?: number;
  uniqueSenders?: number;
  uniqueRecipients?: number;
  domainDiversity?: number;
  velocity24h?: number;
  topChains?: ChainEntry[];
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function TelegraphPage() {
  const [data, setData] = useState<TelegraphData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/tray/telegraph', { cache: 'no-store' });
        const json = await res.json() as TelegraphData & { error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not load telegraph log');
        if (!cancelled) setData(json);
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load log');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radio size={21} /></div>
            <div>
              <h1 className="text-2xl font-black tracking-[-0.08em]">NFTFAX<span className="text-[#e65b2f]">®</span></h1>
              <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#625e52]">Telegraph log</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-3 py-2 text-[10px] font-bold uppercase">Return to office</Link>
        </header>

        {loading && (
          <div className="grid min-h-[200px] place-items-center"><Loader2 className="animate-spin text-[#847d6e]" size={28} /></div>
        )}
        {error && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold uppercase">FAULT: {error}</div>
        )}
        {data && (
          <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Network summary</div>
            <div className="grid grid-cols-2 gap-px border-b border-[#8f8878] bg-[#8f8878] md:grid-cols-5">
              {[
                ['Public faxes', data.totalPublic ?? 0],
                ['Senders', data.uniqueSenders ?? 0],
                ['Recipients', data.uniqueRecipients ?? 0],
                ['Communities', data.domainDiversity ?? 0],
                ['24h velocity', data.velocity24h ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-[#c8c0ae] p-4 text-center">
                  <p className="text-2xl font-black text-[#e65b2f]">{value}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#615c50]">{label}</p>
                </div>
              ))}
            </div>

            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Longest active chains</div>
            <div className="max-h-[500px] overflow-auto">
              {(data.topChains ?? []).length === 0 ? (
                <div className="p-5 text-[10px] font-bold uppercase text-[#6e685a]">No public chains yet.</div>
              ) : (
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead className="sticky top-0 bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Link #</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">From</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">To</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Depth</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topChains?.map((entry) => (
                      <tr key={entry.id} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                        <td className="p-3 font-mono">T/#{entry.id.slice(0, 4).toUpperCase()}</td>
                        <td className="p-3">{entry.from}</td>
                        <td className="p-3">{entry.to}</td>
                        <td className="p-3">{entry.chainDepth}</td>
                        <td className="p-3">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
