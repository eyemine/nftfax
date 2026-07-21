# Fax Chain Letter — Full Spec Roadmap & Phase 1 Implementation Plan

This plan ingests the refined Fax Chain Letter specification, saves it as a design document in the nftfax repo, and provides a detailed Phase 1 implementation plan with high-level outlines for subsequent phases.

---

## Deliverable 1: Spec Document

Create `docs/SPEC.md` in the nftfax repo containing the full refined specification (all 9 sections). This is the canonical reference document. No code changes — just the formatted spec.

---

## Phase 1: Fax Game Core (Detailed)

**Goal:** Transform the existing nftfax office-core app from a simple send/receive fax tool into the chain-letter game with 72h thermal fade, credit economy, @fax addressing, full-page fax view, and blank-fax-after-jam behavior.

**Repos modified:** nftfax (frontend), nftmailbox-netlify (backend API routes), Hetzner worker (KV store actions)

### 1.1 — @fax Address Support

**nftfax frontend** (`app/page.tsx`, `app/components/InTray.tsx`):
- Add address suffix selector: `@fax` (free, NFT-gated) vs `@nftmail.box` (existing premium)
- When `@fax` is selected, the mailbox input becomes a prefix.tokenId pattern (e.g. `dfz.1234`)
- The `@fax` suffix is an internal protocol namespace — no DNS, no SMTP. It routes through the same ECIES queue on Gnosis
- Sending to `@fax` addresses: the recipient field accepts `{prefix}.{tokenId}@fax`
- The existing `@nftmail.box` flow remains unchanged

**nftmailbox-netlify backend** (`app/api/tray/send/route.ts`):
- Accept `@fax` suffix in `to` field. Strip suffix, route to worker with `channel: 'public'` flag
- `@fax` faxes are public canvases — no encryption, no private metadata
- `@nftmail.box` faxes remain private (existing behavior)

**Hetzner worker** (`index.ts`):
- Store `@fax` tray documents with `channel: 'public'` in KV
- `getTrayDocument` for public faxes does NOT require `WEBHOOK_SECRET` — anyone can view a public fax
- Public faxes are retrievable by ID without authentication

### 1.2 — 72-Hour Thermal Fade

**nftfax frontend** (`app/components/InTray.tsx`):
- Change `DECAY_MS` from `8 * 24 * 60 * 60 * 1000` to a two-phase system:
  - `JAM_MS = 72 * 60 * 60 * 1000` (72 hours — forwarding disabled)
  - `DECAY_MS = 8 * 24 * 60 * 60 * 1000` (8 days — card removed from inbox)
- Update `contrastForElapsed()`:
  - 0–24h: contrast 1.0 (crisp)
  - 24–72h: contrast degrades 0.7 → 0.4 (linear interpolation)
  - 72h+: contrast 0.1 (nearly illegible)
- Update `formatCountdown()`:
  - Before 72h: show time remaining as "Xd Yh left"
  - After 72h: show "LINE JAMMED"
- Forward button: disabled when `elapsed > JAM_MS` and fax not yet forwarded
- After 72h (jammed): replace fax bitmap display with a blank white image. The card still shows `From: {sender}` so the user can initiate a new chain with that sender. Card remains in inbox until 8-day total decay removes it.

**nftfax frontend** — `FaxThumb` component changes:
- Add `jammed` prop. When `jammed === true`, render a white placeholder instead of fetching/displaying the fax image
- The card metadata (from, chain depth, link badge) remains visible
- The card subtitle shows "LINE JAMMED — start a new chain with {from}"

### 1.3 — Credit Economy

**nftmailbox-netlify backend** (new: `app/api/tray/credits/route.ts`):
- `GET`: Return credit balance for `{local, wallet}` pair. Worker stores `credits:{address}` in KV
- `POST`: Increment credits (called after successful forward) or reset credits (called after clearJam)

**Hetzner worker** (`index.ts`):
- New action `getCredits`: read `credits:{address}` from KV, default to 2 for new @fax identities
- New action `setCredits`: set `credits:{address}` in KV
- On `sendTray` with `channel: 'public'` and `chainTrayId` (forward): increment sender's credits by 1
- On `sendTray` when 72h has elapsed since receipt (should be blocked by frontend, but backend enforces too): reject with "LINE JAMMED"
- New action `clearJam`: reset credits to 1, un-jam the address

**nftfax frontend** (`app/components/InTray.tsx`):
- Display credit balance in the In-Tray header (e.g. "Send credits: 3")
- Disable send button when credits === 0
- After successful forward, show "+1 credit" notice
- After LINE JAMMED, show "Clear Jam" button (calls clearJam endpoint)

### 1.4 — Full-Page Fax View

