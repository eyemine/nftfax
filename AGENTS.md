# nftfax — Agent Instructions

## Deployment

- **nftfax.app is deployed on Hetzner, not Netlify.**
- Do not mention or assume Netlify as the deployment target for this repo.
- There is a stale, out-of-date Netlify project at `https://app.netlify.com/projects/nftfax-office-core/overview` (for `fax.nftmail.box`) that must be ignored and not referenced.
- Pushing to `main` does **not** auto-deploy the live site. Coordinate Hetzner deployment through the project's existing deployment pipeline.
- The Cloudflare worker is the only worker component; Next.js app deploys through Hetzner.

## Repo-specific reminders

- See `env.example` for required environment variables.
- Run `npx tsc --noEmit` before committing to avoid shipping TypeScript errors.
