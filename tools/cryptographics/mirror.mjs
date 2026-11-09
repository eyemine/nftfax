#!/usr/bin/env node
// Mirror all Cryptographics IPFS content to local disk + repin to Pinata.
// Content-addressed: re-uploading preserves the original CIDv0, so the
// on-chain hashes stay valid — we're just adding durable pins.
//
//   node mirror.mjs [--download-only] [--pin-only] [--concurrency 8]
//
// Reads ../../.env.local for PINATA_JWT when pinning.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchIpfs, pinFile, verifyCid, listPinned } from './lib/ipfs.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const num = (n, d) => { const i = args.indexOf(n); return i > -1 ? Number(args[i + 1]) : d; };
const CONCURRENCY = num('--concurrency', 8);
const DO_DOWNLOAD = !flag('--pin-only');
const DO_PIN = !flag('--download-only');

// load env keys without printing them
if (existsSync('../../.env.local')) {
  for (const line of readFileSync('../../.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

const dump = JSON.parse(readFileSync('data/chain-dump.json', 'utf8'));
mkdirSync('data/ipfs', { recursive: true });

// every CID worth preserving: pack metadata JSONs, pack covers, all assets
const wanted = new Map(); // cid -> label
for (const p of dump.packs) {
  wanted.set(p.metadataCid, `pack-${p.packId}-metadata.json`);
  wanted.set(p.packCoverCid, `pack-${p.packId}-cover.png`);
  p.assetCids.forEach((c, i) => wanted.set(c, `pack-${p.packId}-asset-${p.assetIds[i]}.png`));
}
console.log(`${wanted.size} unique CIDs across ${dump.packs.length} packs`);

// skip already-pinned CIDs — one list call instead of thousands of re-uploads
let alreadyPinned = new Set();
if (DO_PIN) {
  try { alreadyPinned = await listPinned(); }
  catch (e) { console.log(`pinList lookup failed (${e.message}) — will upload everything`); }
  if (alreadyPinned.size) console.log(`${alreadyPinned.size} CIDs already pinned on account`);
}

const report = { total: wanted.size, downloaded: 0, pinned: 0, failed: [] };
const queue = [...wanted.entries()];
let done = 0;

async function worker() {
  while (queue.length) {
    const [cid, label] = queue.shift();
    const path = join('data/ipfs', cid);
    try {
      if (DO_DOWNLOAD) {
        let cached = existsSync(path) ? readFileSync(path) : null;
        if (cached && !(await verifyCid(cached, cid))) {
          cached = null; // gateway error page or truncated write — refetch
        }
        if (!cached) {
          const buf = await fetchIpfs(cid);
          if (!buf) throw new Error('all gateways failed');
          writeFileSync(path, buf);
          report.downloaded++;
        }
      }
      if (DO_PIN) {
        if (alreadyPinned.has(cid)) { report.pinned++; }
        else {
          const buf = readFileSync(path);
          await pinFile(buf, cid, `cryptographics/${label}`);
          report.pinned++;
          await new Promise(r => setTimeout(r, 400)); // stay under free-tier rate
        }
      }
    } catch (e) {
      report.failed.push({ cid, label, error: String(e).slice(0, 200) });
    }
    if (++done % 100 === 0) {
      console.log(`${done}/${wanted.size} (downloaded ${report.downloaded}, pinned ${report.pinned}, failed ${report.failed.length})`);
      writeFileSync('data/mirror-report.json', JSON.stringify(report, null, 2));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync('data/mirror-report.json', JSON.stringify(report, null, 2));
console.log(`DONE — downloaded ${report.downloaded}, pinned ${report.pinned}, failed ${report.failed.length}`);
if (report.failed.length) console.log(`see data/mirror-report.json for the ${report.failed.length} failures`);
