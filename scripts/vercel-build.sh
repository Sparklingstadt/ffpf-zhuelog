#!/usr/bin/env bash
# Vercel's build command for the web project (vercel.json).
# Production builds apply pending Prisma migrations before building, so a
# merge to main never ships code ahead of its tables. Preview builds use
# their own Neon branch and must not migrate (its schema is kept in step by
# hand; see docs/api-deployment.md).
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  pnpm exec prisma migrate deploy
fi
pnpm run build
