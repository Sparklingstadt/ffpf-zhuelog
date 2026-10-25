#!/usr/bin/env bash
# Runs the Go API on this machine. Usage: scripts/api-local.sh db|dev|stop [-v]
# See docs/api-local.md.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/api-local-env.sh
source "$root/scripts/api-local-env.sh"
compose=(docker compose -f "$root/compose.api.yaml")

case "${1:-}" in
  db)
    "${compose[@]}" up -d --wait api-db
    (cd "$root" && DATABASE_URL="$API_LOCAL_DATABASE_URL" pnpm exec prisma migrate deploy)
    (cd "$root" && pnpm exec tsx scripts/api-local-seed.ts)
    echo "Database ready at 127.0.0.1:55440. Next: pnpm run api:dev"
    ;;
  dev)
    echo "Go API on ${API_LOCAL_URL} (Ctrl+C to stop)"
    cd "$root/services/api" && exec go run .
    ;;
  stop)
    # Pass -v to also delete the local data volume.
    "${compose[@]}" down "${@:2}"
    ;;
  *)
    echo "usage: $0 db|dev|stop [-v]" >&2
    exit 2
    ;;
esac
