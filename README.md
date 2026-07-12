# NFTfax

Standalone office-core frontend for secure bitmap transmission through the existing NFTmail backend.

## Architecture

- Next.js frontend deployed independently to `fax.nftmail.box`
- Privy email, Google, Farcaster, and wallet onboarding
- Automatic embedded wallets for users without an existing wallet
- Client-side image downscaling and greyscale reduction
- `/api/tray/*` requests proxy to `https://nftmail.box/api/tray/*`
- Compression, tier enforcement, storage, and delivery remain authoritative in NFTmail

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, set `NEXT_PUBLIC_PRIVY_APP_ID`, then open `http://localhost:3000`.

## Production

```bash
npm run build
```

Netlify site: `nftfax-office-core`

Production fallback URL: `https://nftfax-office-core.netlify.app`

Custom domain: `https://fax.nftmail.box`
