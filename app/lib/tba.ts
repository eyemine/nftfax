/// ERC-6551 Token Bound Account utilities for the Chonks backpack viewer.
///
/// tokenbound.org has been broken (dead Alchemy key) with no fix in sight, so
/// this module gives nftfax.app its own read path for "what's in this Chonk's
/// backpack" — specifically surfacing FAX CHAIN NFTs saved there. Chonk → TBA
/// resolution reuses the already-verified tokenIdToTBAAccountAddress() getter
/// in app/lib/chonks.ts (no ERC-6551 registry/implementation guessing needed).
///
/// NFT enumeration (which Chonks a wallet holds, what's inside a TBA) prefers
/// the Alchemy NFT API (ALCHEMY_API_KEY) for speed, and falls back to raw
/// Transfer-event log scanning via the existing Base RPC so this never goes
/// fully blank if Alchemy is unavailable — same "never blank" principle as
/// pinFaxMetadata's Lighthouse fallback.

import { createPublicClient, http, parseAbiItem, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { BASE_CHAIN, BASE_FAX_COLLECTIBLE } from './contracts';
import { CHONKS_MAIN_CONTRACT, resolveChonkBackpack, ResolveChonkBackpackResult } from './chonks';

const publicClient = createPublicClient({ chain: base, transport: http(BASE_CHAIN.rpcUrl) });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_BASE_URL = `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}`;

/// Chonk backpacks accumulate a lot of unrelated airdrop/spam NFTs (Klima
/// staking badges, "visit X to claim" links, etc). Only surface NFTs from
/// contracts the user has explicitly whitelisted as meaningful.
const BACKPACK_CONTRACT_WHITELIST = new Set([
  BASE_FAX_COLLECTIBLE.toLowerCase(),
  '0x2530ffff980ae3400b0e4c1dc222f1536972077e',
  '0x03c4738ee98ae44591e1a4a4f3cab6641d95dd9a',
  '0x6b8f34e0559aa9a5507e74ad93374d9745cdbf09',
  '0xba5e05cb26b78eda3a2f8e3b3814726305dcac83',
  '0x827922686190790b37229fd06084350e74485b72',
]);

export interface TBANFT {
  contract: string;
  tokenId: string;
  tokenType: 'ERC721' | 'ERC1155';
  name: string;
  image: string;
  /** True if this NFT is a FAX CHAIN collectible (BASE_FAX_COLLECTIBLE). */
  isFaxChain: boolean;
}

interface AlchemyNFT {
  contract?: { address?: string };
  contractAddress?: string;
  tokenId?: string;
  id?: { tokenId?: string };
  tokenType?: 'ERC721' | 'ERC1155';
  name?: string;
  title?: string;
  image?: { cachedUrl?: string; pngUrl?: string; thumbnailUrl?: string };
  media?: { gateway?: string }[];
}

/// Fetch all NFTs held by a Token Bound Account (a Chonk's backpack).
/// Tries Alchemy first (fast, has metadata); falls back to scanning ERC-721
/// Transfer events into the TBA address via RPC (slower, name/image-light,
/// but has no external API dependency and never returns nothing on Alchemy
/// outage).
export async function getTBANFTs(tbaAddress: `0x${string}`): Promise<TBANFT[]> {
  if (ALCHEMY_API_KEY) {
    try {
      const url = `${ALCHEMY_BASE_URL}/getNFTsForOwner?owner=${tbaAddress}&withMetadata=true&pageSize=100`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Alchemy ${res.status}`);
      const data = await res.json() as { ownedNfts?: AlchemyNFT[] };
      return (data.ownedNfts || [])
        .map((nft) => {
          const contract = (nft.contract?.address || nft.contractAddress || '').toLowerCase();
          return {
            contract,
            tokenId: nft.tokenId || nft.id?.tokenId || '0',
            tokenType: nft.tokenType || 'ERC721',
            name: nft.name || nft.title || 'Unknown',
            image: nft.image?.cachedUrl || nft.image?.pngUrl || nft.image?.thumbnailUrl || nft.media?.[0]?.gateway || '',
            isFaxChain: contract === BASE_FAX_COLLECTIBLE.toLowerCase(),
          };
        })
        .filter((nft) => BACKPACK_CONTRACT_WHITELIST.has(nft.contract));
    } catch (err) {
      console.error('[tba] Alchemy getTBANFTs failed, falling back to RPC:', err);
    }
  }
  return getTBANFTsViaRPC(tbaAddress);
}

/// Base's public RPC caps eth_getLogs to a 10,000 block range per call, so a
/// from-genesis query always fails. Walk backward from the current block in
/// bounded windows instead. Capped by MAX_LOOKBACK_BLOCKS so a single request
/// can't hang for minutes — this fallback only needs to be "not blank", not
/// exhaustive; Alchemy is the accurate/complete path.
const LOG_WINDOW_BLOCKS = BigInt(9500);
const MAX_LOOKBACK_BLOCKS = BigInt(500000); // ~11.5 days at 2s/block on Base

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

interface TransferLog {
  address: `0x${string}`;
  args: { from?: `0x${string}`; to?: `0x${string}`; tokenId?: bigint };
}

async function getTransferLogsWindowed(params: {
  address?: `0x${string}`;
  args: { to: `0x${string}` };
}): Promise<TransferLog[]> {
  const latest = await publicClient.getBlockNumber();
  const floor = latest > MAX_LOOKBACK_BLOCKS ? latest - MAX_LOOKBACK_BLOCKS : BigInt(0);
  const allLogs: TransferLog[] = [];

  let toBlock = latest;
  while (toBlock > floor) {
    const fromBlock = toBlock - LOG_WINDOW_BLOCKS > floor ? toBlock - LOG_WINDOW_BLOCKS : floor;
    try {
      const logs = await publicClient.getLogs({ ...params, event: TRANSFER_EVENT, fromBlock, toBlock });
      allLogs.push(...(logs as unknown as TransferLog[]));
    } catch (err) {
      console.error('[tba] getLogs window failed, skipping window:', err);
    }
    toBlock = fromBlock - BigInt(1);
  }
  return allLogs;
}

/// Fallback: scan ERC-721 Transfer events into the TBA. No metadata (no name
/// image), bounded lookback window, but always works with just an RPC
/// endpoint and never throws.
async function getTBANFTsViaRPC(tbaAddress: `0x${string}`): Promise<TBANFT[]> {
  let logs: TransferLog[] = [];
  try {
    logs = await getTransferLogsWindowed({ args: { to: tbaAddress } });
  } catch (err) {
    console.error('[tba] getTBANFTsViaRPC failed, returning empty:', err);
    return [];
  }

  const seen = new Set<string>();
  const nfts: TBANFT[] = [];
  for (const log of logs) {
    const contract = log.address.toLowerCase();
    const tokenId = (log.args.tokenId ?? BigInt(0)).toString();
    const key = `${contract}-${tokenId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nfts.push({
      contract,
      tokenId,
      tokenType: 'ERC721',
      name: contract === BASE_FAX_COLLECTIBLE.toLowerCase() ? 'FAX CHAIN' : 'NFT',
      image: '',
      isFaxChain: contract === BASE_FAX_COLLECTIBLE.toLowerCase(),
    });
  }
  return nfts;
}

/// Get all Chonk token IDs owned by a wallet. Alchemy fast path, RPC
/// Transfer-scan + ownerOf-verify fallback.
async function getOwnedChonks(walletAddress: `0x${string}`): Promise<number[]> {
  if (ALCHEMY_API_KEY) {
    try {
      const url = `${ALCHEMY_BASE_URL}/getNFTsForOwner?owner=${walletAddress}&contractAddresses[]=${CHONKS_MAIN_CONTRACT}&withMetadata=false&pageSize=500`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Alchemy ${res.status}`);
      const data = await res.json() as { ownedNfts?: AlchemyNFT[] };
      return (data.ownedNfts || []).map((nft) => parseInt(nft.tokenId || nft.id?.tokenId || '0', 10));
    } catch (err) {
      console.error('[tba] Alchemy getOwnedChonks failed, falling back to RPC:', err);
    }
  }

  let logs: TransferLog[] = [];
  try {
    logs = await getTransferLogsWindowed({
      address: CHONKS_MAIN_CONTRACT as `0x${string}`,
      args: { to: walletAddress },
    });
  } catch (err) {
    console.error('[tba] getOwnedChonks RPC fallback failed, returning empty:', err);
    return [];
  }

  const candidateIds = Array.from(new Set(logs.map((log) => Number(log.args.tokenId ?? BigInt(0)))));
  const owners = await Promise.all(candidateIds.map((tokenId) =>
    publicClient.readContract({
      address: CHONKS_MAIN_CONTRACT as `0x${string}`,
      abi: [{ inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'ownerOf', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }],
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    }).catch(() => null),
  ));

  return candidateIds.filter((_, i) => (owners[i] as string | null)?.toLowerCase() === walletAddress.toLowerCase());
}

/// Build an executeCall() transaction for an ERC-6551 TBA to withdraw an
/// ERC-721 NFT back to the Chonk owner's EOA. The TBA calls
/// `nftContract.safeTransferFrom(tba, recipient, tokenId)` through its own
/// `executeCall(to, value, data)` function. Returns the raw tx fields needed
/// by the connected wallet.
export function buildTBAWithdrawTx(
  tbaAddress: `0x${string}`,
  nftContract: `0x${string}`,
  tokenId: string,
  recipient: `0x${string}`,
): { to: `0x${string}`; value: bigint; data: `0x${string}` } {
  const transferData = encodeFunctionData({
    abi: [{ type: 'function', name: 'safeTransferFrom', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' }],
    functionName: 'safeTransferFrom',
    args: [tbaAddress, recipient, BigInt(tokenId)],
  });

  const data = encodeFunctionData({
    abi: [{ type: 'function', name: 'executeCall', inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'payable' }],
    functionName: 'executeCall',
    args: [nftContract, BigInt(0), transferData],
  });

  return { to: tbaAddress, value: BigInt(0), data };
}

export interface ChonkBackpack {
  chonkTokenId: string;
  tbaAddress: string;
  nfts: TBANFT[];
}

const BACKPACK_CONCURRENCY = 5;

/// Resolve TBA addresses for all owned Chonk token IDs in a single Multicall3
/// `eth_call` instead of one call per token. This avoids public RPC rate
/// limits when a wallet holds many Chonks (24 calls at once were dropping
/// most results). allowFailure=true means one revert doesn't sink the batch.
async function resolveChonkBackpacks(tokenIds: number[]): Promise<Map<number, string>> {
  const abi = [{ inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'tokenIdToTBAAccountAddress', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }] as const;
  const contracts = tokenIds.map((tokenId) => ({
    address: CHONKS_MAIN_CONTRACT as `0x${string}`,
    abi,
    functionName: 'tokenIdToTBAAccountAddress' as const,
    args: [BigInt(tokenId)] as const,
  }));

  const results = await publicClient.multicall({ contracts, allowFailure: true }).catch((err: unknown) => {
    console.error('[tba] multicall TBA resolution failed, falling back to one-by-one:', err);
    return null;
  });

  const map = new Map<number, string>();
  if (!results) {
    // Fallback: resolve individually and keep the ones that don't error.
    const resolved = await Promise.all(tokenIds.map((tokenId) => resolveChonkBackpack(tokenId, BASE_CHAIN.rpcUrl)));
    tokenIds.forEach((tokenId, i) => {
      const { backpack } = resolved[i];
      if (backpack) map.set(tokenId, backpack);
    });
    return map;
  }

  for (let i = 0; i < tokenIds.length; i++) {
    const result = results[i];
    if (!result || 'error' in result) continue;
    const addr = (result as unknown as { result?: `0x${string}` }).result;
    if (!addr || /^0x0{40}$/i.test(addr)) continue;
    map.set(tokenIds[i], addr.toLowerCase());
  }
  return map;
}

/// For a given wallet, find all Chonks they hold and the contents of each
/// Chonk's ERC-6551 backpack (TBA), highlighting any FAX CHAIN NFTs saved
/// there. TBA addresses are resolved in a single Multicall3 call; backpack
/// contents are still read with Alchemy to avoid spam.
export async function getChonkBackpacks(walletAddress: `0x${string}`): Promise<ChonkBackpack[]> {
  const chonks = await getOwnedChonks(walletAddress);
  if (chonks.length === 0) return [];

  const tbaMap = await resolveChonkBackpacks(chonks);
  const results: ChonkBackpack[] = [];
  for (let i = 0; i < chonks.length; i += BACKPACK_CONCURRENCY) {
    const batch = chonks.slice(i, i + BACKPACK_CONCURRENCY);
    const withNfts = await Promise.all(batch.map((tokenId) => {
      const backpack = tbaMap.get(tokenId);
      return backpack ? getTBANFTs(backpack as `0x${string}`) : Promise.resolve([]);
    }));
    for (let j = 0; j < batch.length; j++) {
      const tokenId = batch[j];
      const backpack = tbaMap.get(tokenId);
      if (!backpack) continue; // no TBA resolved for this Chonk
      results.push({ chonkTokenId: tokenId.toString(), tbaAddress: backpack, nfts: withNfts[j] as TBANFT[] });
    }
  }
  return results;
}
