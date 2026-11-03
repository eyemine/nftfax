/// /api/auth/session — wallet sign-in (see app/lib/wallet-session.ts).
///
///   GET     → { wallet, expiresAt } for the current session, or { wallet: null }
///   POST    { message, signature } → sets the session cookie and returns
///           { wallet, token, expiresAt }. Agents keep `token` and send it as
///           "Authorization: Bearer <token>".
///   DELETE  → ends the session.

import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_MS, getSession, issueSessionToken, sessionsConfigured, verifySessionSignature } from '@/app/lib/wallet-session';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(req: NextRequest) {
  const session = getSession(req);
  return NextResponse.json({ wallet: session?.wallet ?? null, expiresAt: session?.expiresAt ?? null }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!sessionsConfigured()) {
    return NextResponse.json({ error: 'Wallet sign-in is not configured on this server.' }, { status: 503, headers: NO_STORE });
  }
  const body = await req.json().catch(() => null) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== 'string' || typeof body?.signature !== 'string') {
    return NextResponse.json({ error: 'Missing message or signature' }, { status: 400, headers: NO_STORE });
  }
  const result = await verifySessionSignature(body.message, body.signature);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 401, headers: NO_STORE });

  const { token, expiresAt } = issueSessionToken(result.wallet);
  const res = NextResponse.json({ wallet: result.wallet, token, expiresAt }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
