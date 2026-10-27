// GET /api/chonks/minted?ids=599,7332,...
//
// Which of these Chonks hold a FAX CHAIN NFT in their ERC-6551 backpack.
// Two multicalls on Base regardless of list size: resolve each backpack via
// tokenIdToTBAAccountAddress, then balanceOf(backpack) on the collectible.

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { base } from 'viem/chains';
import { BASE_CHAIN, BASE_FAX_COLLECTIBLE } from '../../../lib/contracts';
import { CHONKS_MAIN_CONTRACT } from '../../../lib/chonks';

const client = createPublicClient({ chain: base, transport: http(BASE_CHAIN.rpcUrl), batch: { multicall: true } });
const MAX_IDS = 500;
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; minted: boolean }>();

export async function GET(req: NextRequest) {
  const ids = Array.from(new Set((req.nextUrl.searchParams.get('ids') || '')
    .split(',').map((s) => s.trim()).filter((s) => /^\d{1,6}$/.test(s)))).slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ minted: [] });

  const now = Date.now();
  const todo = ids.filter((id) => !(cache.get(id) && now - cache.get(id)!.at < TTL_MS));
  try {
    if (todo.length) {
      const tbas = await client.multicall({
        allowFailure: true,
        contracts: todo.map((id) => ({
          address: CHONKS_MAIN_CONTRACT as Address,
          abi: parseAbi(['function tokenIdToTBAAccountAddress(uint256) view returns (address)']),
          functionName: 'tokenIdToTBAAccountAddress' as const,
          args: [BigInt(id)],
        })),
      });
      const withTba = todo
        .map((id, i) => ({ id, tba: tbas[i].status === 'success' ? (tbas[i].result as Address) : null }))
        .filter((x): x is { id: string; tba: Address } => !!x.tba && !/^0x0{40}$/i.test(x.tba));
      const balances = await client.multicall({
        allowFailure: true,
        contracts: withTba.map(({ tba }) => ({
          address: BASE_FAX_COLLECTIBLE as Address,
          abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
          functionName: 'balanceOf' as const,
          args: [tba],
        })),
      });
      const held = new Set(withTba.filter((_, i) => balances[i].status === 'success' && (balances[i].result as bigint) > BigInt(0)).map((x) => x.id));
      for (const id of todo) cache.set(id, { at: now, minted: held.has(id) });
      if (cache.size > 10_000) cache.clear();
    }
    return NextResponse.json(
      { minted: ids.filter((id) => cache.get(id)?.minted) },
      { headers: { 'Cache-Control': 'public, max-age=60' } },
    );
  } catch {
    return NextResponse.json({ error: 'Backpack lookup failed' }, { status: 502 });
  }
}