**nftfax frontend** (new: `app/tray/[id]/page.tsx`):
- Public route accessible at `fax.nftmail.box/tray/{id}`
- Fetches fax data from `/api/tray/{id}` (proxied to nftmail.box backend)
- Renders the fax image full-page in the office-core aesthetic (paper background, machine-shadow frame, header bar with fax ID)
- Shows metadata: from, received date, chain depth, chain link number
- "Open in NFTfax" button links back to the main app with the fax selected
- If fax is @nftmail.box (private), show "This transmission is private" placeholder
- If fax not found, show "Transmission not found" in office-core style
- This page is shareable — the URL is the canonical reference for a fax

### 1.5 — Save to Gnosis (Unlock After Forward)

**nftfax frontend** (`app/components/InTray.tsx`):
- Save button is currently always enabled. Change to: disabled until fax is forwarded
- After successful forward, Save button becomes active
- Tooltip on disabled state: "Forward this fax to unlock permanence"
- Existing mint/save logic in `contracts.ts` remains (placeholder addresses)

### 1.6 — Telegraph Log (Basic)

**nftfax frontend** (new: `app/telegraph/page.tsx`):
- Simple leaderboard page at `fax.nftmail.box/telegraph`
- Fetches chain data from a new API endpoint
- Displays: longest active chains, most hops, identity diversity (unique communities bridged)
- Office-core styled table/list
- Phase 1 is read-only — no bounties or DAO features yet

**nftmailbox-netlify backend** (new: `app/api/tray/telegraph/route.ts`):
- `GET`: Query worker for chain statistics. Aggregate from tray documents with `channel: 'public'`
- Return: top chains by depth, unique sender count, velocity (hops per 24h window)

**Hetzner worker** (`index.ts`):
- New action `getTelegraphLog`: scan `tray:*` keys with `channel: 'public'`, aggregate chain depth and sender diversity
- Return sorted by chain depth descending, limit 50

---

## Phase 2: SIWE + NFT Binding (Outlined)

**Goal:** Replace the current Privy/wallet-connect auth with SIWE (EIP-4361) + NFT ownership verification.

- **SIWE login flow**: Server issues challenge, user signs, server verifies signature
- **NFT ownerOf() check**: Query Ethereum NFT contracts for token ownership
- **Community prefix registry**: Config-driven mapping of `{prefix → contractAddress, chain}`
- **Multi-token dropdown**: Hot-swap between identities within same wallet session
- **Send-time re-check**: Reject if NFT sold mid-session
- **@fax identity derivation**: `dfz.1234@fax` from `keccak256(prefix, tokenId)`
- **@nftmail.box reservation**: Reserve premium address at first @fax registration

**Files touched:**
- nftfax: `app/page.tsx`, new `app/lib/siwe.ts`, new `app/lib/nft-verify.ts`, new `app/api/siwe/challenge/route.ts`, new `app/api/siwe/verify/route.ts`
- nftmailbox-netlify: new `app/api/siwe/*` routes
- Hetzner worker: new `verifySIWE`, `getOwnedTokens` actions

---

## Phase 3: The 1111 Collection & On-Chain (Outlined)

**Goal:** Deploy Solidity contracts for the 1111 NFT collection, community adapters, and thermal fade state machine.

- **FaxChainLetter.sol** (ERC-721): 1111 fixed supply, tiered minting by chain depth
- **CommunityAdapterRegistry** (Gnosis): Factory for per-collection adapters
- **CommunityFaxAdapter**: ownerOf verification, identity derivation, upgrade path
- **ThermalFade state machine**: On-chain timer tracking, credit economy, clearJam()
- **Provenance metadata** (ERC-8048): Hop history, traits from engagement metrics
- **Minting**: On NFT collection's home chain (Ethereum for ETH-native collections, Base for Base-native)
- **Tier supply enforcement**: Once a tier's supply is exhausted, no further mints

**Repos touched:**
- New Foundry project in nftfax repo (or separate repo): `src/` contracts, `script/` deploy scripts
- nftfax: `app/lib/contracts.ts` (replace placeholder addresses), new mint UI
- nftmailbox-netlify: new `app/api/tray/mint/route.ts` (on-chain mint coordination)

**1111 Collection tiers:**

| Tier | Hops | Supply |
|---|---|---|
| Genesis | 1 | 1 |
| Carbon | 2 | 520 |
| Thermal | 3 | 266 |
| Transfer | 4 | 133 |
| Register | 5 | 72 |
| Duplex | 6 | 44 |
| Relay | 7 | 30 |
| Exchange | 8 | 16 |
| Trunk | 9 | 12 |
| Backbone | 10 | 10 |
| Beacon | 11+ | 7 |

