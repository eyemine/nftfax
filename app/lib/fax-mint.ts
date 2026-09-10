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

import { BASE_FAX_COLLECTIBLE, BASE_CHAIN } from './contracts';
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

/// The contract's `claimed[community][sourceTokenId]` mapping is a
/// permanent, one-time-ever claim with no reset/admin override (see
/// NFTFaxCollectibleV2.sol) — a real NFT that mints once via mintFaxDirect
/// can never mint again through this contract. For the three Ethereum-native
/// communities (DeadFellaz/POW/Normie), sourceTokenId is caller-supplied with
/// zero on-chain verification against the real NFT (unlike Chonk, which
/// resolves the recipient on-chain via ownerOf(sourceTokenId) and so MUST use
/// the real ID). That gives us room to encode a composite ID — real token ID
/// + a small suffix derived from the chain's rootTrayId — so the same NFT can
/// claim once per chain-letter chain instead of once ever, matching the
/// off-chain per-chain gate (worker checkFaxMintEligibility) it's meant to
/// mirror. Decoded back to the real ID for display by the leaderboard route.
const CHAIN_SUFFIX_MOD = BigInt(1_000_000);

function chainSuffixFromRoot(rootTrayId: string): bigint {
  const hex = rootTrayId.replace(/[^0-9a-f]/gi, '').slice(0, 6) || '0';
  return BigInt('0x' + hex) % CHAIN_SUFFIX_MOD;
}

function encodeCompositeSourceTokenId(realTokenId: bigint, rootTrayId: string): bigint {
  return realTokenId * CHAIN_SUFFIX_MOD + chainSuffixFromRoot(rootTrayId);
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
   * Chain-letter root tray ID (chain.rootTrayId). Used to derive a composite
   * on-chain sourceTokenId for the direct-mint communities (DeadFellaz/POW/
   * Normie) so the same real NFT can claim once per chain instead of once
   * ever — see encodeCompositeSourceTokenId. Ignored for Chonk (must use the
   * real ID). Falls back to `trayId` if omitted.
   */
  rootTrayId?: string;
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
  chainId?: string; // hex chain id for wallet_sendCalls (Base 0x2105)
  rpcUrl?: string; // RPC to poll for the on-chain receipt
  error?: string;
  warning?: string; // non-fatal, e.g. "minting to on-chain owner, not connected wallet"
}

/// Builds the calldata + value for the on-chain mint transaction. Returns
/// `error` (no `data`) if the mailbox identity can't be resolved to a known
/// collection/token, or if off-chain ownership/delegation verification fails
/// for the Ethereum-native collections — fails closed rather than silently
/// minting to a possibly-wrong wallet.
export async function buildMintTx({ local, connectedWallet, trayId, rootTrayId, tokenURI }: BuildMintTxParams): Promise<BuildMintTxResult> {
  const identity = parseFaxIdentity(local);
  const price = await fetchMintPrice();
  const value = '0x' + price.toString(16);

  if (!identity) {
    return { to: BASE_FAX_COLLECTIBLE, data: '', value, error: 'Could not determine an NFT collection/token ID from this mailbox to mint against.' };
  }

  const eligibilityRes = await fetch(`/api/tray/${trayId}/mint-eligibility?local=${encodeURIComponent(local)}&wallet=${encodeURIComponent(connectedWallet)}`, { cache: 'no-store' });
  if (eligibilityRes.ok) {
    const eligibility = await eligibilityRes.json().catch(() => ({ eligible: true })) as { eligible?: boolean; reason?: string };
    if (!eligibility.eligible) {
      return { to: BASE_FAX_COLLECTIBLE, data: '', value, error: eligibility.reason || 'Source token already minted in this chain.' };
    }
  }

  if (identity.collection === 'chonk') {
    const data = tokenURI
      ? MINT_FAX_ON_CHAIN_WITH_URI_SELECTOR + encodeUint256(identity.tokenId) + encodeTrailingStrings(1, [trayId, tokenURI])
      : MINT_FAX_ON_CHAIN_SELECTOR + encodeUint256(identity.tokenId) + encodeTrailingString(2, trayId);
    return { to: BASE_FAX_COLLECTIBLE, data, value, chainId: BASE_CHAIN.hexId, rpcUrl: BASE_CHAIN.rpcUrl };
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
  const onChainSourceTokenId = encodeCompositeSourceTokenId(identity.tokenId, rootTrayId || trayId);
  const data = tokenURI
    ? MINT_FAX_DIRECT_WITH_URI_SELECTOR +
      encodeAddress(resolved.to) +
      encodeUint256(community) +
      encodeUint256(onChainSourceTokenId) +
      encodeTrailingStrings(3, [trayId, tokenURI])
    : MINT_FAX_DIRECT_SELECTOR +
      encodeAddress(resolved.to) +
      encodeUint256(community) +
      encodeUint256(onChainSourceTokenId) +
      encodeTrailingString(4, trayId);
  return { to: BASE_FAX_COLLECTIBLE, data, value, chainId: BASE_CHAIN.hexId, rpcUrl: BASE_CHAIN.rpcUrl, warning: resolved.warning };
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

/// Detects whether a connected wallet is an EIP-7702 delegated smart account
/// (e.g. a MetaMask DeleGator). These accounts have code deployed at their
/// address (the EIP-7702 authorization pointer), so `eth_getCode` returns
/// non-empty bytes. Value-bearing transactions from these accounts are routed
/// through `redeemDelegations`, which currently fails with `Panic(0x11)` due
/// to a `NativeBalanceChangeEnforcer` gas-reserve underflow bug in MetaMask's
/// delegation framework.
export async function isEip7702Account(provider: EthereumProvider, address: string): Promise<boolean> {
  try {
    const code = await provider.request({ method: 'eth_getCode', params: [address, 'latest'] });
    return typeof code === 'string' && code.length > 4; // "0x" is empty, anything longer is code
  } catch {
    return false;
  }
}

/// Reads the ETH balance of an address via RPC. Used to pre-check whether a
/// smart wallet has enough ETH to cover the mint fee + gas before prompting
/// MetaMask, so the user sees a clear message instead of a cryptic Panic(0x11).
export async function getEthBalance(rpcUrl: string, address: string): Promise<bigint> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    });
    const json = (await res.json()) as { result?: string };
    return json.result ? BigInt(json.result) : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/// Formats wei into a human-readable ETH string with up to 6 decimal places.
