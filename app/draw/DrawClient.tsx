'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy, useActiveWallet } from '@privy-io/react-auth';
import { Loader2, Dices, CheckCircle2, Clock, Trophy, ArrowLeft, ShieldAlert } from 'lucide-react';
import {
  FAX_CONTRACT,
  FAX_CONTRACT_DEPLOYED,
  getBlockNumber,
  getCurrentRound,
  getDrawRound,
  getDrawPhase,
  getPrizeSentEvents,
  captureDrawSeedTx,
  type DrawRoundData,
  type DrawPhase,
} from '../lib/draw';

const PHASE_STEPS: { phase: DrawPhase; label: string }[] = [
  { phase: 'committed', label: 'Draw committed' },
  { phase: 'seed-ready', label: 'Block reached' },
  { phase: 'seed-captured', label: 'Seed captured' },
  { phase: 'finalized', label: 'Prizes distributed' },
];

function phaseIndex(phase: DrawPhase): number {
  if (phase === 'none') return -1;
  return PHASE_STEPS.findIndex((s) => s.phase === phase);
}

function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return `${eth.toFixed(4)} ETH`;
}

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Winner {
  winner: string;
  amount: bigint;
  txHash: string;
}

export default function DrawClient() {
  const { ready, authenticated, login } = usePrivy();
  const activeWallet = useActiveWallet().wallet;
  const walletAddress = activeWallet?.address?.toLowerCase() || '';
  const [round, setRound] = useState<number>(0);
  const [data, setData] = useState<DrawRoundData | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [captureMsg, setCaptureMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [currentRound, block] = await Promise.all([getCurrentRound(), getBlockNumber()]);
      setRound(currentRound);
      setCurrentBlock(block);

      if (currentRound > 0) {
        const roundData = await getDrawRound(currentRound);
        setData(roundData);
        if (roundData?.finalized) {
          const events = await getPrizeSentEvents(currentRound);
          setWinners(events.map((e) => ({ winner: e.winner, amount: e.amount, txHash: e.txHash })));
        } else {
          setWinners([]);
        }
      } else {
        setData(null);
        setWinners([]);
      }
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read draw state from chain.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const phase = getDrawPhase(data, currentBlock);
  const step = phaseIndex(phase);

  async function handleCaptureSeed() {
    setCapturing(true);
    setCaptureMsg('');
    try {
      if (!authenticated || !walletAddress) {
        login();
        return;
      }
      // Get the EIP-1193 provider from the Privy wallet
      const provider = (activeWallet as unknown as { provider?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } })?.provider ?? null;
      const result = await captureDrawSeedTx(walletAddress, round, provider);
      if (result.error) {
        setCaptureMsg(`Failed: ${result.error}`);
      } else {
        setCaptureMsg(`Seed capture submitted: ${result.txHash}`);
        setTimeout(() => { void refresh(); }, 3000);
      }
    } catch (err: unknown) {
      setCaptureMsg(err instanceof Error ? err.message : 'Transaction failed.');
    } finally {
      setCapturing(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#c8c0ae] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex items-center justify-between border-b border-[#575244] pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Dices size={20} /></div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">PRIZE DRAW<span className="text-[#e65b2f]">™</span></h1>
              <p className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Commit / reveal on a Base block hash</p>
            </div>
          </div>
          <div className="flex gap-1.5 sm:gap-2">
            <Link href="/verify" className="key-shadow flex items-center gap-1.5 border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase"><ShieldAlert size={12} /> Verify</Link>
            <Link href="/" className="key-shadow border border-[#77705f] bg-[#d8d0bf] px-2 sm:px-3 py-2 text-[9px] sm:text-[10px] font-bold uppercase whitespace-nowrap">Office</Link>
          </div>
        </header>

        {!FAX_CONTRACT_DEPLOYED && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold uppercase">
            Contract not deployed yet ({FAX_CONTRACT}). Draw state is unavailable.
          </div>
        )}

        {loading && (
          <div className="grid min-h-[200px] place-items-center"><Loader2 className="animate-spin text-[#847d6e]" size={28} /></div>
        )}

        {error && (
          <div className="mb-4 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[10px] font-bold uppercase">FAULT: {error}</div>
        )}

        {!loading && !error && FAX_CONTRACT_DEPLOYED && round === 0 && (
          <div className="machine-shadow rounded-[18px] border border-[#8f8878] bg-[#eee8dc] p-6 text-center text-[11px] font-bold uppercase tracking-wider text-[#625e52]">
            No draw round has been committed yet. Check back once the owner publishes a commit block.
          </div>
        )}

        {!loading && !error && data && (
          <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
            <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
              Round #{round}
            </div>

            <div className="grid grid-cols-4 gap-px border-b border-[#8f8878] bg-[#8f8878]">
              {PHASE_STEPS.map((s, i) => (
                <div key={s.phase} className={`bg-[#c8c0ae] p-3 text-center ${i <= step ? 'bg-[#f5dcc8]' : ''}`}>
                  {i < step ? <CheckCircle2 size={16} className="mx-auto mb-1 text-[#56705a]" /> : i === step ? <Clock size={16} className="mx-auto mb-1 text-[#e65b2f]" /> : <Clock size={16} className="mx-auto mb-1 text-[#a49c8b]" />}
                  <p className="text-[8px] font-bold uppercase leading-tight text-[#3e3b34]">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="p-5 space-y-3 text-sm text-[#3e3b34]">
              <p><strong>Committed block:</strong> #{data.blockNumber}</p>
              <p><strong>Current block:</strong> #{currentBlock}</p>

              {phase === 'committed' && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#8a3e1e]">
                  Waiting for block #{data.blockNumber} to be mined ({Math.max(0, data.blockNumber - currentBlock)} blocks remaining).
                </p>
              )}

              {phase === 'seed-ready' && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#8a3e1e]">
                    Committed block is mined. Anyone can capture the seed now — no owner permission required.
                  </p>
                  <button
                    onClick={handleCaptureSeed}
                    disabled={capturing || !ready}
                    className="key-shadow border border-[#77705f] bg-[#e65b2f] px-4 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-50"
                  >
                    {capturing ? 'Capturing…' : authenticated ? 'Capture draw seed' : 'Connect wallet to capture'}
                  </button>
                  {captureMsg && <p className="text-[10px] font-mono break-all">{captureMsg}</p>}
                </div>
              )}

              {(phase === 'seed-captured' || phase === 'finalized') && (
                <p className="font-mono text-[10px] break-all"><strong>Seed:</strong> {data.seed}</p>
              )}

              {phase === 'seed-captured' && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#8a3e1e]">
                  Seed is on-chain and public. Anyone can independently recompute winners now at <Link href="/verify" className="underline">/verify</Link>, ahead of the official payout.
                </p>
              )}
            </div>

            {phase === 'finalized' && (
              <>
                <div className="border-t border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em] flex items-center gap-2">
                  <Trophy size={14} /> Winners
                </div>
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Winner</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold text-right">Prize</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold text-right">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winners.map((w) => (
                      <tr key={w.txHash + w.winner} className="border-b border-[#8f8878]/50">
                        <td className="p-3 font-mono">{truncate(w.winner)}</td>
                        <td className="p-3 text-right font-black text-[#e65b2f]">{formatEth(w.amount)}</td>
                        <td className="p-3 text-right"><a className="underline" target="_blank" rel="noreferrer" href={`https://basescan.org/tx/${w.txHash}`}>view</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        <footer className="mx-auto mt-6 flex flex-col justify-between gap-2 text-[8px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row">
          <span>Contract: {FAX_CONTRACT}</span>
          <Link href="/" className="underline"><ArrowLeft size={10} className="inline" /> Back to office</Link>
        </footer>
      </div>
    </main>
  );
}
