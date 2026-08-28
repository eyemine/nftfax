/// Chain-letter collectible contracts.
///
/// Base (mint) is live: BASE_FAX_COLLECTIBLE is the deployed NFTFaxCollectible
/// (contracts/src/NFTFaxCollectible.sol) — see app/lib/fax-mint.ts for the
/// actual mintFaxOnChain/mintFaxDirect calldata encoding. Gnosis (save) is
/// still a placeholder: until GNOSIS_FAX_ARCHIVE is deployed, the on-chain
/// broadcast is skipped and the action is recorded off-chain by the worker
/// (the fax is still persisted / flagged).

export interface ChainConfig {
  id: number;
  hexId: string;
  name: string;
  explorer: string;
  rpcUrl: string;
  currency: { name: string; symbol: string; decimals: number };
}

export const BASE_CHAIN: ChainConfig = {
  id: 8453,
  hexId: '0x2105',
  name: 'Base',
  explorer: 'https://basescan.org',
  rpcUrl: 'https://mainnet.base.org',
  currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

export const GNOSIS_CHAIN: ChainConfig = {
  id: 100,
  hexId: '0x64',
  name: 'Gnosis',
  explorer: 'https://gnosisscan.io',
  rpcUrl: 'https://rpc.gnosischain.com',
  currency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
};

// Base: the tradeable chain-letter collectible (mint) — V2 deployed, live.
// V1: 0x0093D896E677831D4e1fe92F3E548Ca72D3CD5FE
export const BASE_FAX_COLLECTIBLE = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
// Gnosis: the permanence / archive anchor (save) — FaxTray deployed on Gnosis mainnet.
export const GNOSIS_FAX_ARCHIVE = '0xb337eb5f7dad6f7f441c17cdde03e08220e9650d';

export function isPlaceholderAddress(addr: string): boolean {
  return !addr || /^0x0{40}$/i.test(addr);
}

/// Minting pause — set to false when V2 contract is deployed and ready.
export const MINT_PAUSED = false;
export const MINT_RESUME_AT = '24 Aug 2026, 02:00 UTC';

export const MINT_CONFIG = {
  chain: BASE_CHAIN,
  contract: BASE_FAX_COLLECTIBLE,
} as const;

export const SAVE_CONFIG = {
  chain: GNOSIS_CHAIN,
  contract: GNOSIS_FAX_ARCHIVE,
} as const;

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/// Best-effort switch of the connected wallet to the target chain, adding it
/// if unknown. Non-fatal: returns false if the wallet rejects or errors.
export async function switchToChain(provider: Eip1193Provider, chain: ChainConfig): Promise<boolean> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hexId }] });
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chain.hexId,
            chainName: chain.name,
            nativeCurrency: chain.currency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.explorer],
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
