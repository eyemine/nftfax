#!/usr/bin/env node
// welcomer.mjs — the atom.2222 welcome agent.
//
// Polls the Rolofax telegraph for newly registered @fax handles and sends
// each one a unique Cryptographics welcome fax. Every artwork is seeded by
// the recipient's own handle ("crypto-fax:<handle>") so the composition is
// deterministic end-to-end and publicly re-derivable — the cover note
// prints the seed string for anyone to re-render and verify.
//
//   node welcomer.mjs --once --dry        preview the queue, nothing sent
//   node welcomer.mjs --once              one live sweep
//   node welcomer.mjs --interval 600      daemon: sweep every 10 minutes
//   node welcomer.mjs --to victor         force-send a single handle
//
// Requires FAX_AGENT_KEY: the hot key holding delegate.xyz rights for
// atom.2222's POW NFT. The NFT stays in the vault (rgbanksy.eth); this key
// can only sign session messages and send faxes.
//
// Deliveries are recorded in data/welcomer-seen.json — a handle is welcomed
// once. Failures are NOT recorded, so a transient outage retries next sweep.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, hexToBigInt, stringToHex } from 'viem';
import { finalSeed, decodeAttributes } from './lib/compose.mjs';
import { fetchIpfs } from './lib/ipfs.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const FROM = opt('--from', 'atom.2222');
const BASE = opt('--base', 'https://nftfax.app');
const DRY = args.includes('--dry');
const ONCE = args.includes('--once') || args.includes('--to');
const INTERVAL = Number(opt('--interval', 0));
const ONLY = opt('--to', null);
const ITER = 5;

const AGENT_KEY = process.env.FAX_AGENT_KEY;
const SEEN_PATH = 'data/welcomer-seen.json';
const PACKS = JSON.parse(readFileSync('../../app/lib/cryptographic-packs.json', 'utf8'));
const COLLECTIONS = ['chonk', 'deadfellaz', 'normie', 'pow'];

