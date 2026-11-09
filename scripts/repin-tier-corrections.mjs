/// Corrects the Tier + Chain Depth attributes on minted FAX CHAIN tokens whose
/// metadata was written while their tray document carried a reroute-inflated
/// depth (fixed worker-side in workers/nftmail-email-worker reroute handling;
/// worker KV repaired 2026-11-09), plus token #1 per operator declaration.
///
/// Fetches each token's currently-pinned JSON, rewrites ONLY the `Tier` and
/// `Chain Depth` attributes, re-pins to Pinata, and prints setTokenURI calldata
/// + a map file for scripts/apply-settokenuri.mjs. It never sends transactions.
///
/// Usage:
///   node scripts/repin-tier-corrections.mjs           # dry run, no pinning
///   node scripts/repin-tier-corrections.mjs --commit  # pin corrected metadata
///
/// Env: PINATA_JWT (or .env.local), BASE_RPC optional.

import { readFileSync } from 'fs';

const COMMIT = process.argv.includes('--commit');
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const CONTRACT = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
const PINATA_JWT = process.env.PINATA_JWT
  || (() => { try { return readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^PINATA_JWT=(.+)$/m)?.[1]?.trim() ?? ''; } catch { return ''; } })();
const TOKEN_URI_SELECTOR = '0xc87b56dd';
/// keccak256("setTokenURI(uint256,string)")[0:4]
const SET_TOKEN_URI_SELECTOR = '0x162094c4';

/// tokenId -> { tier, depth } after the worker-side reroute repair.
/// depth here is the metadata "Chain Depth" attribute = forward hops,
/// i.e. worker chainDepth - 1.
const CORRECTIONS = {
  1:  { tier: 'Dial Tone', depth: 1 }, // operator declaration: token #1 is hop 1
  8:  { tier: 'Hop 2',     depth: 2 }, // tray b5886bc11c08 repaired d4 -> d3
  22: { tier: 'Hop 5',     depth: 5 }, // tray d01a3a84f6b5 repaired d7 -> d6
  35: { tier: 'Hop 2',     depth: 2 }, // tray 54be96d37bbd restored d3 — forwarded a decayed reroute-inflated doc
  36: { tier: 'Hop 5',     depth: 5 }, // tray 11e70eb05c1e repaired d7 -> d6
  50: { tier: 'Hop 2',     depth: 2 }, // tray 08c83e9c5947 repaired d4 -> d3
};

const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function decodeAbiString(hex) {
  const body = hex.slice(2);
  const len = parseInt(body.slice(64, 128), 16);
  return Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8');
}

function encodeSetTokenURI(tokenId, uri) {
  const bytes = Buffer.from(uri, 'utf8');
  const padded = Math.ceil(bytes.length / 32) * 32;
  return SET_TOKEN_URI_SELECTOR
    + encodeUint256(tokenId)
    + encodeUint256(64)
    + encodeUint256(bytes.length)
    + bytes.toString('hex').padEnd(padded * 2, '0');
}

async function fetchJsonFromIpfs(cid) {
  let lastErr;
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(gw + cid, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { lastErr = new Error(`${gw} -> HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (cause) { lastErr = cause; }
  }
  throw new Error(`all gateways failed for ${cid}: ${lastErr?.message ?? lastErr}`);
}

async function pinJSON(obj, name) {
  if (!PINATA_JWT) throw new Error('PINATA_JWT is not set');
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PINATA_JWT}` },
    body: JSON.stringify({ pinataMetadata: { name }, pinataContent: obj }),
  });
  if (!res.ok) throw new Error(`pin failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.IpfsHash) throw new Error('pin response had no IpfsHash');
  return `ipfs://${json.IpfsHash}`;
}

async function main() {
  console.log(COMMIT ? 'MODE: COMMIT (will pin to Pinata)\n' : 'MODE: DRY RUN (no pinning)\n');
  const results = [];

  for (const [tokenIdStr, want] of Object.entries(CORRECTIONS)) {
    const tokenId = Number(tokenIdStr);
    try {
      const uriRaw = await rpc('eth_call', [
        { to: CONTRACT, data: TOKEN_URI_SELECTOR + encodeUint256(tokenId) }, 'latest',
      ]);
      const currentUri = decodeAbiString(uriRaw);
      if (!currentUri.startsWith('ipfs://')) {
        console.log(`#${tokenId}: SKIP — not an IPFS URI (${currentUri})`);
        continue;
      }
      const meta = await fetchJsonFromIpfs(currentUri.slice('ipfs://'.length));
      const attrs = meta.attributes ?? [];
      const curTier = attrs.find((a) => a.trait_type === 'Tier')?.value;
      const curDepth = attrs.find((a) => a.trait_type === 'Chain Depth')?.value;

      if (curTier === want.tier && Number(curDepth) === want.depth) {
        console.log(`#${tokenId}: OK — already ${want.tier} / depth ${want.depth}`);
        continue;
      }

      console.log(`#${tokenId}: Tier "${curTier}" -> "${want.tier}", depth ${curDepth} -> ${want.depth}`);
      console.log(`     old: ${currentUri}`);

      const updated = {
        ...meta,
        attributes: attrs.map((a) => {
          if (a.trait_type === 'Tier') return { ...a, value: want.tier };
          if (a.trait_type === 'Chain Depth') return { ...a, value: want.depth };
          return a;
        }),
      };

      if (!COMMIT) {
        results.push({ tokenId, oldUri: currentUri, newUri: null });
        continue;
      }
      const newUri = await pinJSON(updated, `fax-metadata-token-${tokenId}-tierfix`);
      console.log(`     new: ${newUri}`);
      results.push({ tokenId, oldUri: currentUri, newUri, uri: newUri });
    } catch (cause) {
      console.error(`#${tokenId}: FAILED — ${cause.message}`);
      results.push({ tokenId, error: cause.message });
    }
  }

  const changed = results.filter((r) => r.newUri);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Re-pinned ${changed.length} token(s). Failures: ${results.filter((r) => r.error).length}`);

  if (changed.length) {
    console.log(`\nsetTokenURI calldata (send each to ${CONTRACT}, from the contract owner):\n`);
    const map = [];
    for (const r of changed) {
      const data = encodeSetTokenURI(r.tokenId, r.newUri);
      console.log(`# token ${r.tokenId} -> ${r.newUri}`);
      console.log(data);
      console.log();
      map.push({ tokenId: r.tokenId, uri: r.newUri, data });
    }
    const mapPath = '/tmp/tier-corrections-calldata.json';
    const { writeFileSync } = await import('fs');
    writeFileSync(mapPath, JSON.stringify(map, null, 2));
    console.log(`map written to ${mapPath} — apply with:`);
    console.log(`  node scripts/apply-settokenuri.mjs --map ${mapPath} --commit`);
  }
}

main().catch((cause) => { console.error(cause); process.exit(1); });
