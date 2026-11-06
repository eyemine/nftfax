#!/usr/bin/env node
// Regenerate app/lib/cryptographic-packs.json — the Cryptographic machine's
// pack allowlist. The allowlist = every asset pack CREATED or BOUGHT by the
// permissioned wallets (buying a pack granted compose rights on the original
// platform; we read both lists on-chain, so new packs are picked up here):
//
//   eyemine.eth · ghostagent.eth · rgbanksy.eth
//
//   node scripts/gen-cryptographic-packs.mjs          # report + write
//   node scripts/gen-cryptographic-packs.mjs --check  # report only, exit 1 if stale
//
// After it adds packs: commit the JSON and deploy. The web machine and the
// welcomer agent both read this one file.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const ASSET_MANAGER = '0x80d774ffd99ad3321497064a2713bf2f89eeb5d6';
const OUT = 'app/lib/cryptographic-packs.json';
const GATEWAYS = [
  (cid) => `https://nftfax.app/api/cryptographic/asset/${cid}`, // our archive first
  (cid) => `https://ipfs.io/ipfs/${cid}`,
];

// Resolved on mainnet; ENS lookup per run would silently follow a later
// re-pointing, so the addresses are pinned and the script warns on mismatch.
const OWNERS = [
  { name: 'eyemine.eth', address: '0xe811F02418646AE93F540ED2877a487BE85dd842' },
  { name: 'ghostagent.eth', address: '0xf251Ca37a80200f7AfefF398DA0338f4C1f01249' },
  { name: 'rgbanksy.eth', address: '0x4b35237538fe70863D7E7bbBC83F3F621C6c4fB9' },
];

const rpc = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com') });
const abi = [
  { name: 'getAssetPacksUserCreated', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'getBoughtAssetPacks', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  {
    name: 'getAssetPackData', type: 'function', stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    // outputs: cover b32, creator, price, assetIds, attributes, assetCids b32[],
    // metadata CID as DYNAMIC bytes (ASCII) — NOT bytes32 (the original dump bug)
    outputs: [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }, { type: 'bytes32[]' }, { type: 'bytes' }],
  },
  { name: 'checkHasPermissionForPack', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const read = (fn, args = []) => rpc.readContract({ address: ASSET_MANAGER, abi, functionName: fn, args });

function bytes32ToCid(b32) {
  // CIDv0 = base58(0x1220 || sha256-digest); the contract stores the digest.
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = Buffer.from('1220' + b32.slice(2), 'hex');
  let n = BigInt('0x' + bytes.toString('hex'));
  let s = '';
  while (n > 0n) { s = alphabet[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}

async function packName(metadataCid) {
  const sources = [`tools/cryptographics/data/ipfs/${metadataCid}`];
  if (existsSync(sources[0])) {
    try { return JSON.parse(readFileSync(sources[0], 'utf8')).name; } catch { /* fall through */ }
  }
  for (const url of GATEWAYS.map(f => f(metadataCid))) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return (await res.json()).name;
    } catch { /* next gateway */ }
  }
  return null;
}

// ENS sanity check — warn (don't fail) if an identity re-pointed.
for (const o of OWNERS) {
  try {
    const current = await rpc.getEnsAddress({ name: o.name });
    if (current?.toLowerCase() !== o.address.toLowerCase()) {
      console.warn(`WARNING ${o.name} now resolves to ${current} — catalog pins ${o.address}`);
    }
  } catch { /* ENS lookup unavailable — proceed with pinned address */ }
}

const allowed = new Map(); // packId -> Set of {name, address, via}
for (const o of OWNERS) {
  const [created, bought] = await Promise.all([
    read('getAssetPacksUserCreated', [o.address]),
    read('getBoughtAssetPacks', [o.address]),
  ]);
  for (const id of created.map(Number)) (allowed.get(id) ?? allowed.set(id, new Set()).get(id)).add(JSON.stringify({ n: o.name, a: o.address, via: 'created' }));
  for (const id of bought.map(Number)) (allowed.get(id) ?? allowed.set(id, new Set()).get(id)).add(JSON.stringify({ n: o.name, a: o.address, via: 'owns' }));
}

const packs = [];
const denied = [];
for (const id of [...allowed.keys()].sort((a, b) => a - b)) {
  const [, creator, , assetIds, attributes, hashes, metaBytes] = await read('getAssetPackData', [BigInt(id)]);
  // dynamic bytes holding the metadata CID as ASCII text
  const metaCid = Buffer.from(metaBytes.slice(2), 'hex').toString('utf8').replace(/\0.*$/s, '').trim();
  const name = (metaCid && (await packName(metaCid))) || `pack ${id}`;
  // permission is per-owner: verify it for each wallet that created/bought
  // this pack, not for the whole allowlist trio
  for (const entry of allowed.get(id)) {
    const { n, a } = JSON.parse(entry);
    if (!(await read('checkHasPermissionForPack', [a, BigInt(id)]))) denied.push(`${id} (${n})`);
  }
  packs.push({
    id, name,
    by: { '0xe811f02418646ae93f540ed2877a487be85dd842': 'eyemine.eth', '0xf251ca37a80200f7afeff398da0338f4c1f01249': 'ghostagent.eth', '0x4b35237538fe70863d7e7bbbc83f3f621c6c4fb9': 'rgbanksy.eth' }[creator.toLowerCase()] || creator.slice(0, 10),
    assets: assetIds.map((a, i) => [Number(a), bytes32ToCid(hashes[i]), Number(attributes[i])]),
  });
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const prevIds = new Set(prev.map(p => p.id));
const added = packs.filter(p => !prevIds.has(p.id)).map(p => `${p.id}:${p.name}`);
const removed = prev.filter(p => !allowed.has(p.id)).map(p => `${p.id}:${p.name}`);
console.log(`${packs.length} allowed packs (was ${prev.length})`);
if (added.length) console.log(`  ADDED: ${added.join(', ')}`);
if (removed.length) console.log(`  REMOVED: ${removed.join(', ')}`);
if (denied.length) console.warn(`  WARNING: no on-chain compose permission: ${denied.join(', ')}`);

if (process.argv.includes('--check')) {
  process.exit(added.length || removed.length ? 1 : 0);
}
if (added.length || removed.length || prev.length !== packs.length) {
  writeFileSync(OUT, JSON.stringify(packs));
  console.log(`wrote ${OUT} (${Math.round(JSON.stringify(packs).length / 1024)} KB) — commit + deploy to ship`);
} else {
  console.log(`${OUT} unchanged`);
}