---

## Phase 4: Farcaster Mini App (Outlined)

**Goal:** Embed the fax game in Farcaster feeds via Mini App (Frames v2).

- `fc:miniapp` meta tag in nftfax layout
- `/.well-known/farcaster.json` manifest with webhookUrl
- SDK context handshake: FID + Ethereum address
- Notification primitive: cast notification on fax receipt
- Auto-cast on forward (with permission)
- Mini app opens the office-core GUI (not a CRT viewer — the spec's CRT references are replaced with office-core aesthetic)

**Files touched:**
- nftfax: `app/layout.tsx` (meta tags), new `app/api/farcaster/webhook/route.ts`, new `app/lib/farcaster.ts`
- Add `@farcaster/frame-sdk` dependency

---

## Phase 5: Community-Specific UX (Outlined)

**Goal:** Per-collection visual treatment within the office-core aesthetic.

- Collection-specific header/footer graphic treatments (not CRT themes — office-core overrides)
- Config-driven: `app/lib/community-themes.ts` maps prefix → CSS classes, labels, welcome fax template
- Custom timer labels (e.g. "DECOMPOSING" for Dead Fellaz)
- Custom jammed state labels (e.g. "LINE DECEASED")
- Welcome fax origin per community (e.g. `dfz.0000`)
- Full-page fax view applies community styling

**Files touched:**
- nftfax: new `app/lib/community-themes.ts`, `app/components/InTray.tsx`, `app/tray/[id]/page.tsx`

---

## Phase 6: Premium Subscriptions & Marketplace (Outlined)

**Goal:** Monetization ramp — @nftmail.box upgrade, custom hardware themes, marketplace.

- **Sovereign Upgrade**: `@fax → @nftmail.box` capability gate flip in domain registry
- **Custom Hardware**: Premium office-core header/footer treatments, sound packs — one-time purchase
- **Marketplace**: List, bid, trade 1111 collection NFTs. Platform fee on secondary sales
- **@fax activation bonus**: Activated @fax accounts get a free @nftmail.box basic inbox (10 sends). Sending a fax from @fax activates the inbox.

**Files touched:**
- nftmailbox-netlify: subscription routes, upgrade flow
- nftfax: premium UI toggle, theme selector
- New marketplace project or integration with existing marketplace infra

---

## Implementation Order (Phase 1)

1. **Create `docs/SPEC.md`** — save the full refined spec as a design document
2. **72h thermal fade** — update `InTray.tsx` contrast/countdown logic, add jammed state with blank white image
3. **Full-page fax view** — new `app/tray/[id]/page.tsx` route
4. **@fax addressing** — frontend suffix selector, backend channel flag, worker public document support
5. **Credit economy** — worker KV credits, backend credit routes, frontend credit display + send gating
6. **Save unlock after forward** — disable Save button until forwarded
7. **Telegraph Log (basic)** — new page + API route + worker aggregation action
8. **Deploy to Netlify** — `netlify deploy --prod`
9. **Update Hetzner worker** — deploy new actions (getCredits, setCredits, clearJam, getTelegraphLog, public fax support)

---

## Key Design Decisions

- **Office-core aesthetic overrides all CRT references** in the spec. The GUI is the existing office-core style.
- **@fax faxes are public**, @nftmail.box faxes are private. Full-page view at `fax.nftmail.box/tray/{id}` only shows public @fax faxes. Private faxes show a placeholder.
- **72h jam → blank white image** for remaining 5 days (until 8-day total decay). Sender address stays visible for re-chaining.
- **Credits stored in worker KV** (`credits:{address}`). Default 2 for new @fax identities. Forward earns +1. Jam sets to 0. clearJam resets to 1.
- **@fax activation grants free @nftmail.box basic inbox** (10 sends). Sending first fax from @fax activates the inbox.
- **1111 collection mints on the NFT's home chain** (Ethereum for ETH-native collections like Dead Fellaz, Base for Base-native).
- **No hardcoded agent lists** — all data comes from worker KV, keyed by address.

---

## Acceptance Criteria (Phase 1)

- [ ] `docs/SPEC.md` exists with full refined spec
- [ ] @fax faxes decay in 72h (forwarding disabled), blank white image shown after jam, card removed at 8 days
- [ ] `fax.nftmail.box/tray/{id}` shows public faxes full-page in office-core style
- [ ] @fax addresses can send and receive (channel: public)
- [ ] Credit balance displayed in In-Tray, send disabled at 0 credits, +1 after forward
- [ ] Save button disabled until fax is forwarded
- [ ] Telegraph Log page shows chain statistics
- [ ] Deployed to Netlify at `fax.nftmail.box`
- [ ] Hetzner worker updated with new actions
