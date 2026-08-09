# Plan: Collection selector + theme swap for NFTfax

1. Expand `app/lib/theme.ts` to define `CollectionKey` and a `COLLECTIONS` map with contracts, chain IDs, RPCs and per-collection branding for `chonk`, `deadfellaz`, `normie`.
2. Add `getCollectionTheme(key)` helper and make `SkinPanel` accept a `theme` prop.
3. Update `app/page.tsx`:
   - State `selectedCollection: CollectionKey` (default `deadfellaz`).
   - Replace the `@[fax/nftmail.box]` buttons with a `<select>` showing `Chonk`, `DeadFellaz`, `Normie`.
   - Keep the domain suffix as `@fax` everywhere.
   - Drive header tagline, accent, mailbox placeholder and `SkinPanel` background from `getCollectionTheme(selectedCollection)`.
   - Send `collection` in the `/api/tray/send` body.
4. Update `app/components/InTray.tsx` so clicking a fax image opens `https://nftmail.box/tray/{id}` in a new tab (image wrapped in `<a>`).
5. Update `nftmailbox-netlify/app/lib/fax-eligibility.ts` to look up the collection contract/chain from a `COLLECTIONS` map and use the `collection` field in the request body.
6. Run `npx tsc --noEmit` in `nftfax` and `nftmailbox-netlify`.
