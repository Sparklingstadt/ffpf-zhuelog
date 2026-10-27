#!/usr/bin/env bash
# Vercel's build command for the web project (vercel.json).
# Production builds apply pending Prisma migrations before building, so a
# merge to main never ships code ahead of its tables. Preview builds share
# the production database, so they must not migrate: an unmerged PR's
# migration would land in production.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  pnpm exec prisma migrate deploy
fi
pnpm run build
