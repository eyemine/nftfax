#!/usr/bin/env node
// Rescue pass for CIDs that failed the public-gateway mirror.
//   node rescue.mjs [--timeout 90] [--concurrency 4]
//
// Path per CID:
//   1. local kubo daemon  `ipfs cat`  — real bitswap; finds ANY provider
//      still serving the block, incl. Decenter's origin node if alive
//   2. extended gateways (nft.storage, w3s, fleek, 4everland, aragon...)
//   3. still-failed -> data/rescue-report.json, flagged for reconstruction
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCid } from './lib/ipfs.mjs';

const run = promisify(execFile);
const IPFS = '/Applications/IPFS Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/kubo/kubo/ipfs';
const args = process.argv.slice(2);
const num = (n, d) => { const i = args.indexOf(n); return i > -1 ? Number(args[i + 1]) : d; };
const TIMEOUT = num('--timeout', 90);        // seconds per ipfs cat
const CONCURRENCY = num('--concurrency', 4); // parallel ipfs cat processes

const EXTRA_GATEWAYS = [
  'https://nftstorage.link/ipfs',
  'https://w3s.link/ipfs',
  'https://4everland.io/ipfs',
  'https://ipfs.fleek.co/ipfs',
  'https://ipfs.eth.aragon.network/ipfs',
  'https://storry.tv/ipfs',
];

const report = JSON.parse(readFileSync('data/mirror-report.json', 'utf8'));
const queue = report.failed.filter(f => !existsSync(join('data/ipfs', f.cid)));
console.log(`${queue.length} CIDs to rescue (${TIMEOUT}s node timeout, ${CONCURRENCY} parallel)`);

const out = { rescued: [], stillLost: [] };

async function tryNode(cid) {
  try {
    const { stdout } = await run(IPFS, ['cat', '--timeout', `${TIMEOUT}s`, cid], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'buffer',
    });
    const buf = Buffer.from(stdout);
    return (await verifyCid(buf, cid)) ? buf : null;
  } catch { return null; }
}

async function tryGateways(cid) {
  for (const gw of EXTRA_GATEWAYS) {
    try {
      const res = await fetch(`${gw}/${cid}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (await verifyCid(buf, cid)) return buf;
    } catch { /* next */ }
  }
  return null;
}

let done = 0;
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    let buf = await tryNode(f.cid);
    const via = buf ? 'node' : (buf = await tryGateways(f.cid)) ? 'gateway' : null;
    if (buf) {
      writeFileSync(join('data/ipfs', f.cid), buf);
      out.rescued.push({ cid: f.cid, label: f.label, via });
      console.log(`RESCUED via ${via}: ${f.label}`);
    } else {
      out.stillLost.push(f);
    }
    if (++done % 10 === 0) console.log(`  ${done} tried, ${out.rescued.length} rescued`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync('data/rescue-report.json', JSON.stringify(out, null, 2));
console.log(`DONE — rescued ${out.rescued.length}, still lost ${out.stillLost.length}`);
