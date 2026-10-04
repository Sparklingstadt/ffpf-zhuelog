# Production image for Cloud Run (or any container host). See docs/cloud-run.md.

# The full image ships OpenSSL, which the Prisma CLI uses to pick its engines.
FROM node:24-bookworm AS build
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    # prisma.config.ts needs a value to load. Nothing connects to it here.
    DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN NEXT_OUTPUT=standalone pnpm run build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The app code stays read-only; only Next.js's runtime cache is writable.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 8080
CMD ["node", "server.js"]
