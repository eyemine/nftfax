# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_NFTMAIL_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_PRIVY_APP_ID=${NEXT_PUBLIC_PRIVY_APP_ID}
ENV NEXT_PUBLIC_NFTMAIL_URL=${NEXT_PUBLIC_NFTMAIL_URL}
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
