'use client';

import { useEffect, useState } from 'react';
import { Loader2, Radar, Info, Trophy, ExternalLink, Search } from 'lucide-react';
import Link from 'next/link';

interface ChainEntry {
  id: string;
  from: string;
  to: string;
  chainDepth: number;
  createdAt: number;
}

interface RolofaxData {
  totalPublic?: number;
  uniqueSenders?: number;
  uniqueRecipients?: number;
  domainDiversity?: number;
  velocity24h?: number;
  topChains?: ChainEntry[];
}

interface LeaderboardEntry {
  collection: string;
  mints: number;
  maxTokenId: number;
  communities: number;
}

interface MintEntry {
  tokenId: number;
  minter: string;
  community: number;
  sourceTokenId: number;
  trayId: string;
  chainDepth?: number;
}

interface LeaderboardData {
  leaderboard?: LeaderboardEntry[];
  totalMints?: number;
  contractBalanceEth?: string;
  mints?: MintEntry[];
  error?: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

const TIERS: string[] = [
  'Dial Tone', 'Hop 2', 'Hop 3', 'Hop 4', 'Hop 5',
  'Hop 6', 'Hop 7', 'Hop 8', 'Hop 9', 'Hop 10', 'Dead Letter',
];

function tierForDepth(depth: number): string {
  if (depth < 1) return 'Dial Tone';
  if (depth >= 11) return 'Dead Letter';
  return TIERS[depth - 1] ?? 'Dead Letter';
}

const COMMUNITY_PREFIXES: Record<number, string> = {
  1: 'chonk', 2: 'dfz', 3: 'atom', 4: 'normie',
};

function minterLabel(mint: MintEntry): string {
  const prefix = COMMUNITY_PREFIXES[mint.community] ?? 'unknown';
  return mint.sourceTokenId > 0 ? `${prefix}.${mint.sourceTokenId}@fax` : `${prefix}@fax`;
}

export default function RolofaxClient() {
  const [data, setData] = useState<RolofaxData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>({ leaderboard: [], totalMints: 0, contractBalanceEth: '0', mints: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [faxTrayInput, setFaxTrayInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [telegraphRes, lbRes] = await Promise.all([
          fetch('/api/tray/telegraph', { cache: 'no-store' }).catch(() => null),
          fetch('/api/tray/leaderboard', { cache: 'no-store' }).catch(() => null),
        ]);
        if (telegraphRes && telegraphRes.ok) {
          const json = await telegraphRes.json() as RolofaxData & { error?: string };
          if (!cancelled) setData(json);
        }
        if (lbRes && lbRes.ok) {
          const lbJson = await lbRes.json() as LeaderboardData;
          if (!cancelled) setLeaderboard(lbJson);
        }
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
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radar size={20} /></div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">ROLOFAX<span className="text-[#e65b2f]">™</span></h1>
              <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Leaderboard & chain log</p>
            </div>
          </div>
          <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase whitespace-nowrap">Office</Link>
        </header>

        {loading && (
          <div className="grid min-h-[200px] place-items-center"><Loader2 className="animate-spin text-[#847d6e]" size={28} /></div>
        )}
        {error && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold uppercase">FAULT: {error}</div>
        )}
        <div className="mb-4 flex justify-center">
          <Link href="/about" className="key-shadow flex items-center gap-1.5 border border-[#77705f] bg-[#d8d0bf] px-4 py-2 text-[10px] font-bold uppercase tracking-[.12em]"><Info size={12} /> About</Link>
        </div>

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
            <div className="max-h-[280px] overflow-y-auto">
              {(data.topChains ?? []).length === 0 ? (
                <div className="p-5 text-[10px] font-bold uppercase text-[#6e685a]">No public chains yet.</div>
              ) : (
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead className="sticky top-0 bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Fax ID</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">From</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">To</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Depth</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(
                      data.topChains?.reduce((map, entry) => {
                        const key = `${entry.id}-${entry.from}-${entry.to}`;
                        if (!map.has(key)) map.set(key, entry);
                        return map;
                      }, new Map<string, ChainEntry>()).values() ?? []
                    ).map((entry) => (
                      <tr key={entry.id} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                        <td className="p-3 font-mono text-[9px]">T/#{entry.id.toUpperCase()}</td>
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

        {/* Prize winners board — placeholder until the first draw round is committed/finalized on-chain */}
        <div className="mt-4 machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
            <span className="flex items-center gap-2"><Trophy size={14} /> Prize winners</span>
            <span className="text-[#615c50]">Draw round not yet committed</span>
          </div>
          <table className="w-full border-collapse text-left text-[10px]">
            <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
              <tr>
                <th className="border-b border-[#8f8878] p-3 font-bold">#</th>
                <th className="border-b border-[#8f8878] p-3 font-bold">Fax ID</th>
                <th className="border-b border-[#8f8878] p-3 font-bold">Token ID</th>
                <th className="border-b border-[#8f8878] p-3 font-bold">Fax Tray ID</th>
                <th className="border-b border-[#8f8878] p-3 font-bold">Tier</th>
                <th className="border-b border-[#8f8878] p-3 font-bold">Minter</th>
                <th className="border-b border-[#8f8878] p-3 font-bold text-right">Prize</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((rank) => (
                <tr key={rank} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                  <td className="p-3 font-bold">{rank}</td>
                  <td className="p-3">–</td>
                  <td className="p-3">–</td>
                  <td className="p-3">–</td>
                  <td className="p-3">–</td>
                  <td className="p-3">–</td>
                  <td className="p-3 text-right font-black text-[#e65b2f]">0.404 ETH</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
            <span className="flex items-center gap-2"><Trophy size={14} /> Mint leaderboard by collection</span>
            <span className="text-[#615c50]">{leaderboard.totalMints ?? 0} mints · {leaderboard.contractBalanceEth ?? '0'} ETH accumulated</span>
          </div>
          {leaderboard.leaderboard && leaderboard.leaderboard.length > 0 ? (
            <table className="w-full border-collapse text-left text-[10px]">
              <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                <tr>
                  <th className="border-b border-[#8f8878] p-3 font-bold">Collection</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold text-right">Mints</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold text-right">Latest Token ID</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold text-right">Communities</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.leaderboard.map((entry) => (
                  <tr key={entry.collection} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                    <td className="p-3 font-bold capitalize">{entry.collection}</td>
                    <td className="p-3 text-right font-black text-[#e65b2f]">{entry.mints}</td>
                    <td className="p-3 text-right">#{entry.maxTokenId}</td>
                    <td className="p-3 text-right">{entry.communities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5 text-center text-[10px] font-bold uppercase tracking-[.12em] text-[#625e52]">No mints yet — be the first to forward and mint a fax chain</div>
          )}
        </div>

        {/* Per-mint collection panel */}
        <div className="mt-4 machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">Minted fax collection</div>
          {leaderboard.mints && leaderboard.mints.length > 0 ? (
            <table className="w-full border-collapse text-left text-[10px]">
              <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                <tr>
                  <th className="border-b border-[#8f8878] p-3 font-bold">Token ID</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold">Fax Tray ID</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold">Tier</th>
                  <th className="border-b border-[#8f8878] p-3 font-bold">Minter</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.mints.map((mint) => (
                  <tr key={mint.tokenId} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                    <td className="p-3">
                      <a
                        href={`https://opensea.io/assets/base/${'0xcc121bf9e3a13d03eacd55e15495e3e8de61fac5'}/${mint.tokenId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-bold text-[#e65b2f] hover:underline"
                      >
                        #{mint.tokenId} <ExternalLink size={10} />
                      </a>
                    </td>
                    <td className="p-3 font-mono">{mint.trayId || '—'}</td>
                    <td className="p-3">{tierForDepth(mint.chainDepth ?? 1)}</td>
                    <td className="p-3">{minterLabel(mint)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5 text-center text-[10px] font-bold uppercase tracking-[.12em] text-[#625e52]">No mints yet</div>
          )}

          {/* View Fax form */}
          <div className="border-t border-[#8f8878] bg-[#b5ad9d] px-5 py-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#615c50]">View fax</label>
              <input
                type="text"
                value={faxTrayInput}
                onChange={(e) => setFaxTrayInput(e.target.value.trim())}
                placeholder="FAX TRAY ID"
                className="flex-1 border border-[#8f8878] bg-[#c8c0ae] px-3 py-1.5 text-[10px] font-mono outline-none focus:border-[#e65b2f]"
              />
              <button
                onClick={() => { if (faxTrayInput) window.open(`https://nftmail.box/tray/${faxTrayInput}`, '_blank'); }}
                disabled={!faxTrayInput}
                className="key-shadow flex items-center gap-1 border border-[#77705f] bg-[#d8d0bf] px-3 py-1.5 text-[10px] font-bold uppercase disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Search size={10} /> Submit
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
