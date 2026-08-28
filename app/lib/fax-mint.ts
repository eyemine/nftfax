/// Encodes and sends the actual on-chain "Mint to Base" transaction against
/// the deployed FAX CHAIN collectible (NFTFaxCollectible.sol,
/// contracts/src/NFTFaxCollectible.sol). Two on-chain mint paths:
///
///   - mintFaxOnChain(sourceTokenId, trayId) — Chonks only. Recipient is
///     resolved ENTIRELY on-chain by the contract (ownerOf + ERC-6551
///     backpack via chonksContract), so we don't need resolveMintRecipient.
///   - mintFaxDirect(to, community, sourceTokenId, trayId) — DeadFellaz/POW/
///     Normie (Ethereum-native collections this Base contract can't verify
///     on-chain). `to` is resolved off-chain via resolveMintRecipient
///     (ownerOf/delegate check against the Ethereum-side contract).
///
/// Mailbox local parts encode identity as `${prefix}.${tokenId}` (e.g.
/// "atom.3614", "chonk.585") — see app/lib/theme.ts mailboxPlaceholder for
/// the canonical prefixes per collection.

import { BASE_FAX_COLLECTIBLE } from './contracts';
import { resolveMintRecipient } from './mint-recipient';
import type { CollectionKey } from './theme';

const MINT_FAX_ON_CHAIN_SELECTOR = '0xcf6c8408'; // mintFaxOnChain(uint256,string)
const MINT_FAX_DIRECT_SELECTOR = '0x08c40d22'; // mintFaxDirect(address,uint8,uint256,string)
// V2-only: mint + set the per-token IPFS URI atomically (NFTFaxCollectibleV2).
const MINT_FAX_ON_CHAIN_WITH_URI_SELECTOR = '0xd2c61ae0'; // mintFaxOnChainWithURI(uint256,string,string)
const MINT_FAX_DIRECT_WITH_URI_SELECTOR = '0x4690e06f'; // mintFaxDirectWithURI(address,uint8,uint256,string,string)
const MINT_PRICE_SELECTOR = '0x6817c76c'; // mintPrice()

const DEFAULT_MINT_PRICE_WEI = BigInt('2000000000000000'); // 0.002 ETH fallback if the price read fails

/// Community enum ordinal, matching `enum Community` in NFTFaxCollectible.sol.
const COMMUNITY_ENUM: Record<CollectionKey, number> = {
  chonk: 1,
  deadfellaz: 2,
  pow: 3,
  normie: 4,
};

/// Maps a mailbox local-part prefix (before the first '.') to the collection
/// it represents, matching the mailboxPlaceholder prefixes in theme.ts.
const PREFIX_TO_COLLECTION: Record<string, CollectionKey> = {
  chonk: 'chonk',
  dfz: 'deadfellaz',
  normie: 'normie',
  atom: 'pow',
};

export interface FaxIdentity {
  collection: CollectionKey;
  tokenId: bigint;
}

/// Parses a mailbox local part like "atom.3614" into its collection +
/// on-chain token ID. Returns null if the local doesn't follow the
/// `${prefix}.${digits}` convention or the prefix isn't a known collection.
export function parseFaxIdentity(local: string): FaxIdentity | null {
  const clean = local.trim().toLowerCase();
  const dot = clean.indexOf('.');
  if (dot < 0) return null;
  const prefix = clean.slice(0, dot);
  const idPart = clean.slice(dot + 1);
  if (!/^\d+$/.test(idPart)) return null;
  const collection = PREFIX_TO_COLLECTION[prefix];
  if (!collection) return null;
  return { collection, tokenId: BigInt(idPart) };
}

function encodeUint256(val: bigint | number | string): string {
  return BigInt(val).toString(16).padStart(64, '0');
}

function encodeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/// ABI-encodes a single trailing dynamic `string` param appended after
/// `staticWordCount` fixed 32-byte words: the offset word, then the
/// length-prefixed, right-padded UTF-8 bytes.
function encodeTrailingString(staticWordCount: number, value: string): string {
  const bytes = new TextEncoder().encode(value);
  const offset = encodeUint256(staticWordCount * 32);
  const length = encodeUint256(bytes.length);
  let hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const pad = (64 - (hex.length % 64)) % 64;
  hex = hex.padEnd(hex.length + pad, '0');
  return offset + length + hex;
}

/// ABI-encodes N trailing dynamic `string` params appended after
/// `staticWordCount` fixed 32-byte words: one offset word per string
/// (all in the head, in order), followed by each string's length-prefixed,
/// right-padded data, in the same order. Used for the V2 `...WithURI` mint
/// variants, which take two trailing strings (trayId, tokenURI).
function encodeTrailingStrings(staticWordCount: number, values: string[]): string {
  const headWords = staticWordCount + values.length;
  let currentOffset = headWords * 32;
  const offsets: string[] = [];
  const dataParts: string[] = [];
  for (const value of values) {
    offsets.push(encodeUint256(currentOffset));
    const bytes = new TextEncoder().encode(value);
    const length = encodeUint256(bytes.length);
    let hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const pad = (64 - (hex.length % 64)) % 64;
    hex = hex.padEnd(hex.length + pad, '0');
    const encoded = length + hex;
    dataParts.push(encoded);
    currentOffset += encoded.length / 2;
  }
  return offsets.join('') + dataParts.join('');
}

interface RpcResponse {
  result?: string;
  error?: unknown;
}

