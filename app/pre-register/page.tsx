'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy, useActiveWallet } from '@privy-io/react-auth';
import { LayersArrowDown, Radar, Loader2, Check, Users, AlertCircle, ArrowLeft, X, Send, Trophy } from 'lucide-react';
import Link from 'next/link';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';
import { SkinPanel } from '../components/SkinPanel';

type RegisterStatus = 'idle' | 'registering' | 'registered' | 'error';

interface LeaderboardEntry {
  collection: string;
  mints: number;
  maxHops: number;
  maxCommunities: number;
}

interface LeaderboardData {
  leaderboard?: LeaderboardEntry[];
  totalMints?: number;
  error?: string;
}

interface RolofaxEntry {
  handle: string;
  wallet: string;
  collection: string;
  ready: boolean;
  readyUntil?: number;
  createdAt: number;
}

export default function PreRegisterPage() {
  const { ready, authenticated, login, logout } = usePrivy();
  const activeWallet = useActiveWallet().wallet;
  const [collection, setCollection] = useState<CollectionKey>('deadfellaz');
  const theme = useMemo(() => getCollectionTheme(collection), [collection]);
  const walletAddress = activeWallet?.address?.toLowerCase() || '';

  const [faxTokenId, setFaxTokenId] = useState('');
  const prefix = useMemo(() => (theme.mailboxHint || theme.mailboxPlaceholder || collection).split('.')[0], [theme, collection]);
  const [readyReceive, setReadyReceive] = useState(true);
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [error, setError] = useState('');
  const [vaultWallet, setVaultWallet] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [entries, setEntries] = useState<RolofaxEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>({ leaderboard: [], totalMints: 0 });

  useEffect(() => {
    setFaxTokenId('');
    setStatus('idle');
    setError('');
    void loadEntries();
  }, [collection]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/tray/leaderboard', { cache: 'no-store' }).catch(() => null);
        if (res && res.ok) {
          const json = (await res.json()) as LeaderboardData;
          if (!cancelled) setLeaderboard(json);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadEntries() {
    try {
      const res = await fetch(`/api/telegraph/list?collection=${collection}`, { cache: 'no-store' });
      const json = (await res.json()) as { items?: RolofaxEntry[]; error?: string };
      setEntries(json.items ?? []);
    } catch {
      setEntries([]);
    }
  }

  async function register() {
    setError('');
    setStatus('registering');

    if (!walletAddress) {
      setError('Connect a wallet first.');
      setStatus('error');
      return;
    }

    const tokenPart = faxTokenId.trim().replace(/^\.+/, '');
    if (!tokenPart) {
      setError('Enter your token ID.');
      setStatus('error');
      return;
    }
    const h = `${prefix}.${tokenPart}`.toLowerCase();

    const vault = vaultWallet.trim().toLowerCase();
    const tok = tokenId.trim();
    if (vault && !/^0x[a-f0-9]{40}$/i.test(vault)) {
      setError('Invalid vault wallet address.');
      setStatus('error');
      return;
    }

    try {
      const res = await fetch('/api/telegraph/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: h,
          wallet: walletAddress,
          collection,
          ready: readyReceive,
          readyUntil: 0,
          vaultWallet: vault || undefined,
          tokenId: tok || undefined,
        }),
      });

      const json = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || 'Registration failed');
      }

      setStatus('registered');
      setFaxTokenId('');
      void loadEntries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStatus('error');
    }
  }

  async function removeEntry(entry: RolofaxEntry) {
    if (!walletAddress) return;
    if (entry.wallet.toLowerCase() !== walletAddress.toLowerCase()) {
      setError('You can only remove your own entries.');
      return;
    }
    try {
      const res = await fetch('/api/telegraph/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: entry.handle,
          wallet: entry.wallet,
          collection: entry.collection,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || 'Removal failed');
      }
      void loadEntries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Removal failed');
    }
  }

  const communityTotal = entries.length;
  const readyCount = entries.filter((e) => e.ready).length;

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-10" style={{ backgroundColor: '#c8c0ae' }}>
      <header className="mx-auto mb-5 flex max-w-6xl items-center justify-between border-b border-[#575244] pb-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-sm bg-[#25251f] text-[#efe8d8]"><Radar size={20} /></div>
          <div>
            <h1 className="text-lg sm:text-2xl font-black tracking-[-0.06em] sm:tracking-[-0.08em] leading-[0.95]">ROLOFAX<span style={{ color: theme.accent }}>™</span></h1>
            <p className="text-[11px] sm:text-[11px] font-bold uppercase tracking-[0.2em] sm:tracking-[0.28em] text-[#625e52]">Pre-registration for 15/08/2026</p>
          </div>
        </div>
        <Link href="/" className="key-shadow text-[11px] sm:text-[12px] font-bold uppercase tracking-[.12em] underline text-[#625e52] whitespace-nowrap"><ArrowLeft size={13} className="inline" /> Fax</Link>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <SkinPanel theme={theme} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            <span>Join the launch directory</span>
            <span className="flex items-center gap-2 text-[#456049]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#56705a]" /> Active</span>
          </div>

          <div className="p-5 md:p-8 space-y-4">
            <div className="border-2 border-[#e65b2f] bg-[#f5dcc8] p-3 text-center">
              <p className="text-[12px] font-black uppercase tracking-[.14em] text-[#8a3e1e]">⚡ Launch promotion — first 100 entries get 5 fax credits</p>
            </div>

            <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">
              Add your wallet and handle to the Day-1 player directory. Other players can forward faxes to active participants when their own chains stall.
            </p>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Community</span>
              <select
                value={collection}
                onChange={(e) => setCollection(e.target.value as CollectionKey)}
                className="key-shadow w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-[12px] font-bold uppercase"
              >
                {(['chonk', 'deadfellaz', 'normie', 'pow'] as const).map((k) => (
                  <option key={k} value={k}>{getCollectionTheme(k).collectionName}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Fax handle</span>
              <div className="flex">
                <span className="border border-r-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-sm font-bold">{prefix}.</span>
                <input
                  value={faxTokenId}
                  onChange={(e) => setFaxTokenId(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="1234"
                  inputMode="numeric"
                  className="min-w-0 flex-1 border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                />
                <span className="border border-l-0 border-[#847d6e] bg-[#d5cebf] px-3 py-3 text-xs">@fax</span>
              </div>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]">Just add your {theme.collectionName} token ID</span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Vault wallet (optional, Delegate.xyz)</span>
              <input
                value={vaultWallet}
                onChange={(e) => setVaultWallet(e.target.value)}
                placeholder="0x..."
                className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Token ID (optional, for delegation)</span>
              <input
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                placeholder="e.g. 123"
                className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
              />
            </label>

            <div className="border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[.18em] block mb-1">Wallet</span>
                {walletAddress && (
                  <button
                    onClick={() => void (async () => { await logout(); })()}
                    className="text-[11px] font-bold uppercase underline text-[#a94228]"
                  >
                    Sign out
                  </button>
                )}
              </div>
              {walletAddress ? (
                <span className="font-mono text-xs">{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span>
              ) : (
                <span className="text-[#625e52] text-xs">No wallet connected</span>
              )}
            </div>

            <label className="flex items-center gap-2 text-[12px] font-bold uppercase">
              <input
                type="checkbox"
                checked={readyReceive}
                onChange={(e) => setReadyReceive(e.target.checked)}
                className="h-4 w-4 accent-[#e65b2f]"
              />
              Signal ready to receive faxes on {new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit' })}
            </label>

            {!walletAddress ? (
              <button
                onClick={() => login({ loginMethods: ['wallet'] })}
                className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white"
              >
                <Users size={17} /> Connect wallet to rolofax
              </button>
            ) : (
              <button
                onClick={() => void register()}
                disabled={status === 'registering'}
                className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-4 text-xs font-black uppercase tracking-[.12em] text-white disabled:opacity-50"
              >
                {status === 'registering' ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                Join Rolofax Directory
              </button>
            )}

            {status === 'registered' && (
              <div className="border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold">
                <Check size={15} className="inline" /> Registered. You are in the Day-1 directory.
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </SkinPanel>

        <SkinPanel theme={theme} className="machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
          <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
            <span>Active player radar — {theme.collectionName}</span>
            <span>{readyCount}/{communityTotal} ready</span>
          </div>

          <div className="max-h-[500px] overflow-y-auto p-5 md:p-8">
            {entries.length === 0 ? (
              <p className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">No players registered for {theme.collectionName} yet. Be the first.</p>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => {
                  const isOwn = walletAddress && entry.wallet.toLowerCase() === walletAddress.toLowerCase();
                  return (
                  <div key={entry.handle} className={`flex items-center justify-between border border-[#847d6e] bg-[#eee8dc] px-3 py-2 ${isOwn ? '' : 'hover:border-[#e65b2f]'} transition-colors`}>
                    <div className="flex-1">
                      <p className="text-xs font-bold">{entry.handle}@fax</p>
                      <p className="text-[11px] uppercase tracking-wider text-[#625e52]">{entry.wallet.slice(0, 6)}…{entry.wallet.slice(-4)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.ready ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-[#456049]"><span className="h-2 w-2 rounded-full bg-[#56705a]" /> Ready</span>
                      ) : (
                        <span className="text-[11px] font-bold uppercase text-[#625e52]">Registered</span>
                      )}
                      {!isOwn && (
                        <Link
                          href={`/?to=${entry.handle}@fax`}
                          className="key-shadow flex items-center gap-1 border border-[#77705f] bg-[#d8d0bf] px-2 py-1 text-[11px] font-bold uppercase hover:bg-[#e65b2f] hover:text-white hover:border-[#983b21] transition-colors"
                          title={`Send fax to ${entry.handle}@fax`}
                        >
                          <Send size={10} /> Fax
                        </Link>
                      )}
                      {isOwn && (
                        <span className="text-[11px] font-bold uppercase text-[#847d6e]">You</span>
                      )}
                      {isOwn && (
                        <button
                          onClick={() => void removeEntry(entry)}
                          className="text-[#a94228] hover:text-[#c0392b]"
                          title="Remove from radar"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </SkinPanel>
      </div>

      <div className="mx-auto mt-4 max-w-6xl machine-shadow overflow-hidden rounded-[18px] border border-[#8f8878] bg-[#c8c0ae]">
        <div className="flex items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
          <span className="flex items-center gap-2"><Trophy size={14} /> Mint leaderboard by collection</span>
          <span className="text-[#615c50]">{leaderboard.totalMints ?? 0} total mints</span>
        </div>
        {leaderboard.leaderboard && leaderboard.leaderboard.length > 0 ? (
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="bg-[#b5ad9d] text-[11px] uppercase tracking-wider">
              <tr>
                <th className="border-b border-[#8f8878] p-3 font-bold">Collection</th>
                <th className="border-b border-[#8f8878] p-3 font-bold text-right">Mints</th>
                <th className="border-b border-[#8f8878] p-3 font-bold text-right">Max hops</th>
                <th className="border-b border-[#8f8878] p-3 font-bold text-right">Communities bridged</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.leaderboard.map((entry) => (
                <tr key={entry.collection} className="border-b border-[#8f8878]/50 hover:bg-[#e7e0d1]">
                  <td className="p-3 font-bold capitalize">{entry.collection}</td>
                  <td className="p-3 text-right font-black text-[#e65b2f]">{entry.mints}</td>
                  <td className="p-3 text-right">{entry.maxHops}</td>
                  <td className="p-3 text-right">{entry.maxCommunities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-5 text-center text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">No mints yet — be the first to forward and mint a fax chain</div>
        )}
      </div>
    </main>
  );
}
