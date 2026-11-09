# An Instruction Set for a Collage: Rescuing Cryptographics and Teaching Fax Machines Generative Art

## Before Autoglyphs, there was a print shop on Ethereum

In October 2018 — six months before Larva Labs released Autoglyphs and two years before Art Blocks existed — a small research studio called DeCenter deployed a strange machine onto Ethereum mainnet. Cryptographics was part dApp, part print shop, part thought experiment. Artists uploaded "asset packs" of visual elements; anyone could select packs, roll a seed, and watch an on-chain algorithm compose the elements into a unique collage on a print-ready A4 canvas at 300 DPI. If you liked what the dice gave you, you paid for the packs the roll had used — royalties flowing to each artist — and minted a Digital Print Image: DPM, an NFT.

The design deserves more credit than the timeline usually gives it. It was generative — deterministic seed mathematics deciding which assets appear, where they land, at what rotation, scale and layer order — and it was on-chain in a deeper sense than the phrase usually means. What the contract stored was not an image but a *recipe*: a finalSeed and the candidate asset pool, sufficient for anyone, anywhere, forever, to recompute the exact composition. A Cryptographic is an instruction set for a collage. The rendered JPEG was a courtesy copy.

It also shipped before the ERC-721 standard had finished being written. The contract implements the OpenZeppelin draft spec — it declares metadata support via ERC-165, but `tokenURI` returns empty forever. A fossil of the exact moment before "NFT" had a fixed meaning. Only 496 Cryptographics were ever minted.

## What I made with it

I was one of its heavy users. As eyemine.eth I created 68 of the 140 asset packs — nearly half the catalogue — and bought a dozen more from other artists.

What drew me in was the aleatoric core. You don't choose the composition; you choose the vocabulary, then negotiate with chance. My packs were Melbourne: Merri Creek watercolours, the Yarra Pipe Bridge, Northcote textures, papermill silos, studio backgrounds, tarot scans, doomsday graphics, Finnegans Wake fragments. The algorithm became a creative tool — a way to rework photographic and painted material into compositions I could not have composed deliberately, because deliberate composition was precisely what the system removed. Each seed was a draft; re-rolling iterated the space until something worth keeping emerged. You learned to think like the machine: which assets play well at 800% scale, which make good grounds, which survive being rotated.

## The rescue

Legacy crypto projects rarely die in a single event; they decay on a schedule written by their pinning bills. Cryptographics' assets live on IPFS behind CIDs recorded on-chain, and by the time we looked properly, the pins were rotting — metadata JSONs unreachable on every public gateway, the project's backend API dark, tokenURIs that had never existed in the first place.

The work, briefly:

- Read every pack's on-chain record — 140 packs, 3,048 assets — including correcting a misread where the contract's dynamic bytes field (an ASCII CID string) had been mistaken for a hash.
- Mirrored every reachable file and verified it by rehashing against the on-chain CID. Content-addressing means verification requires no trust.
- Recovered strays through a real IPFS node's DHT/Bitswap where gateways had already given up.
- Result: 2,811 asset files, all 134 pack metadata documents, and all 496 canonical minted renders — roughly 3,900 byte-verified objects, now pinned on a self-operated Kubo archive node with a public swarm address.
- Reconstructed what the chain never had: 496 standards-compliant metadata JSONs built from on-chain recipes — the tokenURI layer the contract never served. Honestly labelled reconstruction, not forgery.
- The honest losses: five asset PNGs and one pack cover — a 99.8% recovery. Twenty minted Cryptographics reference missing ingredients; their recipes can't be re-executed faithfully, though their final renders survive in the archive. And one oddity of personal significance: pack 128 — *erotica uno* — was corrupted at creation, recording a duplicate hash for one asset slot. Its "missing" image never existed on IPFS. There was nothing to lose.

Because pinning is hosting rather than access control, this restores availability for everyone — cryptographics.app itself can pull these CIDs again, and so can any other archivist. That's the point: keeping a piece of NFT archaeology executable.

## The seed goes to the fax machine

Then the obvious question: if a Cryptographic is an instruction set, what happens when you hand the instruction set to another machine?

nftfax.app is my NFT-gated chain-letter game: @fax identities are NFTs, each send forwards a document up a hop chain, thermal timers count down, and a physical exhibition prints incoming faxes on a real thermal printer in an Australian gallery. It is a system obsessed with transmission — and it turns out fax was always the natural home for a 2018 generative collage protocol.

The integration, working today as a standalone renderer:

- The incoming fax's ID becomes the seed.
- From the same seed stream we derive the pack selection — one to three packs from an allowlist — shuffle the combined asset pool down the keccak chain, take thirty candidates exactly as the original UI did, then run the original parity filter and layer ordering line-for-line.
- Output is the same A4 @300 DPI canvas the platform was designed for — which happens to be what a fax page is. A monochrome variant applies Floyd–Steinberg dithering, producing exactly what the thermal printer will print.
- A provenance sidecar — seed, finalSeed, pack IDs, creator addresses, picked assets — travels with every image. Anyone can re-render and verify byte-equality. The provenance isn't claimed; it's checkable.

The default allowlist is my own 68 packs — the material I have the clearest right to reuse — with third-party packs opt-in per artist. Agents run it headlessly: an @fax agent signs a wallet session once, renders the composition, and sends it down the chain. The server verifies the wallet holds the @fax NFT, moves the credit, and the recipient gets a generative print as a fax.

There's a symmetry I can't get over: Cryptographics' recipe made an image reproducible across *time*; fax made images reproducible across *space*. Grafting one onto the other — an on-chain instruction set printing itself on thermal paper in a Melbourne gallery — feels less like a mashup than a completion. The chain letter is, after all, the original decentralised art protocol.

## What's next

Preservation first: a second pinning provider for redundancy, and retry waves for the six files still unreachable — providers sometimes come back. Then the wiring: connecting the generator to the live game so a seed from 2018 can bloom on a fax page in 2026. Legacy Cryptographics collectors get new utility; the asset packs get new ink; the recipe keeps executing.

The chain isn't broken. It was just waiting for paper.
