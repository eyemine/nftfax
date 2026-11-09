#!/usr/bin/env node
// Audit all 496 minted DigitalPrintImage tokens:
//   - getImageMetadata -> (creator, extraData, finalSeed, ipfsHash, timestamp, potentialAssets)
//   - decode potentialAssets (10x uint24 BE per bytes32) -> candidate pool
//   - recompute pickRandomAssets(finalSeed, pool) on-chain-faithfully
//   - flag tokens whose picked set intersects lost asset ids
//   - collect every token's ipfsHash (canonical render) for a reachability pass
// Writes data/nft-audit.json
import { readFileSync, writeFileSync } from 'node:fs';
import { keccak256, encodePacked, hexToBigInt } from 'viem';
import { rpc, DIGITAL_PRINT_IMAGE } from './lib/chain.mjs';

const LOST_ASSETS = new Set([295, 2698, 2699, 2700, 2703]);

const abi = [{
  name: 'getImageMetadata', type: 'function', stateMutability: 'view',
  inputs: [{ type: 'uint256' }],
  outputs: [
    { type: 'address' },   // creator
    { type: 'string' },    // extraData
    { type: 'uint256' },   // finalSeed
    { type: 'string' },    // ipfsHash
    { type: 'uint256' },   // timestamp
    { type: 'bytes32[]' }, // potentialAssets
  ],
}];

function decodePotentialAssets(b32s) {
  const ids = [];
  for (const hex of b32s) {
    const n = hexToBigInt(hex);
    for (let slot = 9; slot >= 0; slot--) {          // slot 9 first = bits 216-239
      const b = (n >> (BigInt(slot) * 24n)) & 0xffffffn;
      if (b !== 0n) ids.push(Number(b));
    }
  }
  return ids;
}

function pickRandomAssets(finalSeed, assetIds) {
  let s = BigInt(finalSeed);
  const picked = [];
  for (const id of assetIds) {
    s = hexToBigInt(keccak256(encodePacked(['uint256', 'uint256'], [s, BigInt(id)])));
    if (s % 2n === 0n) picked.push(id);
  }
  return picked;
}

const N = 496;
const out = { tokens: [], missingAssetTokens: [], ipfsHashes: [] };
for (let id = 0; id < N; id++) {
  const d = await rpc.readContract({ address: DIGITAL_PRINT_IMAGE, abi, functionName: 'getImageMetadata', args: [BigInt(id)] });
  const [creator, extraData, finalSeed, ipfsHash, timestamp, potentialAssets] = d;
  const pool = decodePotentialAssets(potentialAssets);
  const picked = pickRandomAssets(finalSeed, pool);
  const missing = picked.filter(a => LOST_ASSETS.has(a));
  out.tokens.push({ id, creator, finalSeed: finalSeed.toString(), ipfsHash, timestamp: Number(timestamp), pool: pool.length, picked });
  if (ipfsHash) out.ipfsHashes.push({ id, ipfsHash });
  if (missing.length) out.missingAssetTokens.push({ id, creator, missingAssets: missing, ipfsHash });
  if ((id + 1) % 50 === 0) console.log(`${id + 1}/${N} audited, ${out.missingAssetTokens.length} affected`);
}
writeFileSync('data/nft-audit.json', JSON.stringify(out, null, 2));
console.log(`DONE — ${out.missingAssetTokens.length} tokens reference missing assets`);
console.log(JSON.stringify(out.missingAssetTokens, null, 2));
