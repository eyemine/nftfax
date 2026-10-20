/// GET /api/tray/[id]/mint-eligibility?local=...&wallet=...
///
/// Proxies to the worker's checkFaxMintEligibility action. This enforces the
/// per-chain single-claim rule (a source token can mint many collectibles, but
/// only one per chain) before the wallet is asked to sign.

import { NextRequest, NextResponse } from 'next/server';
import { parseFaxIdentity, COMMUNITY_ENUM, encodeCompositeSourceTokenId } from '@/app/lib/fax-mint';
import { isClaimedOnChain, findMintByTray } from '@/app/lib/mint-verify';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const local = (searchParams.get('local') || '').toLowerCase().trim().replace(/@nftmail\.box$/, '');
  const wallet = (searchParams.get('wallet') || '').trim();

  if (!id) return NextResponse.json({ error: 'Missing tray id' }, { status: 400, headers: NO_STORE });
  if (!local) return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: workerHeaders(),
      // `local` is the MINTER. The worker keys the one-per-chain gate on it; it
      // used to infer the identity from the tray's recipient, which is the next
      // player for a forwarded hop, not the account minting.
      body: JSON.stringify({ action: 'checkFaxMintEligibility', trayId: id, local }),
    });
    const data = await res.json().catch(() => ({ error: 'Worker unavailable' })) as { eligible?: boolean; reason?: string; error?: string; chainRoot?: string };
    if (res.ok && data.eligible) {
      const chained = await onChainClaim(id, local, data.chainRoot);
      if (chained) return NextResponse.json({ eligible: false, reason: chained, chainRoot: data.chainRoot }, { headers: NO_STORE });
    }
    return NextResponse.json(data, { status: res.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Eligibility check failed' }, { status: 502, headers: NO_STORE });
  }
}

/// The worker's gate only knows mints the browser reported. The contract's
/// `claimed` flag is the truth: if this identity has already claimed on-chain,
/// minting again would revert, so say so — and if the indexer shows the claim
/// was this very fax, record it now (the client never got to).
async function onChainClaim(trayId: string, local: string, chainRoot?: string): Promise<string | null> {
  const identity = parseFaxIdentity(local);
  if (!identity) return null;
  const community = COMMUNITY_ENUM[identity.collection];
  const raw = identity.collection === 'chonk'
    ? identity.tokenId
    : encodeCompositeSourceTokenId(identity.tokenId, chainRoot || trayId);
  if ((await isClaimedOnChain(community, raw)) !== true) return null;

  const mint = await findMintByTray(trayId);
  if (mint?.txHash) {
    try {
      const docRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: workerHeaders(),
        body: JSON.stringify({ action: 'getTrayDocument', id: trayId, secret: WEBHOOK_SECRET }),
        cache: 'no-store',
      });
      const doc = await docRes.json().catch(() => ({})) as { sourceTrayId?: string };
      if (doc.sourceTrayId) {
        await fetch(WORKER_URL, {
          method: 'POST',
          headers: workerHeaders(),
          body: JSON.stringify({
            action: 'markTrayMinted', secret: WEBHOOK_SECRET,
            trayId: doc.sourceTrayId, forwardedTrayId: trayId, local,
            baseTx: mint.txHash, baseTokenId: mint.tokenId, ipfsCid: null,
          }),
        });
      }
    } catch {
      // best-effort; the eligibility answer below is what matters
    }
    return `Already minted to Base as token #${mint.tokenId}.`;
  }
  return identity.collection === 'chonk'
    ? `${local} has already claimed its Base collectible (each Chonk can mint once).`
    : `${local} has already minted in this chain.`;
}
