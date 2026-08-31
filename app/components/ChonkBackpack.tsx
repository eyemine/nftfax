'use client';

import { useEffect, useState } from 'react';
import { useActiveWallet } from '@privy-io/react-auth';
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { buildTBAWithdrawTx } from '../lib/tba';

interface BackpackNFT {
  contract: string;
  tokenId: string;
  name: string;
  image: string;
  isFaxChain: boolean;
}

interface Backpack {
  chonkTokenId: string;
  tbaAddress: string;
  tbaViewerUrl: string;
  nfts: BackpackNFT[];
  faxChainCount: number;
}

interface BackpackSummary {
  wallet: string;
  totalChonks: number;
  totalFaxChainNFTs: number;
  backpacks: Backpack[];
}

interface ChonkBackpackProps {
  walletAddress: string;
}

interface WithdrawButtonProps {
  tbaAddress: `0x${string}`;
  nftContract: `0x${string}`;
  tokenId: string;
  recipient: `0x${string}`;
}

/// Withdraw an NFT from a Chonk's ERC-6551 backpack back to the owner's EOA.
/// Builds an executeCall() on the TBA and signs it directly with the user's
/// connected wallet — no intermediary, no tokenbound.org dependency.
interface EthereumWallet {
  address: `0x${string}`;
  getEthereumProvider: () => Promise<{ request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }>;
}

