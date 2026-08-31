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

import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { BASE_CHAIN, BASE_FAX_COLLECTIBLE } from './contracts';
import { CHONKS_MAIN_CONTRACT, resolveChonkBackpack } from './chonks';

const publicClient = createPublicClient({ chain: base, transport: http(BASE_CHAIN.rpcUrl) });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_BASE_URL = `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}`;

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
      return (data.ownedNfts || []).map((nft) => {
        const contract = (nft.contract?.address || nft.contractAddress || '').toLowerCase();
        return {
          contract,
          tokenId: nft.tokenId || nft.id?.tokenId || '0',
          tokenType: nft.tokenType || 'ERC721',
          name: nft.name || nft.title || 'Unknown',
          image: nft.image?.cachedUrl || nft.image?.pngUrl || nft.image?.thumbnailUrl || nft.media?.[0]?.gateway || '',
          isFaxChain: contract === BASE_FAX_COLLECTIBLE.toLowerCase(),
        };
      });
    } catch (err) {
      console.error('[tba] Alchemy getTBANFTs failed, falling back to RPC:', err);
    }
  }
  return getTBANFTsViaRPC(tbaAddress);
}

/// Fallback: scan ERC-721 Transfer events into the TBA. No metadata (no name
/// image), but always works with just an RPC endpoint.
async function getTBANFTsViaRPC(tbaAddress: `0x${string}`): Promise<TBANFT[]> {
  const logs = await publicClient.getLogs({
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
    args: { to: tbaAddress },
    fromBlock: BigInt(0),
    toBlock: 'latest',
  });

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

  const logs = await publicClient.getLogs({
    address: CHONKS_MAIN_CONTRACT as `0x${string}`,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
    args: { to: walletAddress },
    fromBlock: BigInt(0),
    toBlock: 'latest',
  });

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

export interface ChonkBackpack {
  chonkTokenId: string;
  tbaAddress: string;
  nfts: TBANFT[];
}

/// For a given wallet, find all Chonks they hold and the contents of each
/// Chonk's ERC-6551 backpack (TBA), highlighting any FAX CHAIN NFTs saved
/// there.
export async function getChonkBackpacks(walletAddress: `0x${string}`): Promise<ChonkBackpack[]> {
  const chonks = await getOwnedChonks(walletAddress);
  if (chonks.length === 0) return [];

  const backpacks = await Promise.all(chonks.map((tokenId) => resolveChonkBackpack(tokenId, BASE_CHAIN.rpcUrl)));

  const results: ChonkBackpack[] = [];
  for (let i = 0; i < chonks.length; i++) {
    const { backpack } = backpacks[i];
    if (!backpack) continue; // no deployed TBA for this Chonk yet
    const nfts = await getTBANFTs(backpack as `0x${string}`);
    results.push({ chonkTokenId: chonks[i].toString(), tbaAddress: backpack, nfts });
  }
  return results;
}
