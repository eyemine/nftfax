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

const TOKEN_KEY = (wallet: string) => `nftfax-session:${wallet}`;

/// The issued session token, kept in localStorage as a fallback for contexts
/// where the httpOnly cookie doesn't survive (mobile in-app wallet browsers
/// suspend the tab mid-sign, and some webviews partition cookie storage).
/// The server accepts "Authorization: Bearer <token>" everywhere it accepts
/// the cookie, so attaching it makes the session durable on mobile.
function storedToken(wallet: string): string | null {
  try { return localStorage.getItem(TOKEN_KEY(wallet)); } catch { return null; }
}

/// Attach to session-gated fetches alongside credentials; empty object when
/// nothing is stored. `Authorization` is a Request header, so spread it into
/// the headers of POST /api/tray/* calls.
export function sessionHeaders(wallet: string): Record<string, string> {
  const token = storedToken(wallet.toLowerCase());
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clearStoredSession(wallet: string): void {
  try { localStorage.removeItem(TOKEN_KEY(wallet.toLowerCase())); } catch { /* storage unavailable */ }
}

/// Mobile Chrome often discards the tab while the player is away signing in
/// the MetaMask app; the page reloads on return and the signature has nowhere
/// to land. A marker written just before personal_sign lets the reloaded page
/// recognise that and NOT fire another prompt automatically — which is what
/// turned one lost signature into an endless MetaMask loop.
const PENDING_KEY = (wallet: string) => `nftfax-signin-pending:${wallet}`;
const PENDING_WINDOW_MS = 5 * 60 * 1000;

function markSignInPending(wallet: string): void {
  try { localStorage.setItem(PENDING_KEY(wallet), String(Date.now())); } catch { /* storage unavailable */ }
}

function clearSignInPending(wallet: string): void {
  try { localStorage.removeItem(PENDING_KEY(wallet)); } catch { /* storage unavailable */ }
}

/// True when a sign-in prompt went out recently but never completed — i.e.
/// the page was reloaded mid-signature. Clears the marker so the NEXT
/// (click-driven) attempt starts clean.
export function consumeInterruptedSignIn(wallet: string): boolean {
  const key = PENDING_KEY(wallet.toLowerCase());
  try {
    const at = Number(localStorage.getItem(key) || 0);
    localStorage.removeItem(key);
    return at > 0 && Date.now() - at < PENDING_WINDOW_MS;
  } catch {
    return false;
  }
}

/// Joins a sign-in already in flight; never starts one. For background
/// loads, which must not summon the wallet without a click.
export function awaitPendingSession(wallet: string): Promise<void> {
  return pending.get(wallet.toLowerCase())?.catch(() => undefined) ?? Promise.resolve();
}

/// Mobile browser without an injected wallet (Android/iOS Chrome or Safari):
/// signing happens in another app, where a tab reload can drop the result.
export function isExternalMobileWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad/i.test(navigator.userAgent) && !(window as { ethereum?: unknown }).ethereum;
}

/// Opens nftfax.app inside MetaMask's own browser: the wallet is injected
/// there, signing never leaves the page, and nothing can be lost to a reload.
export function metamaskBrowserLink(): string {
  if (typeof window === 'undefined') return 'https://metamask.app.link/dapp/nftfax.app';
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}`;
}

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
  const current = await fetch('/api/auth/session', { cache: 'no-store', headers: sessionHeaders(wallet) })
    .then((r) => r.json()).catch(() => null) as { wallet?: string | null } | null;
  if (current?.wallet === wallet) return;

  const provider = await resolveProvider(getProvider);
  if (!provider) throw new Error('No wallet available to sign in. Reconnect your wallet and try again.');

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const message = buildSessionMessage(wallet, new Date().toISOString(), nonce);
  let signature: unknown;
  markSignInPending(wallet);
  try {
    signature = await provider.request({ method: 'personal_sign', params: [stringToHex(message), wallet] });
  } catch (cause: unknown) {
    clearSignInPending(wallet);
    // Only a genuine user rejection is "cancelled" (and silenced by callers);
    // anything else — a dropped wallet connection, wrong chain, provider
    // error — must surface, or a failing signature reads as an endless loop.
    const err = cause as { code?: number; message?: string } | undefined;
    if (err?.code === 4001 || /reject|denied|cancel/i.test(err?.message || '')) {
      throw new Error('Sign-in was cancelled. Sign the message to prove you control this wallet.');
    }
    throw new Error(`Wallet could not sign: ${err?.message || 'unknown error'}`);
  }
  clearSignInPending(wallet);
  if (typeof signature !== 'string') throw new Error('Wallet returned no signature. Try again.');

  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; token?: string };
  if (!res.ok) {
    clearStoredSession(wallet);
    throw new Error(data.error || 'Wallet sign-in failed.');
  }
  if (data.token) {
    try { localStorage.setItem(TOKEN_KEY(wallet), data.token); } catch { /* storage unavailable — cookie still works */ }
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
