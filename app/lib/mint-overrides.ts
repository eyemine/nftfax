/// Manual post-mint tray corrections, keyed by on-chain tokenId.
///
/// The FaxMinted event's trayId is immutable once minted. For a handful of early
/// tokens it recorded the RECEIVED fax rather than the minter's forwarded hop,
/// and was later corrected via setTokenURI to a pinned metadata document. This
/// map keeps every consumer that derives display data from the event — the
/// leaderboard, the metadata route, the exhibit — consistent with the corrected
/// tokenURI rather than the stale event value.
///
/// Shared here because it used to live only in the leaderboard route, so the
/// metadata route (and anything reading /api/metadata/[id]/image) rendered the
/// wrong tray for these tokens while the leaderboard showed the right one.
export const TOKEN_TRAY_ID_OVERRIDES: Record<number, string> = {
  11: '6be9f54538b5', // corrected via setTokenURI — tx 0xf74179fc21c1a0618c3641531159b18a177a06794e7fe6e9d954d184e3bb9f0c
  12: '9650d1a15f94', // on-chain trayId is the received fax; corrected to the forwarded fax
  13: 'c95d23ec2ed6', // on-chain trayId was the received fax (8f28a87fc438); corrected to the forwarded fax
  14: '7648cedba4d2', // on-chain trayId was the received fax (8702231b100c); corrected to the forwarded fax
};

export function overrideTrayId(tokenId: number, onChainTrayId: string): string {
  return TOKEN_TRAY_ID_OVERRIDES[tokenId] ?? onChainTrayId;
}
