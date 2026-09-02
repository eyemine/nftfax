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

The live site is on Hetzner (`46.225.158.75`). After merging to `main`, deploy with:

```bash
ssh root@46.225.158.75
cd /opt/nftfax
git pull
docker compose up --build -d
```

Verify:

```bash
docker logs nftfax-nftfax-1 --tail 20
```

The app is exposed on host port `3002` (Docker maps container `3000` to host `3002`).

Custom domain: `https://nftfax.app`
