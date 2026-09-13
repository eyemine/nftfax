/// Authoritative ownership check for an `@fax` handle.
///
/// A handle IS an NFT: `chonk.681@fax` is Chonk #681, `dfz.7837@fax` is
/// DeadFellaz #7837. So the only real source of truth for "does this wallet
/// control this mailbox" is `ownerOf(tokenId)` on that collection's contract
/// (plus delegate.xyz, so a hot wallet can play for a cold vault).
///
/// This exists because the tray routes previously authorized via the worker's
/// `resolveAddress`, which reads a KV registry rather than the chain. That was
/// wrong in both directions:
///
///   - FAIL-OPEN: a handle absent from the registry returns
///     `{ exists: false, sovereign: true }`, and the routes only verified when
///     `exists === true`. Most fax-receiving handles are unregistered, so any
///     wallet could read their inbox metadata.
///   - FALSE REJECTION: for registered handles the recorded owner can be stale
///     (the NFT has since been traded), so the real owner is told "Wallet does
///     not match the registered owner".
///
/// Reading the chain fixes both. Fails CLOSED: any RPC failure denies access.

import { getCollectionTheme, type CollectionKey } from './theme';
import { verifyOwnershipOrDelegate } from './delegate';

/// Mailbox prefix -> themed collection key. Mirrors PREFIX_TO_COLLECTION in
/// fax-mint.ts; kept separate so this module stays server-safe and dependency-light.
const PREFIX_TO_COLLECTION: Record<string, CollectionKey> = {
  chonk: 'chonk',
  dfz: 'deadfellaz',
  normie: 'normie',
  atom: 'pow',
};

export interface FaxHandleIdentity {
  collection: CollectionKey;
  tokenId: string;
}

/// Parses `chonk.681` (or `chonk.681@fax`) into its collection + token id.
/// Returns null for anything that is not a recognised `<prefix>.<number>` handle.
export function parseFaxHandle(handle: string): FaxHandleIdentity | null {
  const clean = handle.trim().toLowerCase().replace(/@fax$/, '').replace(/@nftmail\.box$/, '');
  const dot = clean.indexOf('.');
  if (dot < 0) return null;
  const prefix = clean.slice(0, dot);
  const tokenId = clean.slice(dot + 1);
  if (!/^\d+$/.test(tokenId)) return null;
  const collection = PREFIX_TO_COLLECTION[prefix];
  if (!collection) return null;
  return { collection, tokenId };
}

export interface FaxOwnershipResult {
  authorized: boolean;
  /** Present when authorized via delegate.xyz rather than direct ownership. */
  isDelegate?: boolean;
  actualOwner?: string | null;
  /** User-facing reason when not authorized. */
  reason?: string;
  /** HTTP status the caller should return when not authorized. */
  status?: 401 | 403 | 404 | 503;
}

/// Verifies that `wallet` owns (or is a delegate for) the NFT behind `handle`.
export async function verifyFaxHandleOwner(handle: string, wallet: string): Promise<FaxOwnershipResult> {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return { authorized: false, reason: 'Authentication required', status: 401 };
  }

  const identity = parseFaxHandle(handle);
  if (!identity) {
    // Not a recognised NFT-backed handle, so there is no owner to check
    // against. Deny rather than fall through unverified.
    return {
      authorized: false,
      reason: 'Not a recognised @fax handle (expected e.g. chonk.681, dfz.7837, atom.1999, normie.42).',
      status: 404,
    };
  }

  const theme = getCollectionTheme(identity.collection);

  const verify = await verifyOwnershipOrDelegate({
    contract: theme.contract,
    tokenId: identity.tokenId,
    rpcUrl: theme.rpc,
    hotWallet: wallet,
  });

  if (verify.verified) {
    return { authorized: true, isDelegate: verify.isDelegate, actualOwner: verify.actualOwner };
  }

  // No owner resolved at all means the RPC failed or the token does not exist.
  // Distinguish them so a transient RPC outage does not look like a permission
  // problem — but deny either way (fail closed).
  if (!verify.actualOwner) {
    return {
      authorized: false,
      reason: verify.error?.includes('not found')
        ? `${handle} does not exist on ${theme.collectionName}.`
        : 'Could not verify mailbox ownership on-chain. Try again.',
      status: verify.error?.includes('not found') ? 404 : 503,
    };
  }

  return {
    authorized: false,
    actualOwner: verify.actualOwner,
    reason: 'This wallet does not own the NFT behind this @fax handle. Connect the wallet that holds it, or delegate to it via delegate.xyz.',
    status: 403,
  };
}
