'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck, ArrowLeft, AlertTriangle } from 'lucide-react';
import {
  FAX_CONTRACT,
  FAX_CONTRACT_DEPLOYED,
  getDrawRound,
  getAllMintEntries,
  fetchAllTiers,
  getPrizeSentEvents,
  selectTieredWinners,
  type TieredWinner,
} from '../lib/draw';

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface VerifyResult {
  seed: string;
  minterCount: number;
  tieredWinners: TieredWinner[];
  onChainWinners: string[];
  matches: boolean;
  tiersFound: string[];
}

export default function VerifyClient() {
  const [round, setRound] = useState('');
  const [winnerCount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function handleVerify() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const roundNum = Number(round);
      const count = Number(winnerCount);
      if (!Number.isInteger(roundNum) || roundNum <= 0) throw new Error('Enter a valid round number.');
      if (!Number.isInteger(count) || count <= 0) throw new Error('Enter a valid winner count.');

      const roundData = await getDrawRound(roundNum);
      if (!roundData || !roundData.seedCaptured) {
        throw new Error('This round has no captured seed yet — nothing to verify.');
      }

      const [entries, prizeEvents] = await Promise.all([
        getAllMintEntries(),
        getPrizeSentEvents(roundNum),
      ]);

      // Fetch tier metadata for all minted tokens
      const tokenIds = entries.map((e) => e.tokenId);
      const tierMap = await fetchAllTiers(tokenIds);

      const tieredWinners = await selectTieredWinners(roundData.seed, entries, tierMap, count);
      const computedWinners = tieredWinners.map((w) => w.winner);
      const onChainWinners = prizeEvents.map((e) => e.winner);

      const matches =
        onChainWinners.length > 0 &&
        onChainWinners.length === computedWinners.length &&
        [...onChainWinners].sort().every((addr, i) => addr === [...computedWinners].sort()[i]);

      setResult({
        seed: roundData.seed,
        minterCount: entries.length,
        tieredWinners,
        onChainWinners,
        matches,
        tiersFound: Array.from(tierMap.values()).filter((v, i, arr) => arr.indexOf(v) === i),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><ShieldCheck size={20} /></div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">VERIFY DRAW<span className="text-[#e65b2f]">™</span></h1>
              <p className="text-[11px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Recompute winners client-side from the on-chain seed</p>
            </div>
          </div>
          <div className="flex gap-1.5 sm:gap-2">
            <Link href="/draw" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-bold uppercase whitespace-nowrap">Draw</Link>
            <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-bold uppercase whitespace-nowrap">Office</Link>
          </div>
        </header>

        {!FAX_CONTRACT_DEPLOYED && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase">
            Contract not deployed yet ({FAX_CONTRACT}). Verification is unavailable.
          </div>
        )}

        <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] mb-4">
          <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">How this works</div>
          <div className="p-5 text-sm leading-relaxed text-[#3e3b34] space-y-2">
            <p>
              This page pulls the captured seed for a draw round directly from the NFTFaxCollectible contract on Base,
              fetches every minted token's metadata to read its tier trait, groups mint entries by tier, and runs a
              public, deterministic shuffle (SHA-256 Fisher-Yates keyed by the seed) to pick one winner per tier.
              If it matches the on-chain <code>PrizeSent</code> events, the draw was fair given the published seed.
            </p>
            <p className="text-[12px] font-bold uppercase tracking-wider text-[#8a3e1e]">
              10 winners are selected — one randomly chosen from each of the 11 tiers. The tier order is shuffled by
              the seed, so if all 11 tiers have minters, one tier is randomly left out.
            </p>
          </div>
        </div>

        <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] mb-4">
          <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">Inputs</div>
          <div className="p-5 space-y-3">
            <label className="block text-[12px] font-bold uppercase tracking-wider text-[#625e52]">
              Round number
              <input
                value={round}
                onChange={(e) => setRound(e.target.value)}
                placeholder="1"
                className="mt-1 w-full border border-[#8f8878] bg-[#eee8dc] p-2 font-mono text-sm"
              />
            </label>
            <button
              onClick={handleVerify}
              disabled={loading || !FAX_CONTRACT_DEPLOYED}
              className="key-shadow border border-[#77705f] bg-[#e65b2f] px-4 py-2 text-[12px] font-bold uppercase text-white disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify round'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="grid min-h-[100px] place-items-center"><Loader2 className="animate-spin text-[#847d6e]" size={28} /></div>
        )}

        {error && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>
        )}

        {result && (
          <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className={`border-b border-[#8f8878] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em] ${result.matches ? 'bg-[#c9d8c4]' : 'bg-[#e2c9bc]'}`}>
              {result.onChainWinners.length === 0
                ? 'Seed captured, no distribution yet — showing computed winners only'
                : result.matches ? 'MATCH — on-chain winners match the recomputed draw' : 'MISMATCH — on-chain winners do NOT match the recomputed draw'}
            </div>
            <div className="p-5 space-y-3 text-sm text-[#3e3b34]">
              <p className="font-mono text-[12px] break-all"><strong>Seed:</strong> {result.seed}</p>
              <p><strong>Eligible mint entries:</strong> {result.minterCount}</p>
              {result.tiersFound.length > 0 && (
                <p><strong>Tiers found:</strong> {result.tiersFound.join(', ')}</p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#8f8878]">
              <div className="bg-[#c8c0ae] p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#625e52]">Recomputed winners (tier-aware)</p>
                <ul className="space-y-1 font-mono text-[12px]">
                  {result.tieredWinners.map((w, i) => (
                    <li key={w.winner + w.tier + i}>
                      <span className="text-[#8a3e1e] font-bold">{w.tier}</span> — {truncate(w.winner)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-[#c8c0ae] p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#625e52]">On-chain PrizeSent winners</p>
                {result.onChainWinners.length === 0 ? (
                  <p className="text-[12px] text-[#847d6e]">No distribution recorded yet.</p>
                ) : (
                  <ul className="space-y-1 font-mono text-[12px]">
                    {result.onChainWinners.map((w) => <li key={w}>{truncate(w)}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <footer className="mx-auto mt-6 flex flex-col justify-between gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row">
          <span>Contract: {FAX_CONTRACT}</span>
          <Link href="/" className="underline"><ArrowLeft size={10} className="inline" /> Back to office</Link>
        </footer>
      </div>
    </main>
  );
}
