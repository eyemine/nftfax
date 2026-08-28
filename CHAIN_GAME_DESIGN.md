# NFT Fax Chain Game — Design Plan: Relay Pool, Capacity, Leaderboard

## 1. Automatic Relay Address Pool

### Problem
With low adoption, chains die when a recipient doesn't forward within the timer window. The halving timer makes this worse — by hop 5+, players have only hours to act. If no one forwards, the chain is permanently jammed.

### Proposed Design

**Relay Pool Source:** The Rolofax (`telegraph:` KV entries) already has willing participants who signaled `ready: true`. This is the natural relay pool.

**Trigger:** When a fax's timer drops below 6 hours remaining AND it hasn't been forwarded, the InTray UI shows a "Suggest relay" button. This is opt-in, not automatic — we don't want to force forwards.

**Worker Action: `getRelaySuggestion`**
- Input: `chainTrayId` (to exclude existing participants)
- Reads `chainParticipants` from the source fax
- Lists all `telegraph:` entries with `ready: true`
- Filters out: existing chain participants, the current recipient, the original sender
- Returns 3 random suggestions (handle + collection) with their `ready` status
- No auto-forwarding — the player still chooses to forward manually

**Frontend (InTray.tsx):**
- When `msLeftToJam < 6h` and `!fax.forwarded`, show a "⚡ Relay pool" section in the fax detail modal
- Display 3 suggested handles as clickable buttons that pre-fill the forward-to field
- Show their community/collection badge

**Anti-abuse:**
- Rate limit: one `getRelaySuggestion` call per fax per 5 minutes
- Relay suggestions are read-only — no automatic sends
- Participants can toggle `ready: false` in the Rolofax to opt out

**Future: Auto-relay bot**
- A bun-worker cron job that checks for faxes with < 1h timer remaining, picks a relay, and auto-forwards (compositing with a placeholder image)
- Requires a dedicated bot wallet with send credits
- Higher risk — only enable if organic adoption is critically low

### Files to modify
- Worker: add `getRelaySuggestion` action
- nftmailbox-netlify: add `/api/tray/relay-suggest/route.ts` proxy
- nftfax: InTray.tsx — add relay suggestion UI in detail modal

---

## 2. Capacity Check for 1000 Concurrent Users

### Current Architecture
```
User → nginx (Hetzner) → Docker container (Next.js standalone, port 3001)
                        → bun-worker (localhost:8787, Redis-backed KV)
```

### Potential Bottlenecks

**a) Hetzner Host (root@46.225.158.75)**
- Need to check: CPU cores, RAM, disk space
- Docker container has no resource limits set
- nginx default worker_connections = 768 (may need increase)

**b) Next.js Standalone (Docker)**
- Single Node.js process, no cluster mode
- Default: ~1GB heap, handles ~100-200 concurrent requests comfortably
- 1000 concurrent users would likely need 2-3 containers behind a load balancer
- Image processing (compositeChain) is CPU-intensive and runs in-process

**c) Bun Worker (Redis KV shim)**
- Bun is single-threaded but very fast for I/O
- Redis is the bottleneck — single-threaded, but 100K+ ops/sec on modest hardware
- KV operations: each fax send = ~5 KV writes, each inbox load = ~10 KV reads
- 1000 concurrent users × 10 reads = 10,000 Redis ops — well within Redis capacity
- But: `listTrayInbox` does `KV.list()` then N× `KV.get()` — O(N) reads per inbox load. With 100 faxes per inbox, that's 100 Redis round-trips. Need to optimize with Redis MGET or pipeline.

**d) Network Bandwidth**
- Fax images are ~2MB base64. 1000 concurrent sends = 2GB burst
- Hetzner has 1Gbit/s = ~125MB/s. 2GB would take ~16 seconds to drain
- Acceptable for a burst, but sustained high traffic would throttle

**e) nginx Config**
- Need to verify: `worker_connections`, `worker_processes`, `keepalive_timeout`
- Should add: `proxy_buffering on`, gzip for API JSON responses
- Rate limiting: `limit_req_zone` to prevent abuse

### Recommended Actions
1. **Check host specs:** `nproc`, `free -h`, `df -h` on Hetzner
2. **Add Docker resource limits:** `mem_limit: 2g` in docker-compose.yml
3. **Scale nginx:** `worker_processes auto`, `worker_connections 4096`
4. **Optimize listTrayInbox:** Use Redis MGET/pipeline instead of N×GET
5. **Add rate limiting:** nginx `limit_req_zone` for `/api/tray/send` (10 req/min per IP)
6. **Consider horizontal scaling:** If 500+ concurrent, spin up a second Docker container and use nginx upstream load balancing
7. **CDN:** Move fax image rendering to a CDN edge (Cloudflare) to offload from origin

### Files to modify
- `/opt/nftmail/docker-compose.yml` — add resource limits
- nginx config — tuning
- Worker: optimize `listTrayInbox` with batched reads

---

## 3. Chain Game Leaderboard

### Metrics to Track

| Metric | Description | KV Key |
|--------|-------------|--------|
| Longest chain | Max `chainDepth` ever achieved | `leader:longest-chain` |
| Most forwards | Player with most `markTrayForwarded` calls | `leader:forwards:{wallet}` |
| Most mints | Player with most `markTrayMinted` calls | `leader:mints:{wallet}` |
| Deepest halving | Lowest `chainTimerDuration` that was still forwarded | `leader:deepest-halving` |
| Most chains started | Player who initiated the most root chains | `leader:chains-started:{wallet}` |
| Total faxes sent | Global counter | `leader:total-sent` |

### Worker Actions

**`updateLeaderboard`** (internal, called by `setTrayDocument` and `markTrayForwarded`):
- On `setTrayDocument`: increment `leader:total-sent`, increment `leader:chains-started:{from}`, update `leader:longest-chain` if `chainDepth` is new max
- On `markTrayForwarded`: increment `leader:forwards:{wallet}`
- On `markTrayMinted`: increment `leader:mints:{wallet}`

**`getLeaderboard`** (public):
- Input: `metric` (optional: 'longest-chain', 'forwards', 'mints', 'deepest-halving')
- Returns top 10 entries for each metric
- For per-wallet metrics, scan `leader:forwards:*` keys, sort by count

### Frontend (nftfax)

**New page: `/leaderboard`**
- Office-core aesthetic, fax-machine styled table
- Tabs: Chain Length | Most Forwards | Most Mints | Deepest Halving
- Each tab shows top 10 players with their handle, wallet (truncated), and score
- Highlight current player's rank if they're logged in
- Auto-refresh every 60 seconds

### Anti-gaming
- Forward counts only credit when the forward goes to a unique participant (enforced by anti-loop)
- Mint counts are naturally capped at 2222
- Chain length is verifiable on-chain (chainDepth stored in tray record)
- Sybil resistance: requires NFT ownership to send faxes (existing eligibility gate)

### Files to create/modify
- Worker: add `updateLeaderboard` logic in `setTrayDocument`/`markTrayForwarded`/`markTrayMinted`, add `getLeaderboard` action
- nftmailbox-netlify: add `/api/tray/leaderboard/route.ts` proxy
- nftfax: create `/app/leaderboard/page.tsx`, add link from main page and about page