function WithdrawButton({ tbaAddress, nftContract, tokenId, recipient }: WithdrawButtonProps) {
  const { wallet } = useActiveWallet();
  const [status, setStatus] = useState<'idle' | 'withdrawing' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  if (status === 'success' && txHash) {
    return (
      <a
        href={`https://basescan.org/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[11px] font-bold uppercase text-[#456049] hover:text-[#2c4230]"
      >
        Sent ✓ <ExternalLink size={10} />
      </a>
    );
  }

  const ethWallet = wallet && typeof (wallet as unknown as EthereumWallet).getEthereumProvider === 'function'
    ? (wallet as unknown as EthereumWallet)
    : null;
  const disabled = !ethWallet || status === 'withdrawing';

  const handleWithdraw = async () => {
    if (!ethWallet) return;
    setStatus('withdrawing');
    setError('');
    try {
      const tx = buildTBAWithdrawTx(tbaAddress, nftContract, tokenId, recipient);
      const provider = await ethWallet.getEthereumProvider();
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: ethWallet.address,
          to: tx.to,
          data: tx.data,
          value: '0x0',
        }],
      });
      setTxHash(hash as string);
      setStatus(hash ? 'success' : 'error');
      if (!hash) setError('No transaction hash returned');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Withdraw failed');
      console.error('[WithdrawButton] error:', err);
    }
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        onClick={handleWithdraw}
        disabled={disabled}
        className="flex items-center gap-1 text-[11px] font-bold uppercase text-[#8a3e1e] hover:text-[#e65b2f] disabled:text-[#a49c8b] disabled:hover:text-[#a49c8b]"
      >
        {status === 'withdrawing' ? <Loader2 className="animate-spin" size={10} /> : <ExternalLink size={10} />}
        {status === 'withdrawing' ? 'Withdrawing…' : 'Withdraw'}
      </button>
      {status === 'error' && <span className="max-w-[160px] text-right text-[10px] font-bold uppercase text-[#a94228]">{error}</span>}
    </span>
  );
}

/// Chonks backpack viewer — built into nftfax.app so Chonk holders can see
/// which of their FAX CHAIN NFTs have been saved into a Chonk's ERC-6551
/// backpack, without depending on the (currently broken) tokenbound.org.
export function ChonkBackpack({ walletAddress }: ChonkBackpackProps) {
  const [data, setData] = useState<BackpackSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/chonks/backpack?wallet=${walletAddress}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json: BackpackSummary & { error?: string }) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [walletAddress]);

  if (!walletAddress) {
    return <p className="text-[12px] font-bold uppercase text-[#696457]">Connect your wallet to view your Chonk backpacks.</p>;
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-[12px] font-bold uppercase text-[#696457]"><Loader2 className="animate-spin" size={14} /> Scanning backpacks…</div>;
  }

  if (error) {
    return <div className="border-l-4 border-[#a94228] bg-[#e2c9bc] p-3 text-[12px] font-bold uppercase">FAULT: {error}</div>;
  }

  if (!data || data.totalChonks === 0) {
    return (
      <p className="text-[12px] font-bold uppercase text-[#696457]">
        No Chonks found in this wallet. <a href="https://www.chonks.xyz/" target="_blank" rel="noopener noreferrer" className="underline text-[#e65b2f]">Get a Chonk →</a>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] font-bold uppercase">
        <span className="text-[#615c50]">{data.totalChonks} Chonk{data.totalChonks !== 1 ? 's' : ''}</span>
        <span className="text-[#a49c8b]">·</span>
        <span className="text-[#8a3e1e]">{data.totalFaxChainNFTs} FAX CHAIN NFT{data.totalFaxChainNFTs !== 1 ? 's' : ''}</span>
      </div>

      {data.backpacks.map((bp) => {
        const isOpen = expanded.has(bp.chonkTokenId);
        return (
          <div key={bp.chonkTokenId} className="border border-[#8f8878] bg-[#c8c0ae]">
            <button
              onClick={() => {
                const next = new Set(expanded);
                isOpen ? next.delete(bp.chonkTokenId) : next.add(bp.chonkTokenId);
                setExpanded(next);
              }}
              className="flex w-full items-center justify-between border-b border-[#8f8878] bg-[#b5ad9d] px-3 py-2 text-left hover:bg-[#a9a189]"
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold uppercase">Chonk #{bp.chonkTokenId}</span>
                {bp.faxChainCount > 0 && <span className="border border-[#c08a2f] bg-[#f5dcc8] px-1.5 py-0.5 text-[11px] font-bold uppercase text-[#8a3e1e]">{bp.faxChainCount} FAX</span>}
                <span className="text-[11px] font-bold uppercase text-[#847d6e]">{bp.nfts.length} item{bp.nfts.length !== 1 ? 's' : ''}</span>
              </div>
              {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {isOpen && (
              <div className="space-y-2 p-3">
                {bp.nfts.length === 0 ? (
                  <p className="text-[11px] font-bold uppercase text-[#696457]">
                    Nothing saved in this backpack yet. <a href="/" className="underline text-[#e65b2f]">Mint a FAX CHAIN NFT →</a>
                  </p>
                ) : (
                  bp.nfts.map((nft) => (
                    <div key={`${nft.contract}-${nft.tokenId}`} className={`flex items-center gap-3 border p-2 ${nft.isFaxChain ? 'border-[#c08a2f] bg-[#f5dcc8]' : 'border-[#a9a189] bg-[#eee8dc]'}`}>
                      {nft.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={nft.image} alt={nft.name} className="h-10 w-10 rounded-sm bg-[#d5cebf] object-cover" />
                      ) : (
                        <div className="grid h-10 w-10 place-items-center rounded-sm bg-[#d5cebf] text-[9px] uppercase text-[#847d6e]">NFT</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-bold">{nft.name}{nft.isFaxChain && <span className="ml-1.5 border border-[#c08a2f] bg-[#f5dcc8] px-1 py-0.5 text-[9px] font-bold uppercase text-[#8a3e1e]">FAX</span>}</p>
                        <p className="truncate font-mono text-[11px] text-[#847d6e]">#{nft.tokenId}</p>
                      </div>
                      <a
                        href={`https://basescan.org/nft/${nft.contract}/${nft.tokenId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-bold uppercase text-[#847d6e] hover:text-[#e65b2f]"
                      >
                        BaseScan <ExternalLink size={10} />
                      </a>
                      <WithdrawButton
                        tbaAddress={bp.tbaAddress as `0x${string}`}
                        nftContract={nft.contract as `0x${string}`}
                        tokenId={nft.tokenId}
                        recipient={walletAddress as `0x${string}`}
                      />
                    </div>
                  ))
                )}

                <div className="border-t border-[#a9a189] pt-2">
                  <a
                    href={bp.tbaViewerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold uppercase text-[#847d6e] hover:text-[#615c50]"
                  >
                    TBA: {bp.tbaAddress.slice(0, 6)}…{bp.tbaAddress.slice(-4)} ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
