import { NextResponse } from 'next/server';
import { createPublicClient, http, type Address, type Chain } from 'viem';
import { base, mainnet } from 'viem/chains';

const CHAIN_MAP: Record<number, Chain> = {
  8453: base,
  1: mainnet,
};

const ERC721_ENUMERABLE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const MAX_TOKENS = 200;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get('wallet')?.toLowerCase();
  const contract = searchParams.get('contract')?.toLowerCase();
  const chainIdRaw = searchParams.get('chainId');
  const rpc = searchParams.get('rpc');

  if (!wallet || !contract || !chainIdRaw) {
    return NextResponse.json({ error: 'Missing wallet, contract, or chainId' }, { status: 400 });
  }

  const chainId = Number(chainIdRaw);
  const viemChain = CHAIN_MAP[chainId];
  if (!viemChain) {
    return NextResponse.json({ error: `Unsupported chainId: ${chainId}` }, { status: 400 });
  }

  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpc || undefined),
  });

  try {
    const balance = await client.readContract({
      address: contract as Address,
      abi: ERC721_ENUMERABLE_ABI,
      functionName: 'balanceOf',
      args: [wallet as Address],
    });

    const count = Math.min(Number(balance), MAX_TOKENS);
    if (count === 0) {
      return NextResponse.json({ tokenIds: [] });
    }

    const calls = Array.from({ length: count }, (_, i) => ({
      address: contract as Address,
      abi: ERC721_ENUMERABLE_ABI,
      functionName: 'tokenOfOwnerByIndex' as const,
      args: [wallet as Address, BigInt(i)] as const,
    }));

    const results = await client.multicall({ contracts: calls });
    const tokenIds: number[] = [];
    for (const r of results) {
      if (r.status === 'success') {
        tokenIds.push(Number(r.result));
      }
    }
    tokenIds.sort((a, b) => a - b);

    return NextResponse.json({ tokenIds });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch tokens';
    if (msg.includes('revert') || msg.includes('execution reverted')) {
      return NextResponse.json({ tokenIds: [], note: 'Contract may not support ERC-721 Enumerable' });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
