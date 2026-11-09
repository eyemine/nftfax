# cryptographics-tools

Standalone renderer + preservation mirror for the legacy Cryptographics project
(DecenterApps, mainnet, 2018) — feeds nftfax generative fax art.

- `dump.mjs` — read all packs from AssetManager `0x80d7…b5d6` → `data/chain-dump.json`
- `mirror.mjs` — download every IPFS CID (pack metadata, covers, assets) to `data/ipfs/`
  and re-pin to Pinata. Same content = same CID, so on-chain hashes stay valid.
- `render.mjs` — `seed + pack ids → PNG`, faithful port of the original algorithm
  (`lib/compose.mjs`). Writes a `.json` provenance record next to the PNG.

Data/output dirs are gitignored. `PINATA_JWT` is read from `../../.env.local`.
