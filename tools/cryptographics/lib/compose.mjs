// Port of the Cryptographics composition algorithm.
// Source: DecenterApps/Cryptographics client/src/services/ethereumService.js
//   calculateFinalSeed + getAssetMetadata + getImage  (getFinalAssets layerCompare)
//
// seed chaining: finalSeed = keccak(seed0, iterations) then keccak(seed, i) x iterations
// per asset:     seed = keccak(seed, assetId); asset included iff seed mod 2 == 0
// placement:     x=seed%2480 y=seed%3508 scale=seed%200+800 rot=seed%360 layer=seed%1234567
// attribute digits (each 1|2): hundreds=isBackground, tens=shouldRotate, units=shouldScale
import { keccak256, encodePacked, hexToBigInt } from 'viem';

const k = (seedB32, n) =>
  keccak256(encodePacked(['bytes32', 'uint256'], [seedB32, BigInt(n)]));

export function finalSeed(randomSeed, iterations) {
  let s = keccak256(
    encodePacked(['uint256', 'uint256'], [BigInt(randomSeed), BigInt(iterations)])
  );
  for (let i = 0; i < iterations; i++) s = k(s, i);
  return s;
}

export function pickAssets(seedB32, assetIds) {
  let s = seedB32;
  const picked = [];
  for (const id of assetIds) {
    s = k(s, Number(id));
    const n = hexToBigInt(s);
    if (n % 2n !== 0n) continue;
    picked.push({
      id: Number(id),
      x: Number(n % 2480n),
      y: Number(n % 3508n),
      scale: Number(n % 200n) + 800,
      rotation: Number(n % 360n),
      layer: Number(n % 1234567n),
    });
  }
  // layerCompare: by layer asc, tie-break by asset id asc
  return picked.sort((a, b) => a.layer - b.layer || a.id - b.id);
}

export function decodeAttributes(attr) {
  const a = Number(attr);
  return {
    isBackground: Math.floor((a / 100) % 10) === 1,
    shouldRotate: Math.floor((a / 10) % 10) === 1,
    shouldScale: Math.floor(a % 10) === 1,
  };
}

// The original UI let users pick any number of packs, concatenated ALL their
// assets, Math.random-shuffled, and sliced to 30 candidates (GraphicBuilder
// renderCanvas) — that's what fed the parity chain and what got stored in
// potentialAssets on-chain. For agent faxes we make the whole pipeline
// seed-derived: pack choice, pool sampling and pick all come from the same
// keccak chain, so the composition is deterministic end-to-end.
function* seedStream(seedB32) {
  let s = hexToBigInt(seedB32);
  for (let i = 0n; ; i++) {
    s = hexToBigInt(keccak256(encodePacked(['uint256', 'uint256'], [s, i])));
    yield s;
  }
}

// candidatePacks: [{ packId, assetIds: number[] }] — the allowed pack list.
// Draws packCount in [1, maxPacks] packs without replacement, unions their
// assets, keccak-shuffles, takes POOL_SIZE. Returns { packIds, pool }.
export function derivePool(seedB32, candidatePacks, { maxPacks = 3, poolSize = 30 } = {}) {
  const gen = seedStream(seedB32);
  const packs = [...candidatePacks];
  const packCount = Math.min(packs.length, Number(gen.next().value % BigInt(maxPacks)) + 1);
  const chosen = [];
  for (let i = 0; i < packCount; i++) {
    const idx = Number(gen.next().value % BigInt(packs.length));
    chosen.push(packs.splice(idx, 1)[0]);
  }
  // keccak Fisher–Yates over the union of chosen packs' assets
  const assets = chosen.flatMap(p => p.assetIds);
  for (let i = assets.length - 1; i > 0; i--) {
    const j = Number(gen.next().value % BigInt(i + 1));
    [assets[i], assets[j]] = [assets[j], assets[i]];
  }
  return { packIds: chosen.map(p => p.packId), pool: assets.slice(0, poolSize) };
}
