type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

interface DisconnectableWallet {
  disconnect?: () => void | Promise<void>;
  getEthereumProvider?: () => Promise<unknown>;
}

/**
 * Disconnect the active wallet as thoroughly as the wallet client allows.
 *
 * MetaMask (and Phantom) do not support programmatic disconnect — Privy's
 * `wallet.disconnect()` no-ops for them. The reliable path is
 * `wallet_revokePermissions`, which makes MetaMask forget the account
 * permission and emit `accountsChanged` with an empty array.
 */
export async function disconnectWallet(
  wallet: DisconnectableWallet | undefined,
  opts: { authenticated?: boolean; logout?: () => Promise<void> } = {},
): Promise<void> {
  try {
    const provider = (wallet?.getEthereumProvider
      ? await wallet.getEthereumProvider()
      : undefined) as Eip1193Provider | undefined;
    await provider?.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch { /* wallet may not support revokePermissions */ }

  try { await wallet?.disconnect?.(); } catch { /* noop — unsupported clients */ }

  if (opts.authenticated && opts.logout) {
    try { await opts.logout(); } catch { /* no session to clear */ }
  }
}