export function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6).replace(/\.?0+$/, '') || '0';
}

/// Pre-mint check for EIP-7702 smart accounts. Returns a user-facing error
/// message if the smart wallet cannot complete the mint, or null if OK.
/// The mint price is read from the contract (fetchMintPrice); gas is estimated
/// at a conservative 0.001 ETH overhead on Base.
export async function checkSmartWalletMintEligibility(
  provider: EthereumProvider,
  address: string,
  rpcUrl: string,
): Promise<string | null> {
  const isSmart = await isEip7702Account(provider, address);
  if (!isSmart) return null;

  const balance = await getEthBalance(rpcUrl, address);
  const mintPrice = await fetchMintPrice(rpcUrl);
  const estimatedGas = BigInt('1000000000000000'); // 0.001 ETH gas estimate on Base
  const required = mintPrice + estimatedGas;

  if (balance < required) {
    return (
      `Smart Wallet Needs ETH\n\n` +
      `Your MetaMask smart wallet is a separate account from your regular wallet. ` +
      `It needs its own ETH to make transactions.\n\n` +
      `Smart wallet address: ${address}\n` +
      `Current balance: ${formatEth(balance)} ETH\n` +
      `Needed: ~${formatEth(required)} ETH (0.002 mint fee + gas)\n\n` +
      `To fix:\n` +
      `1. Send ~0.005 ETH to your smart wallet address (${address})\n` +
      `2. Try minting again\n\n` +
      `Or: Switch to your standard wallet account in MetaMask → Settings → Accounts.`
    );
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TransactionReceipt {
  transactionHash?: string;
  status?: string; // '0x1' success, '0x0' failure
}

interface CallsStatusResponse {
  status?: number;
  atomic?: boolean;
  receipts?: TransactionReceipt[];
}

interface RpcReceiptResponse {
  result?: { status?: string } | null;
  error?: { message?: string };
}

async function getCallsTransactionHash(provider: EthereumProvider, callId: string, timeoutMs = 25000, intervalMs = 2000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const raw = await provider.request({ method: 'wallet_getCallsStatus', params: [callId] });
    const status = raw as CallsStatusResponse | undefined;
    if (!status) continue;
    if (typeof status.status === 'number') {
      if (status.status >= 400) throw new Error(`Call bundle failed with status ${status.status}`);
      if (status.status === 200) {
        const receipt = status.receipts?.[0];
        if (!receipt) throw new Error('Call bundle confirmed but no receipt was returned.');
        if (receipt.status === '0x0') throw new Error('Mint transaction reverted on-chain.');
        if (!receipt.transactionHash) throw new Error('Call bundle confirmed but no transaction hash was returned.');
        return receipt.transactionHash;
      }
    }
  }
  throw new Error('Call bundle confirmation timed out.');
}

async function waitForRpcReceipt(rpcUrl: string, txHash: string, timeoutMs = 25000, intervalMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
    });
    const json = (await res.json()) as RpcReceiptResponse | undefined;
    if (json?.error) throw new Error(json.error.message || 'Receipt fetch failed.');
    if (json?.result) {
      if (json.result.status === '0x1') return;
      if (json.result.status === '0x0') throw new Error('Transaction reverted on-chain.');
      throw new Error('Transaction receipt status unknown.');
    }
  }
  throw new Error('Transaction confirmation timed out.');
}

function isSendCallsUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return lower.includes('method not found') || lower.includes('not supported') || lower.includes('unsupported') || lower.includes('invalid method') || message.includes('-32601');
}

/// Sends the mint transaction via the connected EIP-1193 wallet.
///
/// For value-bearing mints (0.002 ETH), it tries eth_sendTransaction FIRST.
/// This is critical for MetaMask Delegated Smart Accounts (EIP-7702 DeleGators):
/// wallet_sendCalls routes through redeemDelegations, which is not payable and
/// causes an arithmetic underflow (Panic 0x11) in caveat enforcer hooks when
/// the Execution.value cannot be funded from msg.value. eth_sendTransaction
/// may send a direct call to the contract, correctly forwarding msg.value.
///
/// If eth_sendTransaction fails (e.g. wallet doesn't support direct sends for
/// smart accounts), it falls back to EIP-5792 wallet_sendCalls.
///
/// The returned hash is only returned after the transaction is confirmed
/// on-chain, so failed mints are never recorded as minted.
export async function sendMintTx(
  provider: EthereumProvider,
  fromAccount: string,
  tx: BuildMintTxResult,
): Promise<{ txHash?: string; error?: string }> {
  if (tx.error || !tx.data) {
    return { error: tx.error || 'Mint transaction could not be built.' };
  }

  // ── Path 1: eth_sendTransaction (direct, forwards msg.value) ──────────────
  // For EIP-7702 accounts, this sends a standard type-2 transaction directly
  // to the target contract. The EOA's delegated code does NOT intercept when
  // the EOA is the sender (only when it's the recipient), so msg.value is
  // forwarded correctly. This avoids the redeemDelegations wrapper entirely.
  try {
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: fromAccount, to: tx.to, data: tx.data, value: tx.value }],
    });
    if (typeof txHash !== 'string') throw new Error('Wallet did not return a transaction hash.');
    if (tx.rpcUrl) await waitForRpcReceipt(tx.rpcUrl, txHash);
    return { txHash };
  } catch (err: unknown) {
    // If eth_sendTransaction works but the tx reverts on-chain, return the
    // error — don't silently retry with wallet_sendCalls (which would also
    // fail and could confuse the user with a second MetaMask popup).
    const errMsg = err instanceof Error ? err.message : String(err);
    const isRevert = errMsg.includes('revert') || errMsg.includes('Panic') || errMsg.includes('execution')
      || errMsg.includes('0x') && errMsg.length > 10;
    if (isRevert) return { error: errMsg };

    // If eth_sendTransaction is not supported (method not found, etc.),
    // fall through to wallet_sendCalls.
  }

  // ── Path 2: wallet_sendCalls (EIP-5792 fallback) ──────────────────────────
  // Used when eth_sendTransaction is not supported (e.g. some smart account
  // wallets that only expose wallet_sendCalls). Note: for MetaMask DeleGators,
  // this path routes through redeemDelegations and may fail for value-bearing
  // transactions due to a known Delegation Toolkit bug (smart-accounts-kit #28).
  const hasValue = (() => {
    try { return BigInt(tx.value || '0x0') > BigInt(0); } catch { return false; }
  })();
  if (hasValue && tx.chainId) {
    try {
      const bundle = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          version: '2.0.0',
          from: fromAccount,
          chainId: tx.chainId,
          atomicRequired: true,
          calls: [{ to: tx.to, data: tx.data, value: tx.value }],
        }],
      });
      const callId = (bundle as { id?: string }).id;
      if (!callId) throw new Error('wallet_sendCalls did not return a call bundle id.');
      const txHash = await getCallsTransactionHash(provider, callId);
      if (tx.rpcUrl) await waitForRpcReceipt(tx.rpcUrl, txHash);
      return { txHash };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { error: 'No supported transaction method available for this wallet.' };
}
