/// Backfills the `name` field on already-minted FAX CHAIN tokens.
///
/// Tokens 1-16 were pinned before the mint flow knew its own token ID, so
/// their IPFS metadata says `"name": "FAX CHAIN"` with no number. This script
/// fetches each token's currently-pinned JSON, rewrites only `name` (and the
/// `description` prefix), re-pins to Pinata, and prints the new URI.
///
/// It does NOT send transactions. It prints the `setTokenURI` calldata for
/// each token so the contract owner can execute them separately.
///
/// Usage (run where PINATA_JWT is set, e.g. inside the nftfax container):
///   node scripts/repin-token-names.mjs           # dry run, no pinning
///   node scripts/repin-token-names.mjs --commit  # actually pin
///
/// Env:
///   PINATA_JWT  — required with --commit
///   BASE_RPC    — optional, defaults to https://mainnet.base.org

const COMMIT = process.argv.includes('--commit');
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const CONTRACT = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
const PINATA_JWT = process.env.PINATA_JWT || '';
const TOKEN_URI_SELECTOR = '0xc87b56dd';
const TOTAL_MINTED_SELECTOR = '0xa2309ff8';
/// keccak256("setTokenURI(uint256,string)")[0:4]
const SET_TOKEN_URI_SELECTOR = '0x162094c4';

/// Gateways are tried in order. gateway.pinata.cloud is first and is sent the
/// JWT: this content is pinned to that account, so it resolves reliably.
/// ipfs.io / dweb.link are kept as fallbacks but routinely answer 429, which
/// is why the public-gateway-first ordering did not work.
const GATEWAYS = [
  { url: 'https://gateway.pinata.cloud/ipfs/', auth: true },
  { url: 'https://gateway.pinata.cloud/ipfs/', auth: false },
  { url: 'https://ipfs.io/ipfs/', auth: false },
  { url: 'https://dweb.link/ipfs/', auth: false },
];
const GATEWAY_ATTEMPTS = 3;
const GATEWAY_TIMEOUT_MS = 30_000;

/// Tokens whose on-chain FaxMinted trayId is the RECEIVED fax, but whose
/// artwork/provenance should reference the FORWARDED hop the player actually
/// composited. Mirrors TOKEN_TRAY_ID_OVERRIDES in the leaderboard route.
const TRAY_ID_OVERRIDES = {
  11: '6be9f54538b5',
  12: '9650d1a15f94',
  13: 'c95d23ec2ed6',
  14: '7648cedba4d2',
};

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

/// ABI-encodes setTokenURI(uint256 tokenId, string uri).
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
  for (let attempt = 0; attempt < GATEWAY_ATTEMPTS; attempt++) {
    for (const gw of GATEWAYS) {
      if (gw.auth && !PINATA_JWT) continue;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
        const res = await fetch(gw.url + cid, {
          headers: gw.auth ? { Authorization: `Bearer ${PINATA_JWT}` } : {},
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) { lastErr = new Error(`${gw.url} -> HTTP ${res.status}`); continue; }
        return await res.json();
      } catch (cause) {
        lastErr = cause;
      }
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`all gateways failed for ${cid}: ${lastErr?.message ?? lastErr}`);
}

async function pinJSON(obj, name) {
  if (!PINATA_JWT) throw new Error('PINATA_JWT is not set');
  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({ pinataMetadata: { name }, pinataContent: obj }),
  });
  if (!res.ok) throw new Error(`pin failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.IpfsHash) throw new Error('pin response had no IpfsHash');
  return `ipfs://${json.IpfsHash}`;
}

async function main() {
  const totalMinted = parseInt(await rpc('eth_call', [{ to: CONTRACT, data: TOTAL_MINTED_SELECTOR }, 'latest']), 16);
  console.log(`totalMinted = ${totalMinted}`);
  console.log(COMMIT ? 'MODE: COMMIT (will pin to Pinata)\n' : 'MODE: DRY RUN (no pinning)\n');

  const results = [];
  for (let tokenId = 1; tokenId <= totalMinted; tokenId++) {
    try {
      const uriRaw = await rpc('eth_call', [
        { to: CONTRACT, data: TOKEN_URI_SELECTOR + encodeUint256(tokenId) },
        'latest',
      ]);
      const currentUri = decodeAbiString(uriRaw);

      if (!currentUri.startsWith('ipfs://')) {
        console.log(`#${tokenId}: SKIP — not an IPFS URI (${currentUri})`);
        continue;
      }

      const meta = await fetchJsonFromIpfs(currentUri.slice('ipfs://'.length));
      const desiredName = `FAX CHAIN #${tokenId}`;

      const trayAttr = (meta.attributes ?? []).find((a) => a.trait_type === 'Fax Tray ID');
      // Only treat an override as pending if the pinned metadata does not
      // already carry it — tokens 11-14 were corrected by an earlier
      // setTokenURI pass, so re-applying would be a no-op.
      const expectedTray = TRAY_ID_OVERRIDES[tokenId];
      const override = expectedTray && trayAttr?.value !== expectedTray ? expectedTray : null;
      const trayId = trayAttr?.value ?? expectedTray ?? '';

      if (meta.name === desiredName && !override) {
        console.log(`#${tokenId}: OK — already "${meta.name}"`);
        continue;
      }

      const updated = { ...meta, name: desiredName };

      // Rewrite the description's leading "NFTFax Collectible" so it carries
      // the token number too, without disturbing the provenance tail.
      if (typeof meta.description === 'string') {
        updated.description = meta.description.replace(
          /^NFTFax Collectible(?: #\d+)?/,
          `NFTFax Collectible #${tokenId}`,
        );
      }

      if (override) {
        updated.attributes = (meta.attributes ?? []).map((a) =>
          a.trait_type === 'Fax Tray ID' ? { ...a, value: override } : a);
        updated.external_url = `https://nftmail.box/tray/${override}`;
      }

      console.log(`#${tokenId}: "${meta.name}" -> "${desiredName}"${override ? `  (tray -> ${override})` : ''}`);
      console.log(`     old: ${currentUri}`);

      if (!COMMIT) {
        results.push({ tokenId, trayId, oldUri: currentUri, newUri: null });
        continue;
      }

      const newUri = await pinJSON(updated, `fax-metadata-token-${tokenId}`);
      console.log(`     new: ${newUri}`);
      results.push({ tokenId, trayId, oldUri: currentUri, newUri });
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
    for (const r of changed) {
      console.log(`# token ${r.tokenId} -> ${r.newUri}`);
      console.log(encodeSetTokenURI(r.tokenId, r.newUri));
      console.log();
    }
    console.log('JSON summary:');
    console.log(JSON.stringify(changed, null, 2));
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
