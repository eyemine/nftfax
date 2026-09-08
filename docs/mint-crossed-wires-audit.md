# Mint "Crossed Wires" Audit — Tokens 1-10

**CORRECTED 2026-09-07** — the original version of this doc got the root
cause backwards. See "Root cause (corrected)" below before reading the
findings table.

Cross-referenced three independent data sources for each minted token:
1. **On-chain `FaxMinted` event** (Base contract `0xcC121BF9E3a13d03EACd55E15495e3E8De61fac5`) — the `trayId` string embedded in the mint transaction's calldata at the time of minting. Immutable, but only ever reflects the fax the minter **received** (`act()`'s mint path resolves `targetId` via `fax.sourceTrayId || fax.id`, i.e. the tray *before* the minter's own forward).
2. **Pinned IPFS metadata** (`tokenURI` → IPFS JSON `attributes[].trait_type == "Fax Tray ID"`) — set once at mint time via Lighthouse pin, immutable. This is the **correct, real identity of the minted fax** — it references the tray the minter actually forwarded onward (created by their own `forward()` call), which is the artwork/provenance they intended to mint.
3. **Off-chain worker KV** (`/opt/ghostagent/bun-worker/data/nftmail.db`, keys `tray:{id}`, `tray-mint:base:{id}`, `tray-in:{local}:{id}`, `tray-out:{local}:{id}`) — mutable, backs the live Fax-Tray/Sent-Tray/Leaderboard UI. Decays after 8 days unless permanently pinned.

## Root cause (corrected)

The original version of this doc treated the **on-chain event's trayId as ground truth** and flagged every pinned-metadata mismatch as a bug to fix by re-pinning + `setTokenURI`. That was backwards: confirmed against the owner's actual chain-of-custody records (`@/Users/richieogorman/CascadeProjects/nftfax/app/components/InTray.tsx` `forward()`), the **pinned IPFS metadata is the correct trayId** for every token checked. The bug is in `forward()`: it pinned metadata using `data.id` (the newly-created next-hop tray, i.e. the fax the minter just forwarded) while the on-chain mint calldata's `trayId` argument came from `act()`'s `targetId` (the fax the minter *received*, before their forward). Both values get embedded permanently — one on IPFS, one on-chain — and they will never agree for any fax where the minter forwarded before minting from the Sent tab. **The pinned metadata is correct; the on-chain event's trayId is the "received" tray, not the minted one.**

The actual operational problem this caused: the tray referenced by the pinned metadata is an ordinary fax subject to the normal 8-day KV decay, so once it expired, the token's `external_url` / sent-tray listing broke ("Fax expired") even though the NFT itself and its IPFS metadata were always fine. The fix (already applied to `InTray.tsx` this session) makes `forward()` pin `fax.id` instead of `data.id`, so pinned metadata will match the on-chain trayId going forward — but this is a **client-side fix for future mints only**; it does not change already-minted tokens' immutable metadata, and does not need to (the metadata was already correct for those, per above).

Historical tokens' pinned/on-chain trayId only matched when the minter minted directly from their Inbox (not the Sent tab / not after forwarding first) — e.g. tokens 6 and 8.

## Findings (corrected)

| Token | Minter | On-chain trayId (received fax) | Pinned IPFS "Fax Tray ID" (correct, minted fax) | KV status before this session's fix | Status |
|---|---|---|---|---|---|
| 1 | atom.3614 | `c82d62a94ce6` | not yet checked | `tray-mint:base:82cc17b00565` KV record is unrelated/orphaned — needs separate investigation, not the same pattern as below | ⚠️ unverified |
| 2 | chonk.585 | `5daa85fa5d47` | `6e14680cd7be` (chonk.585 → atom.2477) | fully decayed | ✅ reconstructed permanently in KV |
| 3 | atom.2477 | `64b3c3d034ed` | `f4085910ec1d` | still alive in KV | ✅ no action needed |
| 4 | atom.2 | `f4085910ec1d` | `82cc17b00565` | still alive in KV | ✅ no action needed (do **not** delete `tray-mint:base:82cc17b00565` — it may be this token's legitimate mint record) |
| 5 | atom.648 | `ed1a8745649f` | `e0f5a98ab662` (atom.648 → chonk.9534) | fully decayed | ✅ reconstructed permanently in KV |
| 6 | chonk.700 | `7b82ecd8e8b6` | `7b82ecd8e8b6` | alive | ✅ clean (minted directly from Inbox, no forward-then-mint) |
| 7 | atom.1083 | `7afab639d5ca` | `ad2ed3cfa337` (atom.1083 → chonk.681) | fully decayed | ✅ reconstructed permanently in KV |
| 8 | atom.2112 | `b5886bc11c08` | `b5886bc11c08` | alive | ✅ clean (minted directly from Inbox) |
| 9 | dfz.5415 | `92bec0e4dda2` | `e3f90a4e9926` (dfz.5415 → atom.4253) | `tray:e3f90a4e9926` doc was alive but missing its `tray-out`/`tray-in` index entries | ✅ indexes added |
| 10 | chonk.9534 | `7e0f0e533cb2` | `e90a0e7fab91` (chonk.9534 → atom.137) | fully decayed | ✅ reconstructed permanently in KV |

## Remaining open item

- Token 1's KV mint record (`tray-mint:base:82cc17b00565`) needs the same cross-check as tokens 2/5/7/9/10 before concluding anything — do not assume it's orphaned/bogus without first checking token 1's actual pinned IPFS metadata and on-chain event.
