#!/usr/bin/env node
/// Transfer NFTFaxCollectibleV2 ownership off the Blockaid-flagged deployer.
///
/// DRY-RUN BY DEFAULT. Simulates, prints the exact transaction, and exits.
/// Pass `--send` to broadcast. The contract is plain OpenZeppelin `Ownable`
/// (single-step, no acceptOwnership), so a wrong address is unrecoverable —
/// hence every guard below is an assertion, not a warning.
///
/// Reads RELAYER_PRIVATE_KEY from env or .env.local (the current owner's key).
/// Never prints the key.

import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeFunctionData, getAddress } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CONTRACT = '0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5';
const NEW_OWNER = '0xf251Ca37a80200f7AfefF398DA0338f4C1f01249'; // ghostagent.eth
const EXPECTED_CURRENT = '0x1c63c3d9d211641e15cd3af46de76b4bc84cc382';
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const ABI = [
  { type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'transferOwnership', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
];

function loadKey() {
  const normalize = (k) => (k.startsWith('0x') ? k : `0x${k}`).trim();
  if (process.env.RELAYER_PRIVATE_KEY) return normalize(process.env.RELAYER_PRIVATE_KEY);
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/^RELAYER_PRIVATE_KEY=(.+)$/m);
  if (!m) throw new Error('RELAYER_PRIVATE_KEY not found in env or .env.local');
  return normalize(m[1]);
}

/// Public Base RPC rate-limits aggressively; retry transport errors, never reverts.
async function withRetry(fn, label, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      const msg = String(e?.shortMessage || e?.message || e);
      const transport = /429|rate|timeout|fetch|ECONN|503|502/i.test(msg);
      if (!transport || i === tries - 1) throw e;
      const wait = 1500 * (i + 1);
      console.log(`  [${label}] transport error, retry in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const send = process.argv.includes('--send');
const account = privateKeyToAccount(loadKey());
const pub = createPublicClient({ chain: base, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });

console.log(send ? '\n  *** LIVE SEND ***\n' : '\n  DRY RUN — nothing will be broadcast\n');
console.log(`  contract        ${CONTRACT}`);
console.log(`  signer          ${account.address}`);
console.log(`  new owner       ${NEW_OWNER}  (ghostagent.eth)`);

// ── Guards: every one of these must hold or we stop ──────────────────────────
const currentOwner = await withRetry(() => pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'owner' }), 'owner');
console.log(`  current owner   ${currentOwner}`);

const fail = (m) => { console.error(`\n  ABORT: ${m}\n`); process.exit(1); };
if (currentOwner.toLowerCase() !== EXPECTED_CURRENT) fail(`owner() is not the expected deployer ${EXPECTED_CURRENT}`);
if (account.address.toLowerCase() !== currentOwner.toLowerCase()) fail('signer is not the current owner — transferOwnership would revert');
if (getAddress(NEW_OWNER) !== NEW_OWNER) fail('NEW_OWNER checksum mismatch — address may be mistyped');
if (NEW_OWNER.toLowerCase() === currentOwner.toLowerCase()) fail('new owner equals current owner');
if (/^0x0+$/.test(NEW_OWNER)) fail('new owner is the zero address (OZ v5 reverts, but never risk it)');

const code = await withRetry(() => pub.getBytecode({ address: NEW_OWNER }), 'code');
console.log(`  new owner type  ${code && code !== '0x' ? 'CONTRACT' : 'EOA'}`);

const balance = await withRetry(() => pub.getBalance({ address: account.address }), 'balance');
console.log(`  signer balance  ${(Number(balance) / 1e18).toFixed(6)} ETH`);

// ── Simulate ─────────────────────────────────────────────────────────────────
const data = encodeFunctionData({ abi: ABI, functionName: 'transferOwnership', args: [NEW_OWNER] });
await withRetry(() => pub.call({ account: account.address, to: CONTRACT, data }), 'simulate');
const gas = await withRetry(() => pub.estimateGas({ account: account.address, to: CONTRACT, data }), 'estimateGas');
const gasPrice = await withRetry(() => pub.getGasPrice(), 'gasPrice');
const costWei = gas * gasPrice;

console.log('\n  simulation      SUCCESS — transferOwnership would not revert');
console.log(`  calldata        ${data}`);
console.log(`  gas estimate    ${gas}  @ ${(Number(gasPrice) / 1e9).toFixed(4)} gwei  ≈ ${(Number(costWei) / 1e18).toFixed(8)} ETH`);
if (balance < costWei * 2n) fail('signer balance too low to cover gas with margin');

if (!send) {
  console.log('\n  Dry run complete. Re-run with --send to broadcast.\n');
  process.exit(0);
}

// ── Broadcast (never retried: a retry could double-send) ─────────────────────
const hash = await wallet.sendTransaction({ to: CONTRACT, data, gas });
console.log(`\n  tx sent         ${hash}`);
console.log('  waiting for receipt…');
const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 2 });
console.log(`  status          ${receipt.status}  block ${receipt.blockNumber}`);

// Read-after-write across a load-balanced RPC can lag; poll rather than trust one read.
let confirmed = false;
for (let i = 0; i < 10; i++) {
  const o = await withRetry(() => pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'owner' }), 'verify');
  if (o.toLowerCase() === NEW_OWNER.toLowerCase()) { confirmed = true; break; }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`  owner() now     ${confirmed ? NEW_OWNER + '  ✓ VERIFIED' : 'NOT YET VISIBLE — check https://basescan.org/tx/' + hash}\n`);
