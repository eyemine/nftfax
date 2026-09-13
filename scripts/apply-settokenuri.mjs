/// Applies the FAX CHAIN #N metadata backfill on-chain.
///
/// Reads the tokenId -> new IPFS URI mapping produced by
/// repin-token-names.mjs and sends one setTokenURI call per token from the
/// contract owner.
///
/// Safety properties:
///   - RESUMABLE: skips any token whose on-chain tokenURI already matches, so
///     re-running after a partial failure never redoes work.
///   - SEQUENTIAL: one tx at a time, waiting for each receipt.
///   - FAIL-FAST: stops on the first reverted/failed tx rather than pressing on.
///   - SIMULATES each call with eth_call before spending gas.
///   - Never logs the private key.
///
/// Usage:
///   node scripts/apply-settokenuri.mjs --map /tmp/calldata.json            # dry run
///   node scripts/apply-settokenuri.mjs --map /tmp/calldata.json --commit   # send
///
/// Key resolution (first match wins):
///   RELAYER_PRIVATE_KEY env var, else RELAYER_PRIVATE_KEY in .env.local

import { readFileSync } from 'fs';
import { createWalletClient, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const COMMIT = process.argv.includes('--commit');
const mapIdx = process.argv.indexOf('--map');
const MAP_PATH = mapIdx > -1 ? process.argv[mapIdx + 1] : '/tmp/calldata.json';
const CONTRACT = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const TOKEN_URI_SELECTOR = '0xc87b56dd';
/// Base is cheap, but cap anyway so a fee spike can't drain the relayer.
const MAX_FEE_GWEI = 0.5;

function loadKey() {
  if (process.env.RELAYER_PRIVATE_KEY) return normalize(process.env.RELAYER_PRIVATE_KEY);
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/^RELAYER_PRIVATE_KEY=(.+)$/m);
  if (!m) throw new Error('RELAYER_PRIVATE_KEY not found in env or .env.local');
  return normalize(m[1]);
}

function normalize(raw) {
  const pk = raw.trim().replace(/^["']|["']$/g, '');
  return pk.startsWith('0x') ? pk : `0x${pk}`;
}

function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function decodeAbiString(hex) {
  const body = hex.slice(2);
  const len = parseInt(body.slice(64, 128), 16);
  return Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/// True for transport-level failures (rate limits, timeouts, 5xx) as opposed to
/// an actual EVM revert. Conflating the two is dangerous in both directions:
/// retrying a real revert is pointless, and aborting on a 429 makes the run
/// look like a contract failure when nothing is wrong.
function isTransportError(cause) {
  const text = `${cause?.name ?? ''} ${cause?.shortMessage ?? ''} ${cause?.message ?? ''}`;
  if (/revert|execution reverted|Ownable|custom error/i.test(text)) return false;
  return /RPC Request failed|HttpRequestError|429|Too Many Requests|timeout|timed out|fetch failed|socket|ECONN|502|503|504/i.test(text);
}

/// Retries an RPC operation through transport errors with linear backoff.
/// Rethrows immediately on a genuine revert.
async function withRetry(label, fn, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (cause) {
      last = cause;
      if (!isTransportError(cause)) throw cause;
      if (i === attempts) break;
      const wait = 1500 * i;
      console.log(`    ${label}: transport error (attempt ${i}/${attempts}), retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

async function main() {
  const entries = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  const account = privateKeyToAccount(loadKey());
  const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });

  const owner = await publicClient.readContract({
    address: CONTRACT,
    abi: [{ name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
    functionName: 'owner',
  });

  console.log(`signer:   ${account.address}`);
  console.log(`owner:    ${owner}`);
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('signer is NOT the contract owner — setTokenURI would revert. Aborting.');
  }

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`balance:  ${Number(balance) / 1e18} ETH`);
  console.log(`tokens:   ${entries.length}`);
  console.log(COMMIT ? 'MODE: COMMIT — will send transactions\n' : 'MODE: DRY RUN — no transactions\n');

  let sent = 0, skipped = 0;
  for (const { tokenId, uri, data } of entries) {
    // Resumability: if the chain already has this URI, there is nothing to do.
    const currentRaw = await withRetry(`#${tokenId} read`, () => publicClient.call({
      to: CONTRACT,
      data: `${TOKEN_URI_SELECTOR}${encodeUint256(tokenId)}`,
    }));
    const current = decodeAbiString(currentRaw.data);
    if (current === uri) {
      console.log(`#${tokenId}: already set — skipping`);
      skipped++;
      await sleep(300);
      continue;
    }

    // Simulate before spending gas. Only a genuine revert is fatal.
    try {
      await withRetry(`#${tokenId} simulate`, () => publicClient.call({ account, to: CONTRACT, data }));
    } catch (cause) {
      if (isTransportError(cause)) {
        throw new Error(`#${tokenId}: RPC unreachable after retries (not a revert) — ${cause.shortMessage ?? cause.message}`);
      }
      throw new Error(`#${tokenId}: simulation REVERTED, aborting — ${cause.shortMessage ?? cause.message}`);
    }

    if (!COMMIT) {
      console.log(`#${tokenId}: would set -> ${uri}`);
      await sleep(300);
      continue;
    }

    const fees = await withRetry(`#${tokenId} fees`, () => publicClient.estimateFeesPerGas());
    const capped = fees.maxFeePerGas > BigInt(Math.floor(MAX_FEE_GWEI * 1e9))
      ? BigInt(Math.floor(MAX_FEE_GWEI * 1e9))
      : fees.maxFeePerGas;

    // Deliberately NOT retried: a resend could broadcast a second tx for the
    // same token if the first actually landed. On failure we abort; the run is
    // resumable, so a rerun picks up exactly where it stopped.
    const hash = await wallet.sendTransaction({
      to: CONTRACT,
      data,
      maxFeePerGas: capped,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const receipt = await withRetry(`#${tokenId} receipt`, () =>
      publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 }));
    if (receipt.status !== 'success') {
      throw new Error(`#${tokenId}: tx ${hash} FAILED on-chain (status=${receipt.status}). Aborting.`);
    }

    // Read back so a "success" receipt can't mask a wrong value.
    //
    // The public Base RPC is load-balanced and NOT read-after-write consistent:
    // a read issued right after a confirmed receipt can land on a node that has
    // not yet applied the block, returning the pre-write value. Poll until the
    // expected value appears before treating a mismatch as a real failure.
    let after = '';
    for (let i = 1; i <= 6; i++) {
      const afterRaw = await withRetry(`#${tokenId} verify`, () => publicClient.call({
        to: CONTRACT,
        data: `${TOKEN_URI_SELECTOR}${encodeUint256(tokenId)}`,
      }));
      after = decodeAbiString(afterRaw.data);
      if (after === uri) break;
      if (i < 6) {
        console.log(`    #${tokenId} verify: stale read (attempt ${i}/6), waiting for propagation`);
        await sleep(2000 * i);
      }
    }
    if (after !== uri) {
      throw new Error(`#${tokenId}: verify FAILED after retries — chain says ${after}, expected ${uri}. Aborting.`);
    }

    console.log(`#${tokenId}: OK  gas=${receipt.gasUsed}  ${hash}`);
    sent++;
    await sleep(700);
  }

  console.log(`\nsent: ${sent} | skipped (already set): ${skipped} | total: ${entries.length}`);
}

main().catch((cause) => {
  console.error(`\nABORTED: ${cause.message}`);
  process.exit(1);
});
