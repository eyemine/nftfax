/// The message a wallet signs to start an nftfax session.
///
/// Shared by the browser (app/lib/wallet-session-client.ts), the server
/// (app/lib/wallet-session.ts) and any agent signing in programmatically, so
/// all three agree on the exact text. Signing it proves control of the wallet;
/// it is not a transaction and costs no gas.
///
///   nftfax.app sign-in
///
///   Sign to prove you control this wallet. This is not a transaction and costs no gas.
///
///   Wallet: 0xabc…
///   Issued: 2026-11-02T08:00:00.000Z
///   Nonce: 32 hex characters

export const SESSION_MESSAGE_TITLE = 'nftfax.app sign-in';
const SESSION_MESSAGE_NOTE = 'Sign to prove you control this wallet. This is not a transaction and costs no gas.';

export function buildSessionMessage(wallet: string, issuedAt: string, nonce: string): string {
  return [
    SESSION_MESSAGE_TITLE,
    '',
    SESSION_MESSAGE_NOTE,
    '',
    `Wallet: ${wallet.toLowerCase()}`,
    `Issued: ${issuedAt}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

/// Reads a session message back, or null when it is not one. Rebuilding it
/// from the parsed fields and comparing guards against extra or reordered lines.
export function parseSessionMessage(message: string): { wallet: string; issuedAt: string; nonce: string } | null {
  const wallet = /^Wallet: (0x[a-f0-9]{40})$/m.exec(message)?.[1];
  const issuedAt = /^Issued: (\S+)$/m.exec(message)?.[1];
  const nonce = /^Nonce: ([a-f0-9]{32})$/m.exec(message)?.[1];
  if (!wallet || !issuedAt || !nonce) return null;
  return buildSessionMessage(wallet, issuedAt, nonce) === message ? { wallet, issuedAt, nonce } : null;
}
