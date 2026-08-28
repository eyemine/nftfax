/// Single entry point that decides WHERE a Base fax collectible mint should
/// land, per collection:
///
///   1. Chonks       -> the token's deployed ERC-6551 backpack (TBA)
///   2. Delegated NFT -> the vault/owner EOA (delegate.xyz hot wallet plays,
///                        vault receives the collectible)
///   3. Everything else -> the connected wallet directly
///
/// Fails closed: if ownership/delegation can't be verified, mint is blocked
/// (error returned) rather than silently defaulting to the connected wallet.
/// A missing/failed backpack lookup for a verified Chonk owner is NOT fatal
/// — it falls back to the owner's EOA with a warning, since the backpack is
/// a bonus destination, not a security boundary.

import { getCollectionTheme, type CollectionKey } from './theme';
import { verifyOwnershipOrDelegate } from './delegate';
import { resolveChonkBackpack } from './chonks';

export type RecipientStrategy = 'direct' | 'delegate-vault' | 'chonk-backpack';

export interface ResolveMintRecipientParams {
  /** Themed collection the user is minting as, if any. */
  collection: CollectionKey | null;
  /** The wallet currently connected in the dApp (the signer). */
  connectedWallet: string;
  /** Token ID being played/minted against. Required for any non-direct path. */
  tokenId?: string | number | bigint;
  /** Known cold vault wallet, if already established via DelegatePanel. */
  vaultWallet?: string;
}

export interface ResolveMintRecipientResult {
  to: string;
  strategy: RecipientStrategy;
  actualOwner?: string | null;
  isDelegate?: boolean;
  warning?: string;
  error?: string;
}

export async function resolveMintRecipient({
  collection,
  connectedWallet,
  tokenId,
  vaultWallet,
}: ResolveMintRecipientParams): Promise<ResolveMintRecipientResult> {
  const hot = connectedWallet.trim();

  // No collection context or no tokenId to verify against — plain mint.
  if (!collection || tokenId === undefined || tokenId === null || tokenId === '') {
    return { to: hot, strategy: 'direct' };
  }

  const theme = getCollectionTheme(collection);

  const verify = await verifyOwnershipOrDelegate({
    contract: theme.contract,
    tokenId,
    rpcUrl: theme.rpc,
    hotWallet: hot,
    vaultWallet,
  });

  if (!verify.verified) {
    return {
      to: '',
      strategy: 'direct',
      actualOwner: verify.actualOwner,
      error: verify.error ?? 'Connected wallet is not the owner or a delegate for this token.',
    };
  }

  const ownerEOA = verify.isOwner ? hot : (verify.actualOwner ?? verify.vaultWallet ?? hot);

  if (collection === 'chonk') {
    const { backpack, error } = await resolveChonkBackpack(tokenId, theme.rpc);
    if (backpack) {
      return {
        to: backpack,
        strategy: 'chonk-backpack',
        actualOwner: verify.actualOwner,
        isDelegate: verify.isDelegate,
      };
    }
    return {
      to: ownerEOA,
      strategy: 'direct',
      actualOwner: verify.actualOwner,
      isDelegate: verify.isDelegate,
      warning: error ?? 'Backpack lookup returned no address — falling back to owner wallet.',
    };
  }

  if (verify.isDelegate) {
    return {
      to: ownerEOA,
      strategy: 'delegate-vault',
      actualOwner: verify.actualOwner,
      isDelegate: true,
    };
  }

  return {
    to: hot,
    strategy: 'direct',
    actualOwner: verify.actualOwner,
    isDelegate: false,
  };
}
