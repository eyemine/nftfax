# Mint "Crossed Wires" Audit — Tokens 1-10

Cross-referenced three independent data sources for each minted token:
1. **On-chain `FaxMinted` event** (Base contract `0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5`) — the `trayId` string embedded in the mint transaction's calldata at the time of minting. This is immutable and reflects exactly what the client sent as the mint target historically.
2. **Pinned IPFS metadata** (`tokenURI` → IPFS JSON `attributes[].trait_type == "Fax Tray ID"`) — set once at mint time via Lighthouse pin, immutable.
3. **Off-chain worker KV** (`/opt/ghostagent/bun-worker/data/nftmail.db`, keys `tray:{id}`, `tray-mint:base:{id}`, `tray-in:{local}:{id}`) — mutable, backs the live Fax-Tray/Sent-Tray/Leaderboard UI.

## Root cause

The client historically resolved the mint target (`targetId`) independently for (a) the on-chain mint tx and (b) the IPFS metadata pin, and a **third, separate resolution** for (c) the KV `markTrayMinted` POST — all sourced from the same nominal `fax` object in `InTray.tsx`, but at different points before a fix (see the comment in `InTray.tsx`: "Mint and Save both act on the fax the CALLER received, not the one they forwarded onward"). Additionally, the client fires the KV `markTrayMinted` POST **immediately after receiving a `txHash`, without waiting for on-chain confirmation** — so a reverted/retried transaction still leaves a KV record behind, and a later successful retry (possibly against a different `trayId`) never gets its own KV record.

This explains why the earliest mints (tokens 1-5, 7) show mismatches and later ones (6, 8) are clean — the client-side fix landed sometime between these mints.

## Findings

| Token | Minter | On-chain trayId | KV "minted tray" (what the UI shows) | Pinned IPFS "Fax Tray ID" | Status |
|---|---|---|---|---|---|
| 1 | atom.3614 | `c82d62a94ce6` | **`82cc17b00565`** (wrong — belongs to a different, never-actually-minted fax; its KV mint record has a bogus tx hash not among the 10 real `FaxMinted` txs) | — (not yet checked) | ❌ KV mismatch |
| 2 | chonk.585 | `5daa85fa5d47` | `5daa85fa5d47` (correct) | **`6e14680cd7`** (does not exist in KV at all — phantom ID) | ❌ Metadata mismatch |
| 3 | atom.2477 | `64b3c3d034ed` | `64b3c3d034ed` (correct) | **`f4085910ec1d`** (this is actually token 4's on-chain trayId) | ❌ Metadata mismatch |
| 4 | atom.2 | `f4085910ec1d` | **`5daa85fa5d47`** (wrong — this is token 2's trayId, from atom.648→chonk.585, unrelated to atom.2) | `82cc17b00565` (the same phantom-minted trayId implicated in token 1) | ❌ KV + metadata mismatch |
| 5 | atom.648 | `ed1a8745649f` | `ed1a8745649f` (correct) | **`e0f5a98ab662`** (does not match) | ❌ Metadata mismatch |
| 6 | chonk.700 | `7b82ecd8e8b6` | `7b82ecd8e8b6` (correct) | `7b82ecd8e8b6` (correct) | ✅ Clean |
| 7 | atom.1083 | `7afab639d5ca` | `7afab639d5ca` (correct) | **`ad2ed3cfa337`** (does not match) | ❌ Metadata mismatch |
| 8 | atom.2112 | `b5886bc11c08` | `b5886bc11c08` (correct) | `b5886bc11c08` (correct) | ✅ Clean |
| 9 | dfz.5415 | `92bec0e4dda2` | `92bec0e4dda2` (correct) | not reachable (IPFS pin unpinned/gone from public gateways) | ⚠️ unverified |
| 10 | chonk.9534 | `7e0f0e533cb2` | `7e0f0e533cb2` (correct) | not reachable (gateway timeouts) | ⚠️ unverified |

## Key takeaway

- **KV "minted tray" display bug** (what users see in Fax-Tray/Sent-Tray on nftmail.box/nftfax.app) only affects **tokens 1 and 4** — both are historical, pre-dating a client-side fix. Tokens 5-10 all show the *correct* trayId in the live UI.
- **Pinned IPFS metadata mismatch** (what OpenSea shows) is far more widespread — tokens 2, 3, 4, 5, 7 all have a "Fax Tray ID" trait that doesn't match the real on-chain trayId. This is a **separate, earlier-stage bug** in the metadata-pinning step, independent of the KV bug.
- Since IPFS content is immutable, fixing OpenSea display requires re-pinning corrected JSON and calling the contract owner-only `setTokenURI(tokenId, newURI)` for each affected token — this requires the contract owner's wallet signature and has not been done.
- The orphaned KV record `tray-mint:base:82cc17b00565` (implicated in both token 1 and token 4's confusion) should be deleted — it does not correspond to any real on-chain mint.

## Not yet fixed

- KV correction for tokens 1 and 4's minted-tray display (safe SQLite `UPDATE`/`INSERT`/`DELETE` on `/opt/ghostagent/bun-worker/data/nftmail.db`, no wallet needed).
- Re-pinning + `setTokenURI` for tokens 2, 3, 4, 5, 7 (and 9, 10 pending verification) — requires contract owner wallet signature.
