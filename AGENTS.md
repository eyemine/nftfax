# nftfax — Agent Instructions

## Deployment

- **nftfax.app is deployed on Hetzner, not Netlify.**
- Do not mention or assume Netlify as the deployment target for this repo.
- There is a stale, out-of-date Netlify project at `https://app.netlify.com/projects/nftfax-office-core/overview` (for `fax.nftmail.box`) that must be ignored and not referenced.
- Pushing to `main` does **not** auto-deploy the live site. After pushing, deploy to Hetzner with:
  1. `ssh root@46.225.158.75`
  2. `cd /opt/nftfax && git pull`
  3. `docker compose up --build -d`
  4. Verify with `docker logs nftfax-nftfax-1 --tail 20`
- The app is exposed on host port `3002` (container `3000`).
- The Cloudflare worker is the only worker component; the Next.js app runs on Hetzner.

## Repo-specific reminders

- See `env.example` for required environment variables.
- Run `npx tsc --noEmit` before committing to avoid shipping TypeScript errors.
