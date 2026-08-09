# NFTfax — Pre-Launch Test Plan (Aug 8 launch)

Practical plan to test the fax chain-letter game end-to-end before launch.
Grounded in the current codebase so every item points at the file/route that
actually implements it.

## 0. Reality check — what exists vs. what is spec-only

Before writing test cases, confirm scope. Several mechanics in the original
brief are **not in the code** yet. Testing can't cover features that don't
ship. Decide per item: **in scope for Aug 8** or **cut / post-launch**.

**Implemented and testable today**

- **Wallet auth + NFT gate** — Privy login + MetaMask connect (`app/page.tsx`).
  Ownership gate is `isFaxEligible()` in
  `nftmailbox-netlify/app/lib/fax-eligibility.ts` (per-collection, delegate.xyz v2).
- **Fax composition** — blend ops + Negative toggle (`app/components/InTray.tsx`,
  `app/lib/image.ts`). Ops are `stamp` / `ghost` / `illuminate` (the brief calls
  these Stamp/Ghost/Glow — confirm the labels you want in `CHAIN_OPS`).
- **Send + forward** — `nftmailbox-netlify/app/api/tray/send/route.ts` → worker
  `setTrayDocument`.
- **Thermal Fade (visual + jam)** — `JAM_MS = 72h` hardcoded in
  `app/components/InTray.tsx` and `app/tray/[id]/page.tsx`; credit drain is
  `FADE_MS = 72h` in `nftmailbox-netlify/app/lib/fax-credits.ts`.
- **Credit economy** — `fax-credits.ts` (`spendCredit`, `earnForwardCredit`,
  `applyThermalFade`, `clearJam`).
- **Collection selector** — chonk / deadfellaz / normie / pow dropdown
  (`app/page.tsx`, `app/lib/theme.ts`).
- **Ready-to-Receive + Radar** — `app/pre-register/page.tsx` ("Signal ready"
  checkbox + "Active player radar").
- **Telegraph Log** — `app/telegraph/page.tsx` + `/api/telegraph/list` →
  worker `listTelegraph` (totals, community diversity, top chains).
- **Full-page fax viewer** — `app/tray/[id]/page.tsx`.
- **Mint / Save buttons** — `/api/tray/[id]/mint` and `/save`, but see blocker below.

**NOT found in the codebase (spec-only — confirm scope before testing)**

- **Guardian Relays** (`@guardian.*` auto-forward) — no implementation.
- **Recall & Reroute** — no implementation.
- **Rescue Pool / Jeopardy tab / Chain Saver badge** — no implementation.
  (Only "Save to Gnosis" rescues a fax from decay, and its contract is a
  placeholder — see below.)
- **Multi-token identity hot-swap dropdown** — not present. Today the mailbox is
  a free-text field and owner-mode derives a single tokenId from the label
  digits (`extractTokenId` in `fax-eligibility.ts`). There is a *collection*
  dropdown, not a *token* dropdown.

## 1. Launch blockers (fix before any launch sign-off)

1. **Base "2222" mint-cap contract is a zero address.**
   `app/lib/contracts.ts` → `BASE_FAX_COLLECTIBLE` / `GNOSIS_FAX_ARCHIVE` are
   `0x000…000`. `isPlaceholderAddress()` short-circuits the on-chain tx, so
   Mint/Save only record off-chain. **Real minting cannot be tested until the
   contract is deployed and the address is set.**
2. **No compressed-timer test mode.** The 72h fade is hardcoded in three places
   (see §2). Decay mechanics can't be exercised in a normal test session
   without this.
3. **Auth is Privy/MetaMask, not literal SIWE.** If "SIWE" is a hard
   requirement, that's a code change, not just a test. Otherwise treat "SIWE" in
   the brief as "wallet-authenticated".
4. **clearJam credit mismatch.** `clearJam()` resets to `BASE_FREE_CREDITS = 2`,
   but `app/about/page.tsx` says "reset to 1 credit". Pick one and align copy +
   code before testing the credit economy.

## 2. Test Mode — compressed Thermal Fade (highest priority)

You cannot wait 72h per cycle. Add a configurable fade that compresses 72h to
seconds. **Three edits, gated behind an env flag so production is never
affected.**

**a. Server credit drain** — `nftmailbox-netlify/app/lib/fax-credits.ts`

```ts
// replace the hardcoded constant
export const FADE_MS = (() => {
  const override = Number(process.env.FAX_FADE_SECONDS);
  return Number.isFinite(override) && override > 0
    ? override * 1000
    : 72 * 60 * 60 * 1000;
})();
```

**b. Client fade + jam** — `nftfax/app/components/InTray.tsx` and
`nftfax/app/tray/[id]/page.tsx` (both define `const JAM_MS = 72 * 60 * 60 * 1000`)

```ts
const JAM_MS = (Number(process.env.NEXT_PUBLIC_FAX_FADE_SECONDS) || 72 * 3600) * 1000;
```

Optionally also compress `DECAY_MS` (8-day gallery removal) in `InTray.tsx`.

**c. Env wiring** — set in the test deploy only:

```
FAX_FADE_SECONDS=72            # server (credit drain)
NEXT_PUBLIC_FAX_FADE_SECONDS=72  # client (visual fade + jam label)
```

**Verify parity:** the client jam label and the server credit drain must flip at
the same time. If they diverge, a fax can look jammed while still earning
credits (or vice-versa). Add a quick assertion in the dry run.

> Note: the poll/refresh interval in `InTray.tsx` is 30s (`setInterval(... , 30_000)`).
> For a 72s test cycle, drop it to ~2–5s in test mode or hit **Refresh** manually.