const log = (stage, msg) => console.log(`[${new Date().toISOString().slice(11, 19)} ${stage}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- seed -> recipe (identical to app/lib/cryptographic.ts composeRecipe) ----------
const chainK = (s, n) => keccak256(encodePacked(['bytes32', 'uint256'], [s, n]));

function* seedStream(seedB32) {
  let s = hexToBigInt(seedB32);
  for (let i = 0n; ; i++) {
    s = hexToBigInt(keccak256(encodePacked(['uint256', 'uint256'], [s, i])));
    yield s;
  }
}

/// recipient handle -> deterministic recipe. seed "crypto-fax:<handle>" is
/// printed in the cover note so anyone can re-derive the composition.
function composeForHandle(handle) {
  const seedTag = `crypto-fax:${handle}`;
  const randomSeed = BigInt(keccak256(stringToHex(seedTag)));
  const seed = finalSeed(randomSeed, ITER);
  const gen = seedStream(seed);

  const packs = [...PACKS];
  const packCount = Math.min(packs.length, Number(gen.next().value % 3n) + 1);
  const chosen = [];
  for (let i = 0; i < packCount; i++) {
    chosen.push(packs.splice(Number(gen.next().value % BigInt(packs.length)), 1)[0]);
  }

  const pool = chosen.flatMap((p) => p.assets.map(([a, cid, t]) => ({ a, cid, t, pack: p })));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Number(gen.next().value % BigInt(i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const candidates = pool.slice(0, 30);

  const picked = [];
  let s = seed;
  for (const c of candidates) {
    s = chainK(s, BigInt(c.a));
    const n = hexToBigInt(s);
    if (n % 2n !== 0n) continue;
    picked.push({
      id: c.a, cid: c.cid, pack: c.pack, t: c.t,
      x: Number(n % 2480n), y: Number(n % 3508n),
      scale: Number(n % 200n) + 800, rotation: Number(n % 360n), layer: Number(n % 1234567n),
    });
  }
  picked.sort((a, b) => a.layer - b.layer || a.id - b.id);
  const isBg = (a) => decodeAttributes(a.t).isBackground;
  const ordered = [...picked.filter(isBg), ...picked.filter((a) => !isBg(a))];
  return { seedTag, seed, packNames: chosen.map((p) => p.name), packIds: chosen.map((p) => p.id), picked: ordered };
}

// ---------- render (same rules as agent-demo / the web machine) ----------
const W = 2480, H = 3508;
async function render(recipe) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  let drawn = 0; const missing = [];
  for (const a of recipe.picked) {
    const local = join('data/ipfs', a.cid);
    let buf = existsSync(local) ? readFileSync(local) : await fetchIpfs(a.cid);
    if (!buf) { missing.push(a.cid); continue; }
    if (!existsSync(local)) { mkdirSync('data/ipfs', { recursive: true }); writeFileSync(local, buf); }
    const img = await loadImage(buf);
    const attr = decodeAttributes(a.t);
    if (attr.isBackground) ctx.drawImage(img, 0, 0);
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
  return { png: canvas.toBuffer('image/png'), drawn, missing };
}

// ---------- cover note ----------
const GREETING = { chonk: 'Chonk', dfz: 'Deadfella', normie: 'Normie', atom: 'Atom' };
function coverNote(handle, recipe) {
  const name = GREETING[handle.split('.')[0]] || 'friend';
  const note =
    `Welcome ${name}, to collaborate in NFTFAX CHAIN add to and forward this fax to any @fax in the ` +
    `Rolofax™. You can then mint your collage to Base for 0.002eth and be in the draw for 1 of 10 ` +
    `0.404eth prizes when the collection reaches 2,222 mints · crypto-fax · seed "${recipe.seedTag}" ` +
    `· packs ${recipe.packNames.join(' + ')} · ${recipe.picked.length} assets · keccak-seeded 2018 Cryptographics algorithm`;
  return note.slice(0, 500); // verified POW cryptoFax senders get 500 chars
}

// ---------- telegraph + registry ----------
function loadSeen() {
  return existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, 'utf8')) : {};
}
function saveSeen(seen) {
  mkdirSync('data', { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2));
}

async function listRegistrants() {
  const out = [];
  for (const c of COLLECTIONS) {
    try {
      const res = await fetch(`${BASE}/api/telegraph/list?collection=${c}`, { cache: 'no-store' });
      if (!res.ok) { log('POLL', `telegraph ${c}: HTTP ${res.status}`); continue; }
      const j = await res.json();
      for (const it of j.items || []) out.push(it);
    } catch (e) { log('POLL', `telegraph ${c}: ${e.message}`); }
  }
  return out;
}

// ---------- sign-in (once per process; session lasts 30 days) ----------
async function signIn() {
  if (!AGENT_KEY) return null;
  const account = privateKeyToAccount(AGENT_KEY);
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const { token } = await res.json();
  log('SIGN-IN', `${account.address} -> bearer token (sends as ${FROM}@fax via delegate.xyz)`);
  return token;
}

// ---------- one welcome ----------
async function welcome(handle, token, seen) {
  const recipe = composeForHandle(handle);
  log('COMPOSE', `${handle}: seed "${recipe.seedTag}" -> packs [${recipe.packNames.join(', ')}], ${recipe.picked.length} assets`);
  const { png, drawn, missing } = await render(recipe);
  if (missing.length) log('RENDER', `${handle}: WARNING ${missing.length} assets unavailable on IPFS`);

  mkdirSync('data/out', { recursive: true });
  const outPath = `data/out/welcome-${handle.replace(/[^a-z0-9]/gi, '_')}.png`;
  writeFileSync(outPath, png);
  writeFileSync(outPath.replace('.png', '.json'), JSON.stringify({
    algorithm: 'cryptographics-compose/1 (DecenterApps composition, keccak-seeded)',
    agent: `${FROM}@fax`, recipient: `${handle}@fax`,
    seed: recipe.seedTag, iterations: ITER, finalSeed: recipe.seed,
    packs: recipe.packIds.map((id, i) => ({ packId: id, name: recipe.packNames[i] })),
    pickedAssetIds: recipe.picked.map((a) => a.id), canvas: [W, H],
  }, null, 2));
  log('RENDER', `${handle}: ${drawn} drawn -> ${outPath}`);

  const body = {
    fromLabel: FROM, fromDomain: 'fax',
    to: `${handle}@fax`,
    format: 'png', colorMode: 'greyscale',
    dataBase64: png.toString('base64'),
    coverNote: coverNote(handle, recipe),
    cryptoFax: true,
  };

  if (DRY || !token) {
    log('SEND', `${handle}: dry-run — cover note (${body.coverNote.length} chars):\n    ${body.coverNote}`);
    return false;
  }
  const res = await fetch(`${BASE}/api/tray/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { log('SEND', `${handle}: FAILED ${res.status} ${data.error || ''}`); return false; }
  seen[handle] = { at: Date.now(), trayId: data.id, seed: recipe.seedTag };
  saveSeen(seen);
  log('SEND', `${handle}: delivered id=${data.id} ${data.trayUrl || ''}`);
  return true;
}

// ---------- sweep ----------
async function sweep(token, seen) {
  const items = ONLY
    ? [{ handle: ONLY.replace(/@fax$/, ''), ready: true }]
    : await listRegistrants();
  const queue = [...new Set(
    items
      .filter((i) => {
        const h = (i.handle || '').toLowerCase();
        return h && h !== FROM.toLowerCase() && i.ready !== false && (ONLY || !seen[h] || seen[h].dry);
      })
      .map((i) => i.handle.toLowerCase()),
  )];

  log('POLL', `${items.length} registrants, ${queue.length} unwelcomed`);
  for (const h of queue) {
    try {
      const ok = await welcome(h, token, seen);
      if (ok) await sleep(2000); // polite pacing between live sends
    } catch (e) {
      log('ERROR', `${h}: ${e.message}`); // not recorded -> retried next sweep
    }
  }
}

// ---------- main ----------
if (!DRY && !AGENT_KEY) {
  console.error('FAX_AGENT_KEY is required for a live sweep. Use --dry to preview.');
  process.exit(1);
}
const token = DRY ? null : await signIn().catch((e) => { log('SIGN-IN', e.message); return null; });
const seen = loadSeen();
if (INTERVAL > 0 && !ONCE) {
  log('DAEMON', `sweeping every ${INTERVAL}s — Ctrl-C to stop`);
  for (;;) { await sweep(token, seen); await sleep(INTERVAL * 1000); }
} else {
  await sweep(token, seen);
}
