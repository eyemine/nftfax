/// GET /api/tray/credits?local=<address>&wallet=<0x...>&domain=fax|nftmail.box
/// POST /api/tray/credits { local, ownerWallet, domain, op: 'spend'|'earn'|'clear' }
///
/// Thermal-fade credit balance and mutation proxy for the NFTfax chain-letter.
/// `local` is the address (e.g. `dfz.1234` for @fax or `name` for @nftmail.box).

import { NextRequest, NextResponse } from 'next/server';
import { getCredits, spendCredit, earnSendCredit, clearJam, ensureJoinerBonus } from '@/app/lib/fax-credits';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function workerHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (WORKER_SECRET) h['X-Worker-Secret'] = WORKER_SECRET;
  return h;
}

async function verifyOwner(local: string, wallet: string, domain: string): Promise<NextResponse | null> {
  if (domain === 'fax') return null;
  const resolveRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: workerHeaders(),
    body: JSON.stringify({ action: 'resolveAddress', name: local, domain: domain || 'nftmail.box' }),
    cache: 'no-store',
  });
  if (!resolveRes.ok) {
    return NextResponse.json({ error: 'Could not verify mailbox ownership. Try again.' }, { status: 503, headers: NO_STORE });
  }
  const resolved = await resolveRes.json() as Record<string, unknown>;
  if (resolved.exists === false) {
    return NextResponse.json({ error: 'Mailbox does not exist.' }, { status: 404, headers: NO_STORE });
  }
  const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
  if (!controller) {
    return NextResponse.json({ error: 'Ownership could not be verified. Connect the controlling wallet.' }, { status: 403, headers: NO_STORE });
  }
  if (controller !== wallet.toLowerCase()) {
    return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403, headers: NO_STORE });
  }
  return null;
}

function cleanLocal(raw: string, domain?: string): string {
  let local = raw.toLowerCase().trim();
  if (domain) {
    local = local.replace(new RegExp(`@${domain.replace(/\./g, '\\.')}$`), '');
  }
  local = local.replace(/@fax$/, '').replace(/@nftmail\.box$/, '');
  return local;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = (searchParams.get('domain') || 'nftmail.box').toLowerCase();
  const local = cleanLocal(searchParams.get('local') || '', domain);
  const wallet = (searchParams.get('wallet') || '').trim();

  if (!local) {
    return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  }
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  const denied = await verifyOwner(local, wallet, domain);
  if (denied) return denied;

  try {
    const credits = await ensureJoinerBonus(local, wallet);
    return NextResponse.json({ local, domain, credits }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Credit lookup failed' }, { status: 502, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    local?: string;
    ownerWallet?: string;
    domain?: string;
    op?: 'spend' | 'earn' | 'clear';
  };
  const domain = (body.domain || 'nftmail.box').toLowerCase();
  const local = cleanLocal(body.local || '', domain);
  const wallet = (body.ownerWallet || '').trim();

  if (!local) {
    return NextResponse.json({ error: 'Missing local' }, { status: 400, headers: NO_STORE });
  }
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
  }

  const denied = await verifyOwner(local, wallet, domain);
  if (denied) return denied;

  try {
    switch (body.op) {
      case 'spend': {
        const ok = await spendCredit(local, wallet);
        const credits = await getCredits(local);
        return NextResponse.json({ ok, credits }, { status: ok ? 200 : 402, headers: NO_STORE });
      }
      case 'earn': {
        const credits = await earnSendCredit(local, wallet, 1);
        return NextResponse.json({ ok: true, credits }, { status: 200, headers: NO_STORE });
      }
      case 'clear': {
        const credits = await clearJam(local, wallet);
        return NextResponse.json({ ok: true, credits }, { status: 200, headers: NO_STORE });
      }
      default:
        return NextResponse.json({ error: 'Invalid op. Use spend, earn, or clear.' }, { status: 400, headers: NO_STORE });
    }
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Credit operation failed';
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE });
  }
}
