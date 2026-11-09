#!/usr/bin/env node
// Agent demo: the full loop an @fax agent runs when it decides to answer a
// fax with a Cryptographics composition.
//
//   node agent-demo.mjs --fax-id 12345 --from atom.7 --to victor --dry
//   node agent-demo.mjs --fax-id 12345 --from atom.7 --to victor@fax          (live send)
//
// Loop stages (each logged as it happens):
//   1. SIGN-IN   agent's EOA signs the nftfax session message once
//                -> POST /api/auth/session -> bearer token (reused 30 days)
//   2. COMPOSE   seed = incoming fax id -> keccak-chained asset pick
//                -> deterministic, verifiable by anyone re-running the seed
//   3. RENDER    PNG via node-canvas, A4 300dpi + provenance JSON sidecar
//   4. SEND      POST /api/tray/send  fromLabel=agent @fax handle
//                server verifies: session token -> wallet -> owns the @fax NFT
//                (or delegate.xyz delegate) -> credits -> relays to recipient
//
// --dry runs everything except the live POST: it still signs in, renders,
// and prints the exact request body that would be sent.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { privateKeyToAccount } from 'viem/accounts';
import { stringToHex } from 'viem';
import { finalSeed, pickAssets, decodeAttributes } from './lib/compose.mjs';
import { fetchIpfs } from './lib/ipfs.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const FAX_ID = opt('--fax-id', String(Date.now() % 100000));
const FROM = opt('--from', 'atom.0');            // agent's @fax handle (no domain needed, 'fax' assumed)
const TO = opt('--to', 'victor@fax');
const BASE = opt('--base', 'https://nftfax.app');
const DRY = args.includes('--dry');
const ITER = Number(opt('--iterations', 5));

// Agent keys live outside the repo. Path or raw hex via env — never in argv/logs.
const AGENT_KEY = process.env.FAX_AGENT_KEY;     // 0x-prefixed private key for the wallet holding the @fax NFT
const PACK_IDS = (process.env.FAX_AGENT_PACKS || '24,32').split(',').map(Number);

const log = (stage, msg) => console.log(`[${stage}] ${msg}`);

// ---------- stage 2+3: compose & render (same math as render.mjs) ----------
const dump = JSON.parse(readFileSync('data/chain-dump.json', 'utf8'));
const packs = PACK_IDS.map(id => {
  const p = dump.packs.find(x => x.packId === id);
  if (!p) throw new Error(`pack ${id} not in dump`);
  return p;
});
for (const p of packs) {
  if (!p.eyemineCreated) console.warn(`  WARNING pack ${p.packId} creator ${p.creator} is not eyemine — confirm rights before live use`);
}

const assetIds = [], attrById = {}, cidById = {};
for (const p of packs) p.assetIds.forEach((aid, i) => {
  assetIds.push(aid); attrById[aid] = p.attributes[i]; cidById[aid] = p.assetCids[i];
});

const seed = finalSeed(BigInt(FAX_ID), ITER);
const rawPicked = pickAssets(seed, assetIds);
// helpers.moveBackgrounds: isBackground assets draw first (bottom), in
// relative layer order — faithful to the original client
const isBg = a => decodeAttributes(attrById[a.id] ?? 111).isBackground;
const picked = [...rawPicked.filter(isBg), ...rawPicked.filter(a => !isBg(a))];
log('COMPOSE', `seed=fax:${FAX_ID} iterations=${ITER} -> ${picked.length}/${assetIds.length} assets picked`);

const W = 2480, H = 3508;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, W, H);

let drawn = 0, missing = [];
for (const a of picked) {
  const cid = cidById[a.id];
  const local = join('data/ipfs', cid);
  let buf = existsSync(local) ? readFileSync(local) : await fetchIpfs(cid);
  if (!buf) { missing.push(cid); continue; }
  if (!existsSync(local)) writeFileSync(local, buf);
  const img = await loadImage(buf);
  const attr = decodeAttributes(attrById[a.id] ?? 111);
  if (attr.isBackground) ctx.drawImage(img, 0, 0); // natural size at 0,0 — original never stretched
  else {
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

mkdirSync('data/out', { recursive: true });
const png = canvas.toBuffer('image/png');
const outPath = `data/out/agent-fax-${FAX_ID}.png`;
writeFileSync(outPath, png);
const provenance = {
  algorithm: 'cryptographics-compose/1 (DecenterApps composition, keccak-seeded)',
  trigger: { incomingFaxId: String(FAX_ID) },
  agent: `${FROM}@fax`,
  seed: String(FAX_ID), iterations: ITER, finalSeed: seed,
  packs: packs.map(p => ({ packId: p.packId, creator: p.creator, creatorUsername: p.creatorUsername })),
  pickedAssetIds: picked.map(a => a.id),
  canvas: [W, H],
};
writeFileSync(outPath.replace('.png', '.json'), JSON.stringify(provenance, null, 2));
log('RENDER', `drew ${drawn} assets -> ${outPath} (${Math.round(png.length / 1024)} KB) + provenance JSON`);
if (missing.length) log('RENDER', `WARNING ${missing.length} assets unavailable on IPFS`);

// ---------- stage 1: agent sign-in (skipped in --dry unless key present) ----------
let token = null;
if (AGENT_KEY) {
  const account = privateKeyToAccount(AGENT_KEY);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const message = [
    'nftfax.app sign-in', '',
    'Sign to prove you control this wallet. This is not a transaction and costs no gas.', '',
    `Wallet: ${account.address.toLowerCase()}`,
    `Issued: ${new Date().toISOString()}`,
    `Nonce: ${nonce}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  token = data.token;
  log('SIGN-IN', `${account.address} -> session token acquired (send as Bearer)`);
} else {
  log('SIGN-IN', 'FAX_AGENT_KEY not set — dry-run only (no token, no live send)');
}

// ---------- stage 4: send ----------
const body = {
  fromLabel: FROM,
  fromDomain: 'fax',
  to: TO,
  format: 'png',
  colorMode: 'greyscale',
  dataBase64: png.toString('base64'),
  coverNote: `cryptographic fax — seed ${FAX_ID}, packs ${PACK_IDS.join('+')}, re-render to verify`,
};

if (DRY || !token) {
  const preview = { ...body, dataBase64: `<${body.dataBase64.length} base64 chars>` };
  log('SEND', `dry-run — would POST ${BASE}/api/tray/send with:`);
  console.log(JSON.stringify(preview, null, 2));
  console.log('\nServer-side checks that would run:');
  console.log('  1. Bearer token -> session wallet');
  console.log(`  2. verifyFaxHandleOwner("${FROM}", wallet) — wallet must hold the @fax NFT or be a delegate.xyz delegate`);
  console.log(`  3. transferForwardCredit -> credit moves to ${TO.split('@')[0]} (hop 1)`);
  console.log('  4. setTrayDocument -> fax lands in recipient tray, thermal timer starts');
  process.exit(0);
}

const res = await fetch(`${BASE}/api/tray/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const data = await res.json();
if (!res.ok) throw new Error(`send failed: ${res.status} ${JSON.stringify(data)}`);
log('SEND', `fax delivered: id=${data.id} trayUrl=${data.trayUrl}`);
