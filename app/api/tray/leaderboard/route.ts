/// Reads totalMinted() from the V2 contract on Base. Scans FaxMinted events
/// to build the per-collection leaderboard, then enriches each mint with the
/// fax's real chain depth (tier) from the worker's tray KV — the contract
/// event only carries the source NFT's tokenId, which is NOT the chain depth.

import { NextRequest, NextResponse } from 'next/server';
import { BASE_FAX_COLLECTIBLE, BASE_CHAIN } from '../../../lib/contracts';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const RPC_URL = BASE_CHAIN.rpcUrl;
const CONTRACT = BASE_FAX_COLLECTIBLE;
const FAX_MINTED_TOPIC = '0x20a7befda21edb48bdea9b5c9be274f9329f49476f8e64469506e5629bcb0e5c';
const DEPLOY_BLOCK = 50375000;
const CHUNK_SIZE = 10_000;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://worker.nftmail.box';

const COMMUNITY_NAMES: Record<number, string> = {
  0: 'none', 1: 'chonk', 2: 'deadfellaz', 3: 'pow', 4: 'normie',
};

const COMMUNITY_PREFIXES: Record<number, string> = {
  1: 'chonk', 2: 'dfz', 3: 'atom', 4: 'normie',
};

interface RpcLog { topics: string[]; data: string; blockNumber: string; transactionHash: string; }
interface MintEntry { tokenId: number; minter: string; community: number; sourceTokenId: number; trayId: string; chainDepth?: number; }
interface LeaderboardEntry { collection: string; mints: number; maxTokenId: number; communities: number; }
interface LeaderboardData { leaderboard: LeaderboardEntry[]; totalMints: number; contractBalanceEth: string; mints: MintEntry[]; }

async function fetchChainDepth(trayId: string): Promise<number | undefined> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getTrayDocument', id: trayId }),
    });
    if (!res.ok) return undefined;
    const doc = await res.json().catch(() => null) as { chainDepth?: number } | null;
    return typeof doc?.chainDepth === 'number' ? doc.chainDepth : undefined;
  } catch {
    return undefined;
  }
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown };
  return json.result;
}

async function getTotalMinted(): Promise<number> {
  try {
    const result = await rpc('eth_call', [{ to: CONTRACT, data: '0xa2309ff8' }, 'latest']);
    if (typeof result === 'string') return parseInt(result, 16);
  } catch { /* ignore */ }
  return 0;
}

async function getCurrentBlock(): Promise<number> {
  try {
    const result = await rpc('eth_blockNumber', []);
    if (typeof result === 'string') return parseInt(result, 16);
  } catch { /* ignore */ }
  return 0;
}

async function fetchFaxMintedLogs(): Promise<RpcLog[]> {
  const currentBlock = await getCurrentBlock();
  if (currentBlock === 0) return [];
  const allLogs: RpcLog[] = [];
  const chunks: Promise<unknown>[] = [];
  for (let from = DEPLOY_BLOCK; from <= currentBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, currentBlock);
    chunks.push(rpc('eth_getLogs', [{
      address: CONTRACT,
      topics: [FAX_MINTED_TOPIC],
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
    }]));
  }
  const results = await Promise.all(chunks);
  for (const result of results) {
    if (Array.isArray(result)) allLogs.push(...(result as RpcLog[]));
  }
  return allLogs;
}

function decodeLog(log: RpcLog): MintEntry {
  const tokenId = parseInt(log.topics[1] ?? '0x0', 16);
  const minter = '0x' + (log.topics[2] ?? '').slice(26).toLowerCase();
  const data = log.data.slice(2);
  const community = parseInt(data.slice(0, 64), 16);
  const sourceTokenId = parseInt(data.slice(64, 128), 16);
  // trayId is a dynamic string: offset (word 3), length, then UTF-8 bytes
  const stringOffset = parseInt(data.slice(128, 192), 16) * 2; // in hex chars
  const stringLen = parseInt(data.slice(stringOffset, stringOffset + 64), 16);
  const trayIdHex = data.slice(stringOffset + 64, stringOffset + 64 + stringLen * 2);
  const trayId = Buffer.from(trayIdHex, 'hex').toString('utf8');
  return { tokenId, minter, community, sourceTokenId, trayId };
}

async function getContractBalanceEth(): Promise<string> {
  try {
    const result = await rpc('eth_getBalance', [CONTRACT, 'latest']);
    if (typeof result === 'string') {
      const wei = BigInt(result);
      const eth = Number(wei) / 1e18;
      return eth.toFixed(4);
    }
  } catch { /* ignore */ }
  return '0';
}

export async function GET(_req: NextRequest) {
  try {
    const [totalMints, contractBalanceEth] = await Promise.all([getTotalMinted(), getContractBalanceEth()]);
    if (totalMints === 0) {
      return NextResponse.json({ leaderboard: [], totalMints: 0, contractBalanceEth, mints: [] } as LeaderboardData, { headers: NO_STORE });
    }

    const logs = await fetchFaxMintedLogs();
    const allMints: MintEntry[] = [];
    const byCollection = new Map<string, { mints: number; maxTokenId: number; communities: Set<number> }>();

    for (const log of logs) {
      const mint = decodeLog(log);
      allMints.push(mint);
      const name = COMMUNITY_NAMES[mint.community] ?? 'unknown';
      const entry = byCollection.get(name) ?? { mints: 0, maxTokenId: 0, communities: new Set<number>() };
      entry.mints++;
      entry.maxTokenId = Math.max(entry.maxTokenId, mint.tokenId);
      entry.communities.add(mint.community);
      byCollection.set(name, entry);
    }

    const leaderboard: LeaderboardEntry[] = Array.from(byCollection.entries())
      .map(([collection, e]) => ({ collection, mints: e.mints, maxTokenId: e.maxTokenId, communities: e.communities.size }))
      .sort((a, b) => b.mints - a.mints);

    const uniqueTrayIds = Array.from(new Set(allMints.map((m) => m.trayId).filter(Boolean)));
    const depths = await Promise.all(uniqueTrayIds.map((id) => fetchChainDepth(id)));
    const depthByTrayId = new Map(uniqueTrayIds.map((id, i) => [id, depths[i]]));
    for (const mint of allMints) {
      mint.chainDepth = depthByTrayId.get(mint.trayId);
    }

    return NextResponse.json({ leaderboard, totalMints, contractBalanceEth, mints: allMints } as LeaderboardData, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Leaderboard lookup failed' }, { status: 502, headers: NO_STORE });
  }
}