/// Reads the live mintPrice() from the deployed contract. Falls back to the
/// documented launch price (0.002 ETH) if the read fails for any reason —
/// fails open on price (worst case the wallet is asked to send slightly the
/// wrong amount and the tx reverts client-side), never fails closed on mint
/// availability itself.
export async function fetchMintPrice(rpcUrl = 'https://mainnet.base.org'): Promise<bigint> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: BASE_FAX_COLLECTIBLE, data: MINT_PRICE_SELECTOR }, 'latest'],
      }),
    });
    const json = (await res.json()) as RpcResponse;
    if (!json.result || json.result === '0x') return DEFAULT_MINT_PRICE_WEI;
    return BigInt(json.result);
  } catch {
    return DEFAULT_MINT_PRICE_WEI;
  }
}

export interface BuildMintTxParams {
  /** The connected/current mailbox local part, e.g. "atom.3614". */
  local: string;
  /** The connected wallet address (signer). */
  connectedWallet: string;
  /** Off-chain fax tray ID being minted (passed through for event indexing). */
  trayId: string;
  /**
   * Optional IPFS metadata URI (e.g. "ipfs://<cid>") to set as this token's
   * per-token URI atomically at mint time — see `pinFaxMetadata`. Only
   * meaningful against NFTFaxCollectibleV2; ignored (regular mint path used)
   * if omitted, so this is safe to leave unset against V1.
   */
  tokenURI?: string;
}

export interface BuildMintTxResult {
  to: string;
  data: string;
  value: string; // hex-encoded wei, for eth_sendTransaction
  error?: string;
}

/// Builds the calldata + value for the on-chain mint transaction. Returns
/// `error` (no `data`) if the mailbox identity can't be resolved to a known
/// collection/token, or if off-chain ownership/delegation verification fails
/// for the Ethereum-native collections — fails closed rather than silently
/// minting to a possibly-wrong wallet.
export async function buildMintTx({ local, connectedWallet, trayId, tokenURI }: BuildMintTxParams): Promise<BuildMintTxResult> {
  const identity = parseFaxIdentity(local);
  const price = await fetchMintPrice();
  const value = '0x' + price.toString(16);

  if (!identity) {
    return { to: BASE_FAX_COLLECTIBLE, data: '', value, error: 'Could not determine an NFT collection/token ID from this mailbox to mint against.' };
  }

  if (identity.collection === 'chonk') {
    const data = tokenURI
      ? MINT_FAX_ON_CHAIN_WITH_URI_SELECTOR + encodeUint256(identity.tokenId) + encodeTrailingStrings(1, [trayId, tokenURI])
      : MINT_FAX_ON_CHAIN_SELECTOR + encodeUint256(identity.tokenId) + encodeTrailingString(2, trayId);
    return { to: BASE_FAX_COLLECTIBLE, data, value };
  }

  const resolved = await resolveMintRecipient({
    collection: identity.collection,
    connectedWallet,
    tokenId: identity.tokenId,
  });
  if (resolved.error || !resolved.to) {
    return { to: BASE_FAX_COLLECTIBLE, data: '', value, error: resolved.error || 'Could not verify NFT ownership for this mailbox.' };
  }

  const community = COMMUNITY_ENUM[identity.collection];
  const data = tokenURI
    ? MINT_FAX_DIRECT_WITH_URI_SELECTOR +
      encodeAddress(resolved.to) +
      encodeUint256(community) +
      encodeUint256(identity.tokenId) +
      encodeTrailingStrings(3, [trayId, tokenURI])
    : MINT_FAX_DIRECT_SELECTOR +
      encodeAddress(resolved.to) +
      encodeUint256(community) +
      encodeUint256(identity.tokenId) +
      encodeTrailingString(4, trayId);
  return { to: BASE_FAX_COLLECTIBLE, data, value };
}

/// Pins the fax's image + metadata JSON to IPFS via the `/api/tray/[id]/pin`
/// route (Pinata under the hood). Returns the resulting `ipfs://<cid>`
/// metadata URI, or `null` if pinning is unconfigured/unavailable — callers
/// should treat `null` as "mint without a per-token URI" rather than an
/// error, so minting is never blocked by an IPFS outage.
export async function pinFaxMetadata(trayId: string, local: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/tray/${encodeURIComponent(trayId)}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { tokenURI?: string | null };
    return json.tokenURI || null;
  } catch {
    return null;
  }
}

/// ABI-encodes FaxTray.saveFax(address to, string trayId, string tokenURI).
/// Selector: saveFax(address,string,string) = 0x0d2fafb3
const SAVE_FAX_SELECTOR = '0x0d2fafb3';

export function encodeSaveFax(to: string, trayId: string, tokenURI: string): string {
  return SAVE_FAX_SELECTOR +
    encodeAddress(to) +
    encodeTrailingStrings(1, [trayId, tokenURI]);
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/// Sends the mint transaction via the connected EIP-1193 wallet. Returns the
/// pending tx hash immediately (does not wait for confirmation).
export async function sendMintTx(
  provider: EthereumProvider,
  fromAccount: string,
  tx: BuildMintTxResult,
): Promise<{ txHash?: string; error?: string }> {
  if (tx.error || !tx.data) {
    return { error: tx.error || 'Mint transaction could not be built.' };
  }
  try {
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: fromAccount, to: tx.to, data: tx.data, value: tx.value }],
    });
    return { txHash: typeof txHash === 'string' ? txHash : undefined };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { error };
  }
}
