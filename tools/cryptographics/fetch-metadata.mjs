#!/usr/bin/env node
// Fetch the REAL packMetadataIpfs CIDs (ASCII bytes field, fixed after the
// bytes32-offset misread). Tries, in order:
//   1. local kubo daemon `ipfs cat`   — bitswap/DHT
//   2. cpx32 archive node via ssh     — publicly dialable, strong DHT position
//   3. extended public gateways
// Writes verified files to data/ipfs/<cid>; report to data/metadata-rescue.json
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifyCid } from './lib/ipfs.mjs';

const run = promisify(execFile);
const IPFS = '/Applications/IPFS Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/kubo/kubo/ipfs';
const NODE_TIMEOUT = '60s';

const EXTRA_GATEWAYS = [
  'https://ipfs.decenter.com/ipfs',
  'https://nftstorage.link/ipfs',
  'https://w3s.link/ipfs',
  'https://gateway.pinata.cloud/ipfs',
  'https://ipfs.io/ipfs',
  'https://4everland.io/ipfs',
];

const cids = [...new Set(JSON.parse(readFileSync('data/real-metadata-cids.json', 'utf8')))];
const queue = cids.filter(c => !existsSync(join('data/ipfs', c)));
console.log(`${queue.length} metadata CIDs to fetch (${cids.length} total)`);

const out = { rescued: [], stillLost: [] };

async function tryLocal(cid) {
  try {
    const { stdout } = await run(IPFS, ['cat', '--timeout', NODE_TIMEOUT, cid],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
    const buf = Buffer.from(stdout);
    return (await verifyCid(buf, cid)) ? buf : null;
  } catch { return null; }
}

async function tryServer(cid) {
  try {
    const { stdout } = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
      'root@46.225.158.75',
      `docker exec ipfs-archive ipfs cat --timeout ${NODE_TIMEOUT} ${cid}`],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
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
    const cid = queue.shift();
    let buf = await tryLocal(cid);
    const via = buf ? 'local-node' : (buf = await tryServer(cid)) ? 'server-node'
      : (buf = await tryGateways(cid)) ? 'gateway' : null;
    if (buf) {
      writeFileSync(join('data/ipfs', cid), buf);
      out.rescued.push({ cid, via });
      console.log(`RESCUED via ${via}: ${cid}`);
    } else {
      out.stillLost.push(cid);
    }
    if (++done % 10 === 0) console.log(`  ${done} tried, ${out.rescued.length} rescued`);
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
writeFileSync('data/metadata-rescue.json', JSON.stringify(out, null, 2));
console.log(`DONE — rescued ${out.rescued.length}, still lost ${out.stillLost.length}`);
