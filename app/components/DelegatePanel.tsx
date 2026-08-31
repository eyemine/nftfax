'use client';

import { useState, useMemo } from 'react';
import { Loader2, ShieldCheck, UserCheck, AlertCircle, Check } from 'lucide-react';
import { getCollectionTheme, type CollectionKey } from '../lib/theme';
import {
  verifyOwnershipOrDelegate,
  sendDelegateERC721,
  type VerifyResult,
} from '../lib/delegate';

interface DelegatePanelProps {
  collection: CollectionKey;
  walletAddress: string;
}

type ActionStatus = 'idle' | 'checking' | 'granting' | 'granted';

export function DelegatePanel({ collection, walletAddress }: DelegatePanelProps) {
  const theme = useMemo(() => getCollectionTheme(collection), [collection]);

  const [tokenId, setTokenId] = useState('');
  const [vaultWallet, setVaultWallet] = useState('');
  const [hotWallet, setHotWallet] = useState(walletAddress);
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

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
      hotWallet: hotWallet.trim() || walletAddress,
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
        to: hotWallet.trim() || walletAddress,
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
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Token ID</span>
            <input
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              placeholder="1234"
              className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Hot wallet (delegate)</span>
            <input
              value={hotWallet}
              onChange={(e) => setHotWallet(e.target.value)}
              placeholder={walletAddress || '0x...'}
              className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
            />
            <p className="mt-1 text-[11px] uppercase tracking-wider text-[#625e52]">This wallet plays the fax game.</p>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.18em]">Cold vault wallet (owner)</span>
            <input
              value={vaultWallet}
              onChange={(e) => setVaultWallet(e.target.value)}
              placeholder="0x..."
              className="w-full border border-[#847d6e] bg-[#eee8dc] px-3 py-3 text-sm outline-none focus:border-[#e65b2f]"
            />
            <p className="mt-1 text-[11px] uppercase tracking-wider text-[#625e52]">Holds the {theme.collectionName} NFT.</p>
          </label>

          <button
            onClick={() => void handleCheck()}
            disabled={status === 'checking' || status === 'granting'}
            className="key-shadow flex w-full items-center justify-center gap-2 border border-[#77705f] bg-[#d8d0bf] px-5 py-3 text-[12px] font-bold uppercase tracking-[.12em] disabled:opacity-50"
          >
            {status === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
            Check delegation
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
              <p>1. Connect your cold wallet to MetaMask.</p>
              <p>2. Enter the hot wallet address you want to use.</p>
              <p>3. Approve the Delegate.xyz transaction.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
