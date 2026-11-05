/// Cryptographics composition engine — browser port of the original 2018
/// Decenter client pipeline (verified against GraphicBuilder.vue /
/// imageService.js / Functions.sol):
///   finalSeed = keccak(seed, iterations) chained keccak(seed, i) per iteration
///   pool      = seed derives 1-3 packs, keccak Fisher–Yates the asset union,
///               first 30 candidates (the UI's Math.random shuffle + slice(0,30))
///   per asset:  seed = keccak(seed, assetId); drawn iff the hash is even
///   placement:  x=seed%2480 y=seed%3508 scale=seed%200+800 rot=seed%360
///               layer=seed%1234567
///   draw order: layerCompare, then helpers.moveBackgrounds pulls background-
///               flagged assets to the front (bottom) at natural size.
import { keccak256, encodePacked, hexToBigInt } from 'viem';
import packCatalog from './cryptographic-packs.json';

export const CANVAS_W = 2480;
export const CANVAS_H = 3508;

type PackAssets = [number, string, number][]; // [assetId, cid, attributes]
interface CatalogPack { id: number; name: string; assets: PackAssets }
const PACKS = packCatalog as unknown as CatalogPack[];

const chain = (seedB32: `0x${string}`, n: bigint) =>
  keccak256(encodePacked(['bytes32', 'uint256'], [seedB32, n]));

export function finalSeed(randomSeed: bigint, iterations: number): `0x${string}` {
  let s = keccak256(encodePacked(['uint256', 'uint256'], [randomSeed, BigInt(iterations)]));
  for (let i = 0; i < iterations; i++) s = chain(s, BigInt(i));
  return s;
}

function* seedStream(seedB32: `0x${string}`): Generator<bigint, never> {
  let s = hexToBigInt(seedB32);
  for (let i = 0; ; i++) {
    s = hexToBigInt(keccak256(encodePacked(['uint256', 'uint256'], [s, BigInt(i)])));
    yield s;
  }
}

interface PickedAsset {
  id: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  layer: number;
  cid: string;
  isBackground: boolean;
  shouldRotate: boolean;
  shouldScale: boolean;
  pack: CatalogPack;
}

export interface CryptoRecipe {
  seed: string;
  iterations: number;
  finalSeed: string;
  packNames: string[];
  picked: PickedAsset[];
}

/// Derives a full recipe deterministically from the seed. maxPacks/poolSize
/// match the observed client behaviour; 30 is the on-chain potentialAssets cap.
export function composeRecipe(randomSeed: bigint, iterations = 5): CryptoRecipe {
  const seed = finalSeed(randomSeed, iterations);
  const gen = seedStream(seed);

  // pack choice: 1..3 packs drawn without replacement
  const packs = [...PACKS];
  const packCount = Math.min(packs.length, Number(gen.next().value % BigInt(3)) + 1);
  const chosen: CatalogPack[] = [];
  for (let i = 0; i < packCount; i++) {
    chosen.push(packs.splice(Number(gen.next().value % BigInt(packs.length)), 1)[0]);
  }

  // asset union, keccak Fisher–Yates, first 30 candidates
  const pool = chosen.flatMap((p) => p.assets.map(([a, cid, t]) => ({ a, cid, t, pack: p })));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Number(gen.next().value % BigInt(i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const candidates = pool.slice(0, 30);

  // parity chain: keccak(seed, assetId) even -> drawn
  const picked: PickedAsset[] = [];
  let s: `0x${string}` = seed;
  for (const c of candidates) {
    s = chain(s, BigInt(c.a));
    const n = hexToBigInt(s);
    if (n % BigInt(2) !== BigInt(0)) continue;
    picked.push({
      id: c.a, cid: c.cid, pack: c.pack,
      x: Number(n % BigInt(2480)),
      y: Number(n % BigInt(3508)),
      scale: Number(n % BigInt(200)) + 800,
      rotation: Number(n % BigInt(360)),
      layer: Number(n % BigInt(1234567)),
      isBackground: Math.floor((c.t / 100) % 10) === 1,
      shouldRotate: Math.floor((c.t / 10) % 10) === 1,
      shouldScale: c.t % 10 === 1,
    });
  }
  picked.sort((a, b) => a.layer - b.layer || a.id - b.id);
  // moveBackgrounds: flagged assets to the bottom, relative order preserved
  picked.sort((a, b) => Number(b.isBackground) - Number(a.isBackground));

  return {
    seed: String(randomSeed), iterations, finalSeed: seed,
    packNames: chosen.map((p) => p.name), picked,
  };
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('asset failed to load'));
    img.src = url;
  });
}

/// Renders a recipe onto the A4 canvas. Assets come through the same-origin
/// CID proxy (/api/cryptographic/asset/[cid]) backed by the archive kubo on
/// the same host; a missing block is skipped exactly like the standalone
/// renderer. Returns the canvas as a PNG File plus what was drawn.
export async function renderRecipe(
  recipe: CryptoRecipe,
  onProgress?: (done: number, total: number) => void,
): Promise<{ file: File; drawn: number; missing: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot operate the image processor.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  let drawn = 0, missing = 0;
  for (const a of recipe.picked) {
    try {
      const img = await loadImg(`/api/cryptographic/asset/${a.cid}`);
      if (a.isBackground) {
        ctx.drawImage(img, 0, 0); // natural size, anchored 0,0
      } else {
        const mult = a.shouldScale ? a.scale / 1000 : 1;
        const deg = a.shouldRotate ? a.rotation : 0;
        ctx.save();
        ctx.translate(a.x % CANVAS_W, a.y % CANVAS_H);
        ctx.rotate((deg * Math.PI) / 180);
        ctx.drawImage(img, (-img.width / 2) * mult, (-img.height / 2) * mult, img.width * mult, img.height * mult);
        ctx.restore();
      }
      drawn++;
    } catch {
      missing++;
    }
    onProgress?.(drawn + missing, recipe.picked.length);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The composition could not be encoded.');
  return { file: new File([blob], `cryptographic-${recipe.seed.slice(0, 12)}.png`, { type: 'image/png' }), drawn, missing };
}

/// Random uint256 seed from the CSPRNG — user rolls get real entropy; the
/// derived pipeline after it is fully deterministic and re-renderable.
export function randomSeed(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = BigInt(0);
  for (let i = 0; i < bytes.length; i++) s = (s << BigInt(8)) | BigInt(bytes[i]);
  return s;
}