## 3. Test wallets & mock NFTs

Ownership is enforced by real contracts in `fax-eligibility.ts`:

| Collection | Contract | Chain | Mode |
|---|---|---|---|
| chonk | `0x0715…b4f9` | Base | owner |
| deadfellaz | `0x2aca…a17b` | Ethereum | owner |
| normie | `0x9eb6…2438` | Ethereum | owner |
| pow | `0x9abb…be1b` | Ethereum | owner |

`mode: 'owner'` means the mailbox label must end in a token ID you actually own
(`extractTokenId` pulls the trailing digits). Plan wallets accordingly.

| Wallet | Holds | Role |
|---|---|---|
| A | deadfellaz #<owned> | Primary sender |
| B | deadfellaz #<owned> | Recipient / forwarder |
| C | chonk #<owned> | Cross-community |
| D | multiple deadfellaz | Multi-token (see caveat) |
| E | nothing | Rejection case (must be blocked) |

**If you lack real NFTs:** deploy a mock ERC-721 on a testnet and point a
collection entry at it. Cleanest hook is the env override in `fax-eligibility.ts`
(`FAX_COLLECTION_CONTRACT` / `FAX_COLLECTION_RPC` / `FAX_ELIGIBILITY_MODE`) so you
don't touch the hardcoded `COLLECTIONS` map. Use `FAX_ELIGIBILITY_MODE=balance`
to avoid the label-derived tokenId requirement while testing.

**Caveat:** the "multi-token dropdown" isn't built. For Wallet D, the realistic
test today is "owner-mode label with different trailing token IDs resolves
correctly", not "hot-swap identities in a dropdown".

## 4. Test checklist by component

| Component | Test | How / where |
|---|---|---|
| Wallet + NFT gate | Wallet E → rejected; Wallet A → allowed | `/api/tray/send` returns 403 (`isFaxEligible`) for E, 200 for A |
| Owner-mode tokenId | Label `dfz1234` with token 1234 owned → allowed; not owned → 403 | `extractTokenId` in `fax-eligibility.ts` |
| Delegation | Cold vault + hot wallet via delegate.xyz v2 → allowed | `checkDelegateForERC721`, `DelegatePanel.tsx` |
| Blend ops + Negative | Upload same mark, toggle stamp/ghost/illuminate + Negative | `InTray.tsx` forward flow, `compositeChain` in `lib/image.ts` |
| Send fax | A → B; B's in-tray shows it; countdown starts | `/api/tray/send`; `setLastReceived` starts fade |
| Forward + credit | B forwards → B earns +1 credit | `earnForwardCredit`; check `/api/tray/credits` before/after |
| No-credit block | Basic wallet at 0 credits → send blocked (402) | `spendCredit` returns false |
| Thermal Fade (test mode) | After 72s: image fades → LINE JAMMED; credits → 0 | client `JAM_MS`; server `applyThermalFade` |
| Clear Jam | Jammed wallet clears → credits reset | `clearJam` (confirm 1 vs 2, see §1.4) |
| 8-day decay | Fax removed from gallery after decay window | client `DECAY_MS` in `InTray.tsx` |
| Cross-community | A(dfz) → C(chnk) delivered; diversity increments | `/api/tray/send`; `telegraph` `domainDiversity` |
| Private fax (@nftmail.box) | Pro/Premium only; encrypted; public URL shows lock | `channel==='private'` path; `tray/[id]` lock placeholder |
| Ready-to-Receive + Radar | Toggle "Signal ready" → appears in Radar count | `pre-register/page.tsx` |
| Full-page viewer | `/tray/{id}` public renders; private shows placeholder | `app/tray/[id]/page.tsx` |
| Telegraph Log | Totals, community diversity, top chains update | `telegraph/page.tsx`, `listTelegraph` |
| Base mint | **Blocked until contract deployed** — verify off-chain record + placeholder notice | `contracts.ts`, `/api/tray/[id]/mint` |
| Pre-registration | Connect → pick handle → flag ready → shows in directory | `pre-register/page.tsx` |

**Deferred / confirm scope first (no code yet):** Guardian Relays, Recall &
Reroute, Rescue Pool / Jeopardy / Chain Saver badge, multi-token hot-swap.

## 5. Volume / stress test

- Run 5 chains concurrently, 10+ hops each; watch Telegraph Log for correct
  depth sorting and diversity under concurrent writes (`updateBlindIndex` /
  index trimming behaviour).
- Send from all in-scope communities at once; confirm no cross-talk between
  collection trays.
- Watch worker latency on `setTrayDocument` / `listTelegraph` under load.

## 6. Pre-launch dry run (Aug 6–7)

- 3–5 trusted holders (one per community), **real wallets + real NFTs**, on the
  **test-mode timer deploy**.
- They play a full loop: send → receive → forward → earn → jam → clear.
- Watch for: fade/jam client↔server parity, credit copy accuracy, gate false
  negatives (a real holder wrongly blocked), and any confusion from the
  placeholder mint notice.

## 7. Go / No-Go gate

Do not launch until:

- [ ] Test mode merged behind env flag; client/server fade parity verified.
- [ ] Base 2222 mint-cap contract deployed + address set in `contracts.ts` (or mint
      is explicitly descoped and the UI reflects it).
- [ ] NFT gate: zero false negatives for real holders across all in-scope
      collections.
- [ ] Credit economy copy matches code (clearJam value; 72h wording in
      `tray/[id]` and `about`).
- [ ] Spec-only features either shipped or clearly removed from the UI so
      players aren't shown dead buttons.
- [ ] Dry run completed with no P0/P1 issues open.
