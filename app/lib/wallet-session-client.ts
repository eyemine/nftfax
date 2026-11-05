'use client';

/// Browser side of wallet sessions (app/lib/wallet-session.ts): make sure the
/// server holds a session for this wallet; if not, ask the wallet to sign the
/// sign-in message once. HomeClient does this right after the wallet
/// connects, and the session lasts 30 days, so sending never prompts. The
/// send paths still call it as a fallback (e.g. the sign-in was dismissed).

import { stringToHex } from 'viem';
import { buildSessionMessage } from './wallet-session-message';

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/// Generous because a mobile wallet SDK can still be handing the provider back
/// while the user is deep-linked out to MetaMask — 8 s routinely cut in before
/// the provider arrived, which failed connect-time sign-in and left the first
/// send to summon the wallet.
const PROVIDER_TIMEOUT_MS = 20_000;
const pending = new Map<string, Promise<void>>();

async function resolveProvider(getProvider?: () => Promise<Eip1193Provider | undefined>): Promise<Eip1193Provider | undefined> {
  if (getProvider) {
    const provider = await Promise.race([
      getProvider().catch(() => undefined),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PROVIDER_TIMEOUT_MS)),
    ]);
    if (provider) return provider;
  }
  return typeof window !== 'undefined' ? (window as { ethereum?: Eip1193Provider }).ethereum : undefined;
}

async function signIn(wallet: string, getProvider?: () => Promise<Eip1193Provider | undefined>): Promise<void> {
  const current = await fetch('/api/auth/session', { cache: 'no-store' }).then((r) => r.json()).catch(() => null) as { wallet?: string | null } | null;
  if (current?.wallet === wallet) return;

  const provider = await resolveProvider(getProvider);
  if (!provider) throw new Error('No wallet available to sign in. Reconnect your wallet and try again.');

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const message = buildSessionMessage(wallet, new Date().toISOString(), nonce);
  let signature: unknown;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [stringToHex(message), wallet] });
  } catch {
    throw new Error('Sign-in was cancelled. Sign the message to prove you control this wallet.');
  }

  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || 'Wallet sign-in failed.');
  }
}

/// Resolves once the server has a session for `wallet`; throws a user-facing
/// error if signing in fails. Concurrent calls share one signature prompt.
export function ensureWalletSession(wallet: string, getProvider?: () => Promise<Eip1193Provider | undefined>): Promise<void> {
  const key = wallet.toLowerCase();
  const existing = pending.get(key);
  if (existing) return existing;
  const run = signIn(key, getProvider).finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}
