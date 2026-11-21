#!/usr/bin/env bash
# Checks the local Go API (pnpm run api:dev): the Go API serves only its health
# routes since stage 11, so sign-in answers 404. Stops at the first unexpected
# status. See docs/api-local.md.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/api-local-env.sh
source "$root/scripts/api-local-env.sh"
base="$API_LOCAL_URL"
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

# call METHOD PATH EXPECTED_STATUS [JSON_BODY] — prints the response body.
call() {
  local method=$1 path=$2 want=$3 data=${4:-}
  local args=(-s -o "$body" -w '%{http_code}' -X "$method" "$base$path")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  local got
  got=$(curl "${args[@]}")
  if [ "$got" != "$want" ]; then
    echo "FAIL $method $path: status $got, want $want" >&2
    cat "$body" >&2
    echo >&2
    exit 1
  fi
  echo "ok   $method $path → $got" >&2
  cat "$body"
}

call GET /health 200 >/dev/null
call GET /ping 200 >/dev/null
call POST /v1/auth/password 404 '{}' >/dev/null

echo "All requests succeeded." >&2
