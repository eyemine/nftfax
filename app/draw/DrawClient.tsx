'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy, useActiveWallet } from '@privy-io/react-auth';
import { Loader2, Dices, CheckCircle2, Clock, Trophy, ArrowLeft, ShieldAlert, Check } from 'lucide-react';
import {
  FAX_CONTRACT,
  FAX_CONTRACT_DEPLOYED,
  getDrawPhase,
  getFaxAccountLabel,
  captureDrawSeedTx,
  distributePrizesTx,
  withdrawTx,
  type DrawRoundData,
  type DrawPhase,
  type MintEntry,
} from '../lib/draw';

const MAX_SUPPLY = 2222;

const TIERS: string[] = [
  'Dial Tone', 'Hop 2', 'Hop 3', 'Hop 4', 'Hop 5',
  'Hop 6', 'Hop 7', 'Hop 8', 'Hop 9', 'Hop 10', 'Dead Letter',
];

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

function formatEth(wei: bigint, digits = 4): string {
  const eth = Number(wei) / 1e18;
  return `${eth.toFixed(digits)} ETH`;
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
  const [owner, setOwner] = useState<string>('');
  const [totalMinted, setTotalMinted] = useState<number>(0);
  const [mintPrice, setMintPrice] = useState<bigint>(BigInt(0));
  const [balance, setBalance] = useState<bigint>(BigInt(0));
  const [entries, setEntries] = useState<MintEntry[]>([]);
  const [tieredWinners, setTieredWinners] = useState<{ tier: string; winner: string; tokenId: number; claimed: boolean }[]>([]);
  const [distributing, setDistributing] = useState<Record<number, boolean>>({});
  const [distributeMsg, setDistributeMsg] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawMsg, setWithdrawMsg] = useState('');

  const isOwner = owner === walletAddress && !!walletAddress;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/draw/state', { cache: 'no-store' });
      const json = (await res.json()) as {
        round: number;
        currentBlock: number;
        totalMinted: number;
        mintPrice: string;
        balance: string;
        owner: string;
        supplyReached: boolean;
        roundData: DrawRoundData | null;
        winners: { winner: string; amount: string; txHash: string }[];
        tieredWinners: { tier: string; winner: string; tokenId: number; claimed: boolean }[];
        entries: MintEntry[];
        error?: string;
      };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? 'Could not read draw state');
      }
      setRound(json.round);
      setCurrentBlock(json.currentBlock);
      setTotalMinted(json.totalMinted);
      setMintPrice(BigInt(json.mintPrice));
      setBalance(BigInt(json.balance));
      setOwner(json.owner);
      setData(json.roundData);
      setWinners(json.winners.map((w) => ({ ...w, amount: BigInt(w.amount) })));
      setTieredWinners(json.tieredWinners);
      setEntries(json.entries);
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
  const supplyReached = totalMinted >= MAX_SUPPLY;
  const totalPoolWei = BigInt(MAX_SUPPLY) * mintPrice;
  const remainingPoolWei = balance;
  const prizePerWinner = supplyReached ? totalPoolWei / BigInt(11) : BigInt(0);

  function getProvider() {
    return (activeWallet as unknown as { provider?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } })?.provider ?? null;
  }

  async function handleCaptureSeed() {
    setCapturing(true);
    setCaptureMsg('');
    try {
      if (!authenticated || !walletAddress) {
        login();
        return;
      }
      const result = await captureDrawSeedTx(walletAddress, round, getProvider());
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

  async function handleDistribute(winner: string, index: number) {
    if (!authenticated || !walletAddress || !isOwner) return;
    setDistributing((d) => ({ ...d, [index]: true }));
    setDistributeMsg('');
    try {
      const result = await distributePrizesTx(walletAddress, round, [winner], [prizePerWinner], getProvider());
      if (result.error) {
        setDistributeMsg(`Failed: ${result.error}`);
      } else {
        setDistributeMsg(`Prize distribution submitted: ${result.txHash}`);
        setTimeout(() => { void refresh(); }, 3000);
      }
    } catch (err: unknown) {
      setDistributeMsg(err instanceof Error ? err.message : 'Transaction failed.');
    } finally {
      setDistributing((d) => ({ ...d, [index]: false }));
    }
  }

  async function handleWithdraw() {
    if (!authenticated || !walletAddress || !isOwner) return;
    setWithdrawing(true);
    setWithdrawMsg('');
    try {
      const result = await withdrawTx(walletAddress, walletAddress, getProvider());
      if (result.error) {
        setWithdrawMsg(`Failed: ${result.error}`);
      } else {
        setWithdrawMsg(`Withdrawal submitted: ${result.txHash}`);
        setTimeout(() => { void refresh(); }, 3000);
      }
    } catch (err: unknown) {
      setWithdrawMsg(err instanceof Error ? err.message : 'Transaction failed.');
    } finally {
      setWithdrawing(false);
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

        {!loading && !error && FAX_CONTRACT_DEPLOYED && (
          <>
            {/* Pool status & draw lock */}
            <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] mb-4">
              <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em]">
                Prize winners — {supplyReached ? `${MAX_SUPPLY.toLocaleString()} mints · ${formatEth(totalPoolWei)} pool` : `${totalMinted.toLocaleString()} / ${MAX_SUPPLY.toLocaleString()} mints · ${formatEth(remainingPoolWei)} pool`}
              </div>
              <div className="p-5 space-y-3 text-sm text-[#3e3b34]">
                {!supplyReached ? (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#8a3e1e]">
                    Prize draw unlocks once {MAX_SUPPLY.toLocaleString()} mints are complete. {MAX_SUPPLY - totalMinted} mint{MAX_SUPPLY - totalMinted === 1 ? '' : 's'} remaining.
                  </p>
                ) : (
                  <>
                    <p><strong>Total pool:</strong> {formatEth(totalPoolWei)}</p>
                    <p><strong>Remaining in contract:</strong> {formatEth(remainingPoolWei)}</p>
                    {isOwner && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          onClick={() => void handleWithdraw()}
                          disabled={withdrawing || balance === BigInt(0)}
                          className="key-shadow border border-[#77705f] bg-[#e65b2f] px-4 py-2 text-[10px] font-bold uppercase text-white disabled:opacity-50"
                        >
                          {withdrawing ? 'Withdrawing…' : `Withdraw remainder (${formatEth(remainingPoolWei)})`}
                        </button>
                      </div>
                    )}
                    {withdrawMsg && <p className="text-[10px] font-mono break-all">{withdrawMsg}</p>}
                  </>
                )}
              </div>
            </div>

            {/* Draw round timeline — only meaningful once supply is reached */}
            {supplyReached && round === 0 && (
              <div className="machine-shadow rounded-[18px] border border-[#8f8878] bg-[#eee8dc] p-6 text-center text-[11px] font-bold uppercase tracking-wider text-[#625e52] mb-4">
                No draw round has been committed yet. The owner can publish a commit block once the pool is filled.
              </div>
            )}

            {supplyReached && data && (
              <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] mb-4">
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
              </div>
            )}

            {/* Winners by tier */}
            {supplyReached && (
              <div className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae] mb-4">
                <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[10px] font-bold uppercase tracking-[.16em] flex items-center gap-2">
                  <Trophy size={14} /> Winners by tier
                </div>
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead className="bg-[#b5ad9d] text-[9px] uppercase tracking-wider">
                    <tr>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Tier</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Account</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold">Wallet</th>
                      <th className="border-b border-[#8f8878] p-3 font-bold text-center">Claimed</th>
                      {isOwner && <th className="border-b border-[#8f8878] p-3 font-bold">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {TIERS.map((tier, index) => {
                      const tw = tieredWinners.find((w) => w.tier === tier);
                      const entry = tw ? entries.find((e) => e.tokenId === tw.tokenId) : undefined;
                      const accountLabel = tw && entry ? getFaxAccountLabel(entry) : '—';
                      return (
                        <tr key={tier} className="border-b border-[#8f8878]/50">
                          <td className="p-3 font-bold">{tier}</td>
                          <td className="p-3">
                            {tw ? (
                              <span className="font-mono">{accountLabel}</span>
                            ) : (
                              <span className="text-[#847d6e]">No winner</span>
                            )}
                          </td>
                          <td className="p-3 font-mono">{tw ? truncate(tw.winner) : '—'}</td>
                          <td className="p-3 text-center">
                            {tw ? (
                              tw.claimed ? (
                                <Check size={14} className="inline text-[#56705a]" />
                              ) : (
                                <span className="text-[#847d6e]">—</span>
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          {isOwner && (
                            <td className="p-3">
                              {tw && !tw.claimed ? (
                                <button
                                  onClick={() => void handleDistribute(tw.winner, index)}
                                  disabled={distributing[index] || prizePerWinner === BigInt(0)}
                                  className="key-shadow border border-[#77705f] bg-[#e65b2f] px-3 py-1.5 text-[9px] font-bold uppercase text-white disabled:opacity-50"
                                >
                                  {distributing[index] ? 'Sending…' : `Distribute ${formatEth(prizePerWinner, 3)}`}
                                </button>
                              ) : tw && tw.claimed ? (
                                <span className="text-[#56705a] text-[9px] font-bold uppercase">Paid</span>
                              ) : (
                                <span className="text-[#847d6e]">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {distributeMsg && (
                  <div className="border-t border-[#8f8878] bg-[#eee8dc] p-3">
                    <p className="text-[10px] font-mono break-all">{distributeMsg}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <footer className="mx-auto mt-6 flex flex-col justify-between gap-2 text-[8px] font-bold uppercase tracking-[.14em] text-[#575347] sm:flex-row">
          <span>Contract: {FAX_CONTRACT}</span>
          <Link href="/" className="underline"><ArrowLeft size={10} className="inline" /> Back to office</Link>
        </footer>
      </div>
    </main>
  );
}
