#!/usr/bin/env node
// Standalone Cryptographics renderer: seed + pack ids -> PNG.
//   node render.mjs --packs 24,25 --seed 12345 --iterations 5 --out data/out/fax.png [--scale 0.5]
//   node render.mjs --packs 24 --list          (show pack contents only)
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { finalSeed, pickAssets, decodeAttributes, derivePool } from './lib/compose.mjs';
import { fetchIpfs } from './lib/ipfs.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const PACK_IDS = opt('--packs', '24').split(',').map(Number);
const SEED = opt('--seed', String(Date.now()));
const ITER = Number(opt('--iterations', 5));
const OUT = opt('--out', `data/out/cryptographic-${Date.now()}.png`);
const SCALE = Number(opt('--scale', 1));
const SQUARE = args.includes('--square');
const MONO = args.includes('--mono'); // thermal-fax treatment: dither to 1-bit
const LIST = args.includes('--list');

const AUTO = args.includes('--auto'); // seed derives pack choice + 30-asset pool (agent mode)

const W = 2480, H = SQUARE ? 2480 : 3508;
const dump = JSON.parse(readFileSync('data/chain-dump.json', 'utf8'));

let packs, assetPool;
if (AUTO) {
  // allowlist = all eyemine-created packs unless --packs narrows it
  const allowed = (PACK_IDS.length === 1 && PACK_IDS[0] === 24 && !args.includes('--packs'))
    ? dump.packs.filter(p => p.eyemineCreated)
    : PACK_IDS.map(id => dump.packs.find(x => x.packId === id));
  const seedPre = finalSeed(BigInt(SEED), ITER);
  const derived = derivePool(seedPre, allowed.map(p => ({ packId: p.packId, assetIds: p.assetIds })));
  packs = allowed.filter(p => derived.packIds.includes(p.packId));
  assetPool = derived.pool;
  console.log(`AUTO: seed chose packs [${derived.packIds.join(', ')}], pool of ${assetPool.length}`);
} else {
  packs = PACK_IDS.map(id => {
    const p = dump.packs.find(x => x.packId === id);
    if (!p) throw new Error(`pack ${id} not in dump`);
    return p;
  });
  assetPool = null; // all pack assets are candidates (legacy mode)
}

// every asset id in the selected packs is a candidate; attributes align by index
const assetIds = [], attrById = {}, cidById = {}, packById = {};
for (const p of packs) {
  p.assetIds.forEach((aid, i) => {
    assetIds.push(aid);
    attrById[aid] = p.attributes[i];
    cidById[aid] = p.assetCids[i];
    packById[aid] = p.packId;
  });
}
if (LIST) {
  for (const p of packs) {
    console.log(`pack ${p.packId} by ${p.creatorUsername || p.creator} — ${p.assetIds.length} assets, eyemine-created: ${p.eyemineCreated}`);
  }
  console.log(`${assetIds.length} candidate assets`);
  process.exit(0);
}

const seed = finalSeed(BigInt(SEED), ITER);
const rawPicked = pickAssets(seed, assetPool ?? assetIds);
// helpers.moveBackgrounds: all isBackground assets move to the front of the
// draw array (bottom of the stack), preserving their relative layer order.
const isBg = a => decodeAttributes(attrById[a.id] ?? 111).isBackground;
const picked = [...rawPicked.filter(isBg), ...rawPicked.filter(a => !isBg(a))];
console.log(`seed=${SEED} iterations=${ITER} -> ${picked.length}/${assetIds.length} assets picked`);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, W, H);

let drawn = 0, missing = [];
for (const a of picked) {
  const cid = cidById[a.id];
  const local = join('data/ipfs', cid);
  let buf = existsSync(local) ? readFileSync(local) : await fetchIpfs(cid);
  if (!buf) { missing.push({ id: a.id, cid }); continue; }
  if (!existsSync(local)) writeFileSync(local, buf); // opportunistic mirror

  const img = await loadImage(buf);
  const attr = decodeAttributes(attrById[a.id] ?? 111);

  if (attr.isBackground) {
    ctx.drawImage(img, 0, 0); // natural size, anchored 0,0 — never stretched
  } else {
    const mult = attr.shouldScale ? a.scale / 1000 : 1;
    const deg = attr.shouldRotate ? a.rotation : 0;
    ctx.save();
    ctx.translate(a.x % W, a.y % H);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(img, (-img.width / 2) * mult, (-img.height / 2) * mult, img.width * mult, img.height * mult);
    ctx.restore();
  }
  drawn++;
}

if (MONO) {
  // Floyd–Steinberg dither to pure 1-bit — approximates what the thermal
  // printer does to the artwork on the physical fax path.
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255; continue; }
      const old = lum(i);
      const nw = old < 128 ? 0 : 255;
      const err = old - nw;
      d[i] = d[i + 1] = d[i + 2] = nw; d[i + 3] = 255;
      const spread = (x2, y2, f) => {
        if (x2 < 0 || x2 >= W || y2 >= H) return;
        const j = (y2 * W + x2) * 4;
        const v = Math.min(255, Math.max(0, lum(j) + err * f));
        d[j] = d[j + 1] = d[j + 2] = v;
      };
      spread(x + 1, y, 7 / 16); spread(x - 1, y + 1, 3 / 16);
      spread(x, y + 1, 5 / 16); spread(x + 1, y + 1, 1 / 16);
    }
  }
  ctx.putImageData(id, 0, 0);
}

mkdirSync('data/out', { recursive: true });
let outBuf;
if (SCALE !== 1) {
  const small = createCanvas(Math.round(W * SCALE), Math.round(H * SCALE));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  outBuf = small.toBuffer('image/png');
} else {
  outBuf = canvas.toBuffer('image/png');
}
writeFileSync(OUT, outBuf);
console.log(`drew ${drawn} assets -> ${OUT} (${Math.round(outBuf.length / 1024)} KB)`);
if (missing.length) console.log(`MISSING ${missing.length} assets:`, missing.map(m => m.cid).join(', '));

// provenance record — drop alongside the PNG for attribution
const provenance = {
  algorithm: 'cryptographics-compose/1 (DecenterApps composition, keccak-seeded)',
  seed: String(SEED), iterations: ITER, finalSeed: seed,
  packs: packs.map(p => ({ packId: p.packId, creator: p.creator, creatorUsername: p.creatorUsername })),
  pickedAssetIds: picked.map(a => a.id),
  canvas: [W, H],
};
writeFileSync(OUT.replace(/\.png$/, '.json'), JSON.stringify(provenance, null, 2));
