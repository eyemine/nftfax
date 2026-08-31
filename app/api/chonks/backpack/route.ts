// GET /api/chonks/backpack?wallet=0x...
//
// Returns all Chonks held by the wallet and the FAX CHAIN NFTs inside each
// Chonk's ERC-6551 backpack (TBA). Replaces the broken tokenbound.org viewer
// for the Chonks community — see app/lib/tba.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getChonkBackpacks } from '../../../lib/tba';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get('wallet');

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Missing or invalid wallet address' }, { status: 400, headers: NO_STORE });
  }

  try {
    const backpacks = await getChonkBackpacks(wallet as `0x${string}`);

    const summary = {
      wallet,
      totalChonks: backpacks.length,
      totalFaxChainNFTs: backpacks.reduce((sum, bp) => sum + bp.nfts.filter((n) => n.isFaxChain).length, 0),
      backpacks: backpacks.map((bp) => ({
        chonkTokenId: bp.chonkTokenId,
        tbaAddress: bp.tbaAddress,
        tbaViewerUrl: `https://tokenbound.org/wallet/${bp.tbaAddress}`, // fallback link, in case tokenbound.org comes back
        // FAX CHAIN NFTs first so they surface at the top of each backpack.
        nfts: [...bp.nfts].sort((a, b) => Number(b.isFaxChain) - Number(a.isFaxChain)),
        faxChainCount: bp.nfts.filter((n) => n.isFaxChain).length,
      })),
    };

    return NextResponse.json(summary, { headers: NO_STORE });
  } catch (err: unknown) {
    console.error('[chonks/backpack] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch backpack contents' }, { status: 500, headers: NO_STORE });
  }
}
