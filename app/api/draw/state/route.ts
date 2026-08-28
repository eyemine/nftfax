import { NextResponse } from 'next/server';
import {
  getBlockNumber,
  getCurrentRound,
  getDrawRound,
  getTotalMinted,
  getMintPrice,
  getContractBalance,
  getOwner,
  getPrizeSentEvents,
  getAllMintEntries,
  fetchAllTiers,
  selectTieredWinners,
  type MintEntry,
} from '@/app/lib/draw';

const MAX_SUPPLY = 2222;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [round, currentBlock, totalMinted, mintPrice, balance, owner] = await Promise.all([
      getCurrentRound(),
      getBlockNumber(),
      getTotalMinted(),
      getMintPrice(),
      getContractBalance(),
      getOwner(),
    ]);

    const supplyReached = totalMinted >= MAX_SUPPLY;

    let roundData = null;
    let winners: { winner: string; amount: string; txHash: string }[] = [];
    let tieredWinners: { tier: string; winner: string; tokenId: number; claimed: boolean }[] = [];
    let entries: MintEntry[] = [];

    if (round > 0) {
      const [rd, prizeEvents] = await Promise.all([
        getDrawRound(round),
        getPrizeSentEvents(round),
      ]);
      roundData = rd;
      winners = prizeEvents.map((e) => ({
        winner: e.winner,
        amount: e.amount.toString(),
        txHash: e.txHash,
      }));

      if (supplyReached && roundData?.seedCaptured) {
        entries = await getAllMintEntries();
        const tierMap = await fetchAllTiers(entries.map((e) => e.tokenId));
        const computed = await selectTieredWinners(roundData.seed, entries, tierMap, 10);
        const claimedSet = new Set(prizeEvents.map((e) => e.winner));
        tieredWinners = computed.map((w) => ({ ...w, claimed: claimedSet.has(w.winner) }));
      }
    }

    return NextResponse.json(
      {
        round,
        currentBlock,
        totalMinted,
        mintPrice: mintPrice.toString(),
        balance: balance.toString(),
        owner,
        supplyReached,
        roundData,
        winners,
        tieredWinners,
        entries,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not read draw state';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
