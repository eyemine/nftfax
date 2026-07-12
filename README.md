# NFTfax

Standalone office-core frontend for secure bitmap transmission through the existing NFTmail backend.

## Architecture

- Next.js frontend deployed independently to `fax.nftmail.box`
- Injected wallet connection for sender ownership checks
- Client-side image downscaling and greyscale reduction
- `/api/tray/*` requests proxy to `https://nftmail.box/api/tray/*`
- Compression, tier enforcement, storage, and delivery remain authoritative in NFTmail

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production

```bash
npm run build
```

Netlify site: `nftfax-office-core`

Production fallback URL: `https://nftfax-office-core.netlify.app`

Custom domain: `https://fax.nftmail.box`
