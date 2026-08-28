import { createWalletClient, http, encodeFunctionData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

const GNOSIS_RPC = process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com';
const FAXTRAY = '0xb337eb5f7dad6f7f441c17cdde03e08220e9650d' as const;

const SAVE_ABI = [{
  name: 'saveFax', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'trayId', type: 'string' },
    { name: 'tokenURI_', type: 'string' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const DAILY_CAP = parseInt(process.env.GASLESS_DAILY_CAP || '100', 10);
const capCount: Record<string, number> = {};

function todayKey(): string { return new Date().toISOString().slice(0, 10); }
export function gaslessCapRemaining(): number {
  return Math.max(0, DAILY_CAP - (capCount[todayKey()] || 0));
}
function consumeCap(): boolean {
  const k = todayKey();
  if ((capCount[k] || 0) >= DAILY_CAP) return false;
  capCount[k] = (capCount[k] || 0) + 1;
  return true;
}

export function gaslessAvailable(): boolean {
  return !!(process.env.RELAYER_PRIVATE_KEY && gaslessCapRemaining() > 0);
}

export async function gaslessSaveFax(
  to: Hex,
  trayId: string,
  tokenURI: string,
): Promise<{ txHash: Hex } | { error: string }> {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk) return { error: 'Gasless relayer not configured' };
  if (!consumeCap()) return { error: 'Daily gasless save cap reached' };
  try {
    const account = privateKeyToAccount(pk.startsWith('0x') ? pk as Hex : `0x${pk}` as Hex);
    const client = createWalletClient({ account, chain: gnosis, transport: http(GNOSIS_RPC) });
    const data = encodeFunctionData({ abi: SAVE_ABI, functionName: 'saveFax', args: [to, trayId, tokenURI] });
    const hash = await client.sendTransaction({ to: FAXTRAY, data, chain: gnosis });
    return { txHash: hash };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Gasless save failed' };
  }
}
