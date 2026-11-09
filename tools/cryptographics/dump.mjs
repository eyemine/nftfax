#!/usr/bin/env node
// Dump every Cryptographics asset pack from mainnet into data/chain-dump.json.
// This JSON is itself the backup of the on-chain registry: pack ids, creators,
// prices, asset ids, attribute flags and IPFS hashes — even if IPFS content
// were lost, this proves what existed and who made it.
import { writeFileSync } from 'node:fs';
import { rpc, ASSET_MANAGER, assetManagerAbi } from './lib/chain.mjs';
import { bytes32ToCid } from './lib/ipfs.mjs';

const EYEMINE = '0xe811F02418646AE93F540ED2877a487BE85dd842'; // eyemine.eth

const read = (fn, args = []) =>
  rpc.readContract({ address: ASSET_MANAGER, abi: assetManagerAbi, functionName: fn, args });

const [nPacks, nAssets, created, bought] = await Promise.all([
  read('getNumberOfAssetPacks'),
  read('getNumberOfAssets'),
  read('getAssetPacksUserCreated', [EYEMINE]),
  read('getBoughtAssetPacks', [EYEMINE]),
]);
console.log(`${nPacks} packs, ${nAssets} assets on-chain. eyemine.eth: ${created.length} created, ${bought.length} bought`);

const packs = [];
for (let id = 0; id < nPacks; id++) {
  const [cover, creator, price, assetIds, attributes, hashes, metaHash] =
    await read('getAssetPackData', [BigInt(id)]);
  packs.push({
    packId: id,
    creator,
    creatorUsername: null,
    eyemineCreated: creator.toLowerCase() === EYEMINE.toLowerCase(),
    priceWei: price.toString(),
    packCoverCid: bytes32ToCid(cover),
    metadataCid: bytes32ToCid(metaHash),
    assetIds: assetIds.map(Number),
    attributes: attributes.map(Number),
    assetCids: hashes.map(bytes32ToCid),
  });
  if (id % 20 === 0) console.log(`  pack ${id}: ${assetIds.length} assets`);
}

// verify bought packs also carry compose permission
const permission = {};
for (const id of [...new Set([...created, ...bought].map(Number))]) {
  permission[id] = await read('checkHasPermissionForPack', [EYEMINE, BigInt(id)]);
}
const denied = Object.entries(permission).filter(([, ok]) => !ok).map(([id]) => id);
if (denied.length) console.log(`WARNING: no on-chain compose permission for packs: ${denied.join(',')}`);

writeFileSync('data/chain-dump.json', JSON.stringify({
  dumpedAt: new Date().toISOString(),
  chainId: 1,
  assetManager: ASSET_MANAGER,
  numberOfAssetPacks: Number(nPacks),
  numberOfAssets: Number(nAssets),
  eyemine: { address: EYEMINE, created: created.map(Number), bought: bought.map(Number), permission },
  packs,
}, null, 2));
console.log(`wrote data/chain-dump.json (${packs.length} packs)`);
