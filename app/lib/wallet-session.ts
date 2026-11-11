/// Wallet sessions: proof that the caller controls a wallet.
///
/// The tray routes used to take `ownerWallet` from the request body. Owner
/// addresses are public on-chain, so anyone could send, forward or re-route
/// as any player by typing in that player's address. A route now takes the
/// wallet from a session instead, and a session is only issued for a valid
/// signature of the sign-in message (app/lib/wallet-session-message.ts).
///
/// Session token: "v1.<base64url payload>.<base64url HMAC-SHA256>", payload
/// { w: wallet, exp: ms }. Stateless — signed with NFTFAX_SESSION_SECRET.
/// Browsers carry it in an httpOnly cookie; agents send
/// "Authorization: Bearer <token>".

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createPublicClient, http, recoverMessageAddress, type Hex } from 'viem';
import { base, gnosis, mainnet } from 'viem/chains';
import type { NextRequest } from 'next/server';
import { parseSessionMessage } from './wallet-session-message';

export const SESSION_COOKIE = 'nftfax_session';
/// 30 days: a player signs once when they connect on a device, not per send.
/// Disconnecting ends it early (app/lib/disconnect.ts).
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/// How old a signed sign-in message may be when it is presented.
const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
/// Tolerated clock skew for a message issued "in the future".
const MESSAGE_MAX_SKEW_MS = 2 * 60 * 1000;

function secret(): string {
  return process.env.NFTFAX_SESSION_SECRET || '';
}

/// False when NFTFAX_SESSION_SECRET is unset or too short: routes then refuse
/// to authenticate rather than fall back to trusting the request.
export function sessionsConfigured(): boolean {
  return secret().length >= 32;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueSessionToken(wallet: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ w: wallet.toLowerCase(), exp: expiresAt })).toString('base64url');
  return { token: `v1.${payload}.${sign(`v1.${payload}`)}`, expiresAt };
}

function readToken(token: string): { wallet: string; expiresAt: number } | null {
  const [version, payload, mac] = token.split('.');
  if (version !== 'v1' || !payload || !mac) return null;
  const expected = Buffer.from(sign(`v1.${payload}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { w?: string; exp?: number };
    if (!w || !/^0x[a-f0-9]{40}$/.test(w) || typeof exp !== 'number' || exp <= Date.now()) return null;
    return { wallet: w, expiresAt: exp };
  } catch {
    return null;
  }
}

/// The wallet this request has proven control of, or null.
export function getSession(req: NextRequest): { wallet: string; expiresAt: number } | null {
  if (!sessionsConfigured()) return null;
  const bearer = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  const token = bearer || req.cookies.get(SESSION_COOKIE)?.value;
  return token ? readToken(token) : null;
}

const clients = [
  createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || undefined) }),
  createPublicClient({ chain: base, transport: http() }),
  // @fax collections and player Safes live on Gnosis — a Safe's ERC-1271
  // signature only verifies on the chain the contract sits on.
  createPublicClient({ chain: gnosis, transport: http(process.env.GNOSIS_RPC_URL || undefined) }),
];

/// Checks a signed sign-in message. Plain wallets are checked by recovering
/// the signer; contract wallets (ERC-1271, e.g. a Safe or smart account) are
/// asked on Ethereum and Base. Returns the wallet, or the reason it failed.
export async function verifySessionSignature(message: string, signature: string): Promise<{ wallet: string } | { error: string }> {
  const parsed = parseSessionMessage(message);
  if (!parsed) return { error: 'Not an nftfax sign-in message.' };
  const issued = Date.parse(parsed.issuedAt);
  const age = Date.now() - issued;
  if (!Number.isFinite(issued) || age > MESSAGE_MAX_AGE_MS || age < -MESSAGE_MAX_SKEW_MS) {
    return { error: 'Sign-in message expired. Sign again.' };
  }
  if (!/^0x[a-fA-F0-9]+$/.test(signature)) return { error: 'Invalid signature.' };

  try {
    const recovered = await recoverMessageAddress({ message, signature: signature as Hex });
    if (recovered.toLowerCase() === parsed.wallet) return { wallet: parsed.wallet };
    // Recovered a DIFFERENT plain wallet: the classic mobile failure is the
    // wallet app signing with whichever account is active, not the connected
    // one. Name it so the player knows what to fix instead of re-prompting.
    console.warn(`[session] signature recovered to ${recovered}, expected ${parsed.wallet}`);
    return { error: `Signed with ${recovered.slice(0, 6)}…${recovered.slice(-4)}, not the connected wallet — switch to it in your wallet app and try again.` };
  } catch { /* not a plain ECDSA signature — try contract wallets */ }

  for (const client of clients) {
    try {
      if (await client.verifyMessage({ address: parsed.wallet as Hex, message, signature: signature as Hex })) {
        return { wallet: parsed.wallet };
      }
    } catch { /* try the next chain */ }
  }
  console.warn(`[session] signature verification failed for ${parsed.wallet} (EOA recovery + ERC-1271 on eth/base/gnosis)`);
  return { error: 'Signature does not match the wallet.' };
}

/// Authorization header to attach when one of our routes calls another
/// internally — server-to-server hops don't carry the session cookie, so the
/// caller's credential (Bearer, or the cookie token re-encoded as Bearer) is
/// forwarded explicitly.
export function sessionForwardHeaders(req: NextRequest): Record<string, string> {
  const bearer = req.headers.get('authorization');
  if (bearer) return { authorization: bearer };
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  return cookie ? { authorization: `Bearer ${cookie}` } : {};
}

/// For routes: the verified wallet, or the response to return instead. A
/// `claimedWallet` from the request (kept for older clients) must match it.
export function requireSessionWallet(req: NextRequest, claimedWallet?: string | null):
  { wallet: string } | { error: string; status: 401 | 403 | 503 } {
  if (!sessionsConfigured()) return { error: 'Wallet sign-in is not configured on this server.', status: 503 };
  const session = getSession(req);
  if (!session) return { error: 'Sign in with your wallet first.', status: 401 };
  const claimed = (claimedWallet || '').toLowerCase().trim();
  if (claimed && claimed !== session.wallet) {
    return { error: 'The connected wallet does not match your signed-in wallet. Sign in again.', status: 403 };
  }
  return { wallet: session.wallet };
}
