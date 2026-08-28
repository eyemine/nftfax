/// Chonks (Base) — resolves the deployed ERC-6551 backpack address for a
/// given Chonk token ID via the canonical getter on the ChonksMain contract.
///
/// Verified 2026-08-18: tokenIdToTBAAccountAddress(588) on
/// 0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9 (Base) returns
/// 0x2859085536aa0d9695d967fd201164120d7077bb, matching the backpack address
/// shown on chonks.xyz for that token.

export const CHONKS_MAIN_CONTRACT = '0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9';

// keccak256('tokenIdToTBAAccountAddress(uint256)').slice(0, 10)
const TOKEN_ID_TO_TBA_SELECTOR = '0x9c05d68d';

function encodeUint256(val: string | number | bigint): string {
  return BigInt(val).toString(16).padStart(64, '0');
}

function isZeroAddress(addr: string | null): boolean {
  return !addr || /^0x0{40}$/i.test(addr);
}

interface RpcResponse {
  result?: string;
  error?: unknown;
}

export interface ResolveChonkBackpackResult {
  backpack: string | null;
  error?: string;
}

/**
 * Looks up the ERC-6551 backpack (token-bound account) address for a Chonk
 * token ID by calling tokenIdToTBAAccountAddress(tokenId) directly on the
 * ChonksMain contract. Returns { backpack: null } (not an error) if the
 * contract returns the zero address — callers should fall back to the
 * owner's EOA in that case rather than treating it as fatal.
 */
export async function resolveChonkBackpack(
  tokenId: string | number | bigint,
  rpcUrl: string,
  contract: string = CHONKS_MAIN_CONTRACT,
): Promise<ResolveChonkBackpackResult> {
  try {
    const data = TOKEN_ID_TO_TBA_SELECTOR + encodeUint256(tokenId);
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: contract, data }, 'latest'],
      }),
    });

    const json = (await res.json()) as RpcResponse;
    if (!json.result || json.result === '0x' || json.result.length < 40) {
      return { backpack: null };
    }

    const backpack = `0x${json.result.slice(-40)}`.toLowerCase();
    return { backpack: isZeroAddress(backpack) ? null : backpack };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { backpack: null, error };
  }
}
