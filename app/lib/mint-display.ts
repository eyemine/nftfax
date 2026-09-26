/// Which tray a minted collectible's artwork is — the hop the MINTER sent.
///
/// The on-chain FaxMinted event records a trayId, but which fax that is depends
/// on how the mint was made:
///
///   - Current mints target the minter's own hop directly. The on-chain tray IS
///     the artwork, and its forwardedTrayId (if any) is the NEXT player's onward
///     forward — following it shows the wrong remix.
///   - Older mints recorded the RECEIVED tray. There the minter's hop is that
///     tray's forwardedTrayId.
///
/// So: decide by identity. If the minter is the tray's sender, display it as-is;
/// if the minter is its recipient, follow the forward. Never by the mere presence
/// of a forward marker. This lives in one place because three consumers
/// (leaderboard, metadata, exhibit) each got it subtly wrong on their own.

/// @fax handle prefix per contract Community enum (NONE=0, CHONK, DEADFELLAZ, POW, NORMIE).
export const COMMUNITY_PREFIX: Record<number, string> = { 1: 'chonk', 2: 'dfz', 3: 'atom', 4: 'normie' };

/// The minter's @fax handle from a mint record. Non-Chonk source ids are
/// composite on-chain (real id × 1e6 + per-chain suffix); strip the suffix.
export function minterHandleFor(m: { community: number; sourceTokenId: number }): string | null {
  const prefix = COMMUNITY_PREFIX[m.community];
  if (!prefix) return null;
  const real = m.community !== 1 && m.sourceTokenId >= 1_000_000 ? Math.floor(m.sourceTokenId / 1_000_000) : m.sourceTokenId;
  return `${prefix}.${real}@fax`;
}

export interface TrayParties { from?: string; to?: string; forwardedTrayId?: string }

export function resolveDisplayTrayId(onChainTrayId: string, minterHandle: string | null, tray: TrayParties): string {
  if (!minterHandle) return onChainTrayId;
  const same = (a?: string) => !!a && a.toLowerCase() === minterHandle.toLowerCase();
  const minterIsRecipient = same(tray.to) && !same(tray.from);
  return minterIsRecipient && tray.forwardedTrayId ? tray.forwardedTrayId : onChainTrayId;
}
