/// Chain-letter collectible contracts (PLACEHOLDER).
///
/// These are stand-ins so the Mint (Base) and Save (Gnosis) buttons are wired
/// end-to-end today. Until real contracts are deployed the on-chain broadcast
/// is skipped and the action is recorded off-chain by the worker (the fax is
/// still persisted / flagged). Swap in the deployed addresses + set a non-zero
/// value and the gallery will broadcast the real transaction automatically.

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

// ---- PLACEHOLDER addresses — replace with deployed NFTfax contracts. ----
// Base: the tradeable chain-letter collectible (mint).
export const BASE_FAX_COLLECTIBLE = '0x0000000000000000000000000000000000000000';
// Gnosis: the permanence / archive anchor (save).
export const GNOSIS_FAX_ARCHIVE = '0x0000000000000000000000000000000000000000';

// Intended mint/archive signatures for when the real contracts land.
// e.g. keccak256('mintFax(string)').slice(0,10) — kept here for reference so
// the encoder can be dropped in without hunting for the ABI.
export const BASE_MINT_SIGNATURE = 'mintFax(string)';
export const GNOSIS_ARCHIVE_SIGNATURE = 'archiveFax(string)';

export function isPlaceholderAddress(addr: string): boolean {
  return !addr || /^0x0{40}$/i.test(addr);
}

export const MINT_CONFIG = {
  chain: BASE_CHAIN,
  contract: BASE_FAX_COLLECTIBLE,
  signature: BASE_MINT_SIGNATURE,
} as const;

export const SAVE_CONFIG = {
  chain: GNOSIS_CHAIN,
  contract: GNOSIS_FAX_ARCHIVE,
  signature: GNOSIS_ARCHIVE_SIGNATURE,
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
