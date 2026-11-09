// bytes32 digest -> CIDv0 (multihash = 0x1220 || sha256digest, base58btc)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function bytes32ToCid(hex) {
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(34);
  bytes[0] = 0x12; bytes[1] = 0x20;
  for (let i = 0; i < 32; i++) bytes[2 + i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);

  // base58btc encode
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const byte of bytes) { if (byte === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export const GATEWAYS = [
  'https://ipfs.decenter.com/ipfs',
  'https://gateway.pinata.cloud/ipfs',
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
];

// CIDv0 hashes the UnixFS DAG root, NOT the raw file — a multi-chunk PNG's
// sha256 can never match its CID. Rebuild the DAG with the importer (go-ipfs
// defaults: 256KB chunks, no raw leaves) and compare the resulting CIDv0.
import { importer } from 'ipfs-unixfs-importer';
import { MemoryBlockstore } from 'blockstore-core/memory';

export async function verifyCid(buf, cid) {
  const store = new MemoryBlockstore();
  let root = null;
  for await (const e of importer([{ content: buf }], store, { cidVersion: 0, rawLeaves: false })) {
    root = e;
  }
  return root?.cid.toString() === cid;
}

export async function fetchIpfs(cid, { timeoutMs = 20000 } = {}) {
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(`${gw}/${cid}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (await verifyCid(buf, cid)) return buf; // wrong bytes = wrong content, try next gateway
    } catch { /* try next gateway */ }
  }
  return null;
}

// Pinata pin-by-hash (content must be reachable on the IPFS network)
export async function pinByHash(cid, name) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');
  const res = await fetch('https://api.pinata.cloud/pinning/pinByHash', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashToPin: cid, pinataMetadata: { name } }),
  });
  if (!res.ok) throw new Error(`pinByHash ${cid}: ${res.status} ${await res.text()}`);
}

// Upload a local buffer — guarantees the pin even if the old pin is already gone.
// Same content => same CIDv0, so the original hash stays valid.
export async function pinFile(buf, cid, name, retries = 4) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');
  for (let attempt = 0; attempt <= retries; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([buf]), cid);
    form.append('pinataMetadata', JSON.stringify({ name: name || cid }));
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (res.ok) return (await res.json()).IpfsHash;
    if (res.status === 429 && attempt < retries) {
      await new Promise(r => setTimeout(r, 8000 * (attempt + 1))); // back off: 8s,16s,24s,32s
      continue;
    }
    throw new Error(`pinFile ${cid}: ${res.status} ${await res.text()}`);
  }
}

// All CIDs currently pinned on this Pinata account (paginated).
export async function listPinned() {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');
  const out = new Set();
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1000&pageOffset=${offset}`,
      { headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) throw new Error(`pinList: ${res.status}`);
    const page = await res.json();
    for (const row of page.rows || []) out.add(row.ipfs_pin_hash);
    if ((page.rows || []).length < 1000) break;
    offset += 1000;
  }
  return out;
}
