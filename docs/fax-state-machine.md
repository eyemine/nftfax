# Fax Chain State Machine

## States: SENT -> RECEIVED -> FORWARDED -> MINTED/SAVED | REROUTED

## KV State Flags
- `tray-fwd:{id}` forwarded | `tray-mint:base:{id}` minted | `tray-saved:gnosis:{id}` saved | `tray-rerouted:{id}` rerouted

## Lineage Fields (immutable)
- `id` `sourceTrayId` `rootTrayId` `chainDepth` `chainTimerDuration`

## KV Keys
- `tray:{id}` doc (TTL 96h) | `tray-in:{local}:{id}` inbox | `tray-out:{local}:{id}` outbox

## Handovers
1. Send: app -> /api/tray/send -> worker setTrayDocument (fail-closed on missing parent)
2. Mint: app -> /api/tray/[id]/mint -> worker markTrayMinted (requires forwarded, getChainRoot for per-chain gate)
3. Save: app -> /api/tray/[id]/save -> worker saveTrayDocument (removes TTL)
4. Reroute: app -> /api/tray/[id]/reroute -> worker markRerouted (after 24h)

## Source of Truth: Hetzner KV (SQLite kv table) via worker.nftmail.box
