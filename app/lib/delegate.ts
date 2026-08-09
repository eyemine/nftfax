export const DELEGATE_REGISTRY_V2 = '0x00000000000000447e69651d841bD8D104Bed493';

const CHECK_DELEGATE_SELECTOR = '0xb9f36874';
const DELEGATE_ERC721_SELECTOR = '0xb18e2bbb';
const EMPTY_RIGHTS = '0'.padEnd(64, '0');

function encodeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function encodeUint256(val: string | number | bigint): string {
  return BigInt(val).toString(16).padStart(64, '0');
}

interface RpcResponse {
  result?: string;
  error?: unknown;
}

export interface CheckDelegateParams {
  hotWallet: string;
  vaultWallet: string;
  contract: string;
  tokenId: string | number | bigint;
  rpcUrl: string;
}

export interface CheckDelegateResult {
  isDelegated: boolean;
  error?: string;
}

export async function checkDelegateForERC721({
  hotWallet,
  vaultWallet,
  contract,
  tokenId,
  rpcUrl,
}: CheckDelegateParams): Promise<CheckDelegateResult> {
  try {
    const data =
      CHECK_DELEGATE_SELECTOR +
      encodeAddress(hotWallet) +
      encodeAddress(vaultWallet) +
      encodeAddress(contract) +
      encodeUint256(tokenId) +
      EMPTY_RIGHTS;

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: DELEGATE_REGISTRY_V2, data }, 'latest'],
      }),
    });

    const json = (await res.json()) as RpcResponse;
    if (!json.result || json.result === '0x') {
      return { isDelegated: false };
    }

    return { isDelegated: BigInt(json.result) !== BigInt(0) };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { isDelegated: false, error };
  }
}

export interface VerifyParams {
  contract: string;
  tokenId: string | number | bigint;
  rpcUrl: string;
  hotWallet: string;
  vaultWallet?: string;
}

export interface VerifyResult {
  verified: boolean;
  isOwner: boolean;
  isDelegate: boolean;
  actualOwner: string | null;
  vaultWallet: string | null;
  error?: string;
}

export async function verifyOwnershipOrDelegate({
  contract,
  tokenId,
  rpcUrl,
  hotWallet,
  vaultWallet,
}: VerifyParams): Promise<VerifyResult> {
  const hot = hotWallet.toLowerCase();
  let actualOwner: string | null = null;

  try {
    const tokenIdHex = encodeUint256(tokenId);
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: contract, data: `0x6352211e${tokenIdHex}` }, 'latest'],
      }),
    });

    const json = (await res.json()) as RpcResponse;
    if (json.result && json.result !== '0x' && json.result.length >= 40) {
      actualOwner = `0x${json.result.slice(-40)}`.toLowerCase();
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { verified: false, isOwner: false, isDelegate: false, actualOwner: null, vaultWallet: null, error };
  }

  if (actualOwner === hot) {
    return { verified: true, isOwner: true, isDelegate: false, actualOwner, vaultWallet: actualOwner };
  }

  const vault = vaultWallet?.toLowerCase() ?? actualOwner;
  if (vault && vault !== hot) {
    const { isDelegated, error } = await checkDelegateForERC721({
      hotWallet: hot,
      vaultWallet: vault,
      contract,
      tokenId,
      rpcUrl,
    });

    if (isDelegated) {
      return { verified: true, isOwner: false, isDelegate: true, actualOwner, vaultWallet: vault };
    }

    return {
      verified: false,
      isOwner: false,
      isDelegate: false,
      actualOwner,
      vaultWallet: vault,
      error: error ?? 'Connected wallet is not owner or delegate for this token.',
    };
  }

  return {
    verified: false,
    isOwner: false,
    isDelegate: false,
    actualOwner,
    vaultWallet: vault ?? null,
    error: actualOwner ? 'Connected wallet is not owner or delegate for this token.' : 'Token not found on-chain.',
  };
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: EthereumProvider };
  return w.ethereum ?? null;
}

export interface DelegateTxParams {
  /** Address of the cold vault wallet that will sign the delegation tx. */
  fromAccount: string;
  /** Address of the hot wallet receiving delegation rights. */
  to: string;
  /** The NFT contract address. */
  contract: string;
  tokenId: string | number | bigint;
}

export interface DelegateTxResult {
  txHash?: string;
  error?: string;
}

export async function sendDelegateERC721({
  fromAccount,
  to,
  contract,
  tokenId,
}: DelegateTxParams): Promise<DelegateTxResult> {
  const provider = getProvider();
  if (!provider) {
    return { error: 'MetaMask or an EIP-1193 wallet is required.' };
  }

  const data =
    DELEGATE_ERC721_SELECTOR +
    encodeAddress(to) +
    encodeAddress(contract) +
    encodeUint256(tokenId) +
    EMPTY_RIGHTS +
    encodeUint256(1);

  try {
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: fromAccount, to: DELEGATE_REGISTRY_V2, data }],
    });

    return { txHash: typeof txHash === 'string' ? txHash : undefined };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { error };
  }
}
