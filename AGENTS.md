# nftfax — Agent Instructions

## Deployment

- **nftfax.app is deployed on Hetzner, not Netlify.**
- Do not mention or assume Netlify as the deployment target for this repo.
- There is a stale, out-of-date Netlify project at `https://app.netlify.com/projects/nftfax-office-core/overview` (for `fax.nftmail.box`) that must be ignored and not referenced.
- Pushing to `main` builds the production image in GitHub Actions and publishes it to
  `ghcr.io/eyemine/nftfax:latest` (`.github/workflows/build-image.yml`). It does **not**
  deploy. After the workflow is green, deploy to Hetzner with:
  1. `ssh root@46.225.158.75`
  2. `cd /opt/nftfax && git pull` (for the compose file and docs; the image is already built)
  3. `docker compose pull && docker compose up -d`
  4. Verify with `docker logs nftfax-nftfax-1 --tail 20`
- **Never run `docker compose up --build` on the server.** The 8 GB host runs the live
  containers; an on-box `next build` OOM-killed dockerd on 2026-09-22 and took nftmail.box
  down. BuildKit cache had also grown to 112 GB / 775 entries and dockerd to 2.7 GB RSS.
  `live-restore` is now enabled so a daemon restart no longer kills containers, and there is
  a 4 GB swapfile, but the fix is to not build there at all.
- If a hotfix cannot wait for Actions, build locally for the server's architecture and push:
  `docker buildx build --platform linux/amd64 -t ghcr.io/eyemine/nftfax:latest --push .`
  (needs `docker login ghcr.io` with a token that has `write:packages`).
- The app is exposed on host port `3002` (container `3000`).
- The Cloudflare worker is the only worker component; the Next.js app runs on Hetzner.

## Repo-specific reminders

- See `env.example` for required environment variables.
- Run `npx tsc --noEmit` before committing to avoid shipping TypeScript errors.
