'use client';

import { useState, useMemo, useEffect } from 'react';
import { Loader2, ShieldCheck, UserCheck, AlertCircle, Check } from 'lucide-react';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';
import { FaxHandleThumb } from './FaxHandleThumb';
import {
  verifyOwnershipOrDelegate,
  sendDelegateERC721,
  type VerifyResult,
} from '../lib/delegate';

interface DelegatePanelProps {
  collection: CollectionKey;
  walletAddress: string;
  /** Opens the wallet picker for step 1. Omit to show a static badge. */
  onConnect?: () => void;
}

type ActionStatus = 'idle' | 'checking' | 'granting' | 'granted';

const COLLECTIONS: CollectionKey[] = ['chonk', 'deadfellaz', 'normie', 'pow'];

export function DelegatePanel({ collection, walletAddress, onConnect }: DelegatePanelProps) {
  // Selectable here rather than inherited: delegation is set up for whichever
  // collection holds the NFT, which is not necessarily the skin currently on
  // screen. The prop is only the starting point.
  const [selected, setSelected] = useState<CollectionKey>(collection);
  const theme = useMemo(() => getCollectionTheme(selected), [selected]);
  const prefix = useMemo(
    () => (theme.mailboxHint || theme.mailboxPlaceholder || selected).split('.')[0],
    [theme, selected],
  );

  const [ownedTokenIds, setOwnedTokenIds] = useState<number[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);

  const [tokenId, setTokenId] = useState('');
  // The flow is "connect your COLD wallet, type the hot one", so the vault
  // seeds from the connection and the hot wallet starts empty. It was the
  // other way round, which contradicted the instructions beside it.
  const [vaultWallet, setVaultWallet] = useState(walletAddress);
  const [hotWallet, setHotWallet] = useState('');
  /// Resolved address for an ENS name typed into the hot-wallet field, plus its
  /// lookup state. Kept separate from the raw input so the field still shows
  /// what the player typed.
  const [hotResolved, setHotResolved] = useState<string | null>(null);
  const [hotResolving, setHotResolving] = useState(false);
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  /// Lists qualifying tokens for the wallet that actually holds the NFT.
  ///
  /// That is the cold vault, not the connected wallet: in a delegation the hot
  /// wallet holds nothing, so listing its tokens would return an empty set and
  /// look broken. Falls back to the connected wallet before a vault is entered,
  /// which covers the case of connecting the vault directly.
  const lookupWallet = /^0x[a-fA-F0-9]{40}$/.test(vaultWallet.trim())
    ? vaultWallet.trim()
    : walletAddress;

  useEffect(() => {
    if (!lookupWallet || !theme.contract || !theme.chainId) {
      setOwnedTokenIds([]);
      return;
    }
    let cancelled = false;
    setLoadingTokens(true);
    void (async () => {
      try {
        const params = new URLSearchParams({
          wallet: lookupWallet,
          contract: theme.contract,
          chainId: String(theme.chainId),
          rpc: theme.rpc,
        });
        const res = await fetch(`/api/nft-tokens?${params}`, { cache: 'no-store' });
        if (res.ok) {
          const json = (await res.json()) as { tokenIds?: number[] };
          if (!cancelled) setOwnedTokenIds(json.tokenIds ?? []);
        }
      } catch {
        // Non-fatal: the manual Token ID field still works.
      }
      if (!cancelled) setLoadingTokens(false);
    })();
    return () => { cancelled = true; };
  }, [lookupWallet, theme.contract, theme.chainId, theme.rpc]);

  // A token id is meaningless across collections, so clear it on switch.
  useEffect(() => {
    setTokenId('');
    setOwnedTokenIds([]);
  }, [selected]);

  useEffect(() => {
    if (walletAddress) setVaultWallet((prev) => prev || walletAddress);
  }, [walletAddress]);

  // Resolve an ENS name in the hot-wallet field, debounced so each keystroke
  // does not cost a lookup.
  useEffect(() => {
    const raw = hotWallet.trim().toLowerCase();
    if (!raw || !raw.includes('.') || raw.startsWith('0x')) {
      setHotResolved(null);
      setHotResolving(false);
      return;
    }
    let cancelled = false;
    setHotResolving(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/ens?name=${encodeURIComponent(raw)}`, { cache: 'no-store' });
          const json = await res.json() as { address?: string | null };
          if (!cancelled) setHotResolved(json.address ?? null);
        } catch {
          if (!cancelled) setHotResolved(null);
        }
        if (!cancelled) setHotResolving(false);
      })();
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hotWallet]);

  /// The address the delegation actually grants to.
  ///
  /// An ENS name cannot be sent on-chain, so a resolved name MUST be swapped
  /// for its address before building the transaction — otherwise the grant
  /// would either revert or, worse, target the wrong account.
  const effectiveHotWallet = hotResolved || hotWallet.trim() || walletAddress;

  async function handleCheck() {
    setError('');
    setResult(null);
    setTxHash('');
    setStatus('checking');

    if (!tokenId.trim() || !vaultWallet.trim()) {
      setError('Enter a token ID and the cold vault wallet address.');
      setStatus('idle');
      return;
    }

    const res = await verifyOwnershipOrDelegate({
      contract: theme.contract,
      tokenId,
      rpcUrl: theme.rpc,
      hotWallet: effectiveHotWallet,
      vaultWallet: vaultWallet.trim(),
    });

    setResult(res);
    setStatus('idle');
  }

  async function handleGrant() {
    setError('');
    setTxHash('');
    setStatus('granting');

    if (typeof window === 'undefined' || !(window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum) {
      setError('MetaMask or an EIP-1193 wallet is required.');
      setStatus('idle');
      return;
    }

    try {
      const accounts = (await (window as unknown as { ethereum: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum.request({
        method: 'eth_requestAccounts',
        params: [],
      })) as string[] | undefined;

      const cold = accounts?.[0];
      if (!cold) {
        setError('No vault account selected in wallet.');
        setStatus('idle');
        return;
      }

      const res = await sendDelegateERC721({
        fromAccount: cold,
        to: effectiveHotWallet,
        contract: theme.contract,
        tokenId,
      });

      if (res.error) {
        setError(res.error);
      } else {
        setTxHash(res.txHash ?? '');
        setStatus('granted');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  }

  const canGrant = result ? result.isOwner || result.actualOwner === walletAddress.toLowerCase() : false;

  return (
    <div className="space-y-4">
      <div className="border-b border-[#8f8878] bg-[#b5ad9d] px-5 py-3 text-[12px] font-bold uppercase tracking-[.16em]">
        <span>Delegate.xyz registry — {theme.collectionName}</span>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2 md:p-8">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Community</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value as CollectionKey)}
              className="key-shadow w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-2 text-[12px] font-bold uppercase"
            >
              {COLLECTIONS.map((key) => (
                <option key={key} value={key}>{getCollectionTheme(key).collectionName}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Token ID</span>

            {/* Fixed-height slot: this position cycles between the dropdown and
                two different messages, and letting them size themselves would
                shift everything below as the token list resolves. */}
            <div className="mb-2 flex h-[34px] items-center">
              {ownedTokenIds.length > 0 ? (
                <select
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value)}
                  className="h-[34px] w-full border border-[#847d6e] bg-[#eee8dc] px-3 text-xs outline-none focus:border-[#e65b2f]"
                >
                  <option value="">Select a qualifying {theme.collectionName}…</option>
                  {ownedTokenIds.map((tid) => (
                    <option key={tid} value={String(tid)}>{prefix}.{tid}</option>
                  ))}
                </select>
              ) : loadingTokens ? (
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]"><Loader2 size={12} className="animate-spin" /> Reading {theme.collectionName} tokens…</p>
              ) : (
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#847d6e]">No {theme.collectionName} tokens in that wallet</p>
              )}
            </div>

            <div className="flex items-start gap-3">
              <FaxHandleThumb
                handle={tokenId ? `${prefix}.${tokenId}` : ''}
                size={96}
                label="Delegating"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="1234"
                  inputMode="numeric"
                  className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
                />
                <p className="mt-1 text-[11px] uppercase tracking-wider text-[#625e52]">
                  {ownedTokenIds.length > 0 ? 'Select above or type a token ID.' : 'Enter the token ID held by the vault.'}
                </p>
              </div>
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em]">
              <span>1.</span>
              {walletAddress ? (
                <span className="border border-[#56705a] bg-[#cad8c7] px-1.5 py-0.5 text-[10px] text-[#2f4a33]">Connected</span>
              ) : onConnect ? (
                <button
                  type="button"
                  onClick={onConnect}
                  className="key-shadow border border-[#983b21] bg-[#e65b2f] px-1.5 py-0.5 text-[10px] uppercase text-white"
                >
                  Connect
                </button>
              ) : (
                <span className="border border-[#a94228] bg-[#e2c9bc] px-1.5 py-0.5 text-[10px] text-[#a94228]">Connect</span>
              )}
              <span>Cold vault wallet (NFT owner)</span>
            </span>
            <input
              value={vaultWallet}
              onChange={(e) => setVaultWallet(e.target.value)}
              placeholder="0x..."
              className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
            />
            {/* collectionName already ends in "NFT" for POW NFT, which produced
                "Holds the POW NFT NFT." */}
            <p className="mt-1 text-[11px] uppercase tracking-wider text-[#625e52]">
              Holds the {theme.collectionName}{/NFTs?$/i.test(theme.collectionName) ? '' : ' NFT'}.
            </p>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">2. Hot wallet (delegate)</span>
            <input
              value={hotWallet}
              onChange={(e) => setHotWallet(e.target.value)}
              placeholder="0x… / ENS name"
              className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
            />
            {/* Show the resolved address explicitly. Delegating to the wrong
                account is unrecoverable from this UI, so the player should see
                exactly what the transaction will grant to rather than trusting
                that a name resolved the way they expected. */}
            {hotResolving ? (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#847d6e]">
                <Loader2 size={11} className="animate-spin" /> Resolving ENS…
              </p>
            ) : hotResolved ? (
              <p className="mt-1 break-all text-[11px] font-bold uppercase tracking-wider text-[#2f4a33]">
                <Check size={11} className="inline" /> {hotResolved}
              </p>
            ) : hotWallet.trim().includes('.') && !hotWallet.trim().startsWith('0x') ? (
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-[#a94228]">
                No address record for that name
              </p>
            ) : null}
            <p className="mt-1 text-[11px] uppercase tracking-wider text-[#625e52]">This wallet will play the fax game.</p>
          </label>

          <button
            onClick={() => void handleCheck()}
            disabled={status === 'checking' || status === 'granting'}
            className="key-shadow flex w-full items-center justify-center gap-2 border border-[#77705f] bg-[#d8d0bf] px-5 py-3 text-[12px] font-bold uppercase tracking-[.12em] disabled:opacity-50"
          >
            {status === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
            3. Check delegation
          </button>
        </div>

        <div className="space-y-4 border-t border-[#8f8878] pt-4 md:border-t-0 md:border-l md:pl-8 md:pt-0">
          {error && (
            <div className="flex items-start gap-2 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {result.verified ? (
                <div className="flex items-center gap-2 border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold">
                  <Check size={15} />
                  {result.isOwner ? 'Connected wallet owns this token.' : 'Connected wallet is a delegated hot wallet.'}
                </div>
              ) : (
                <div className="flex items-start gap-2 border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold">
                  <AlertCircle size={15} />
                  <span>{result.error ?? 'Not verified.'}</span>
                </div>
              )}

              {result.actualOwner && (
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#625e52]">
                  On-chain owner: {result.actualOwner.slice(0, 6)}…{result.actualOwner.slice(-4)}
                </p>
              )}

              {canGrant && (
                <button
                  onClick={() => void handleGrant()}
                  disabled={status === 'granting' || status === 'granted'}
                  className="key-shadow flex w-full items-center justify-center gap-2 border border-[#983b21] bg-[#e65b2f] px-5 py-3 text-[12px] font-bold uppercase tracking-[.12em] text-white disabled:opacity-50"
                >
                  {status === 'granting' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                  Grant delegation to hot wallet
                </button>
              )}

              {status === 'granted' && txHash && (
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block border-l-4 border-[#56705a] bg-[#cad8c7] p-3 text-[12px] font-bold underline"
                >
                  Delegation transaction: {txHash.slice(0, 10)}…
                </a>
              )}
            </div>
          )}

          {!result && !error && (
            <div className="text-[12px] font-bold uppercase tracking-[.12em] text-[#625e52]">
              <p className="mb-2">NFT holders can keep their NFT in cold storage while a hot wallet plays the chain game.</p>
              <p>1. Connect your cold wallet to MetaMask that holds the {theme.collectionName} NFT.</p>
              <p>2. Enter the hot wallet address you want to use to Fax.</p>
              <p>3. Approve the Delegate.xyz transaction.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
