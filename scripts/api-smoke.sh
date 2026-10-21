#!/usr/bin/env bash
# Sends one request to every Go API endpoint against the local API
# (pnpm run api:dev) and stops at the first unexpected status.
# See docs/api-local.md.
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
  [ -n "${TOKEN:-}" ] && args+=(-H "Authorization: Bearer $TOKEN")
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

login=$(jq -n --arg l "$API_LOCAL_DEMO_LOGIN" --arg p "$API_LOCAL_DEMO_PASSWORD" '{loginId: $l, password: $p}')
tokens=$(call POST /v1/auth/password 200 "$login")
TOKEN=$(jq -r .accessToken <<<"$tokens")
refresh=$(jq -r .refreshToken <<<"$tokens")

created=$(call POST /v1/batches 201 '{"entries":[{"originalText":"我很喜欢学中文。","correctedText":"我很喜欢学习中文。","pinyin":"wǒ hěn xǐhuan xuéxí zhōngwén","hints":["「学习」の方が自然です。"]}]}')
id=$(jq -r '.entries[0].id' <<<"$created")

call GET "/v1/entries?limit=5" 200 >/dev/null
call GET "/v1/entries/$id" 200 >/dev/null
call PATCH "/v1/entries/$id" 200 '{"pinyin":"wǒ hěn xǐhuan xuéxí zhōngwén."}' >/dev/null
call PUT "/v1/entries/$id/share" 200 >/dev/null
call DELETE "/v1/entries/$id/share" 200 >/dev/null

members=$(call GET /v1/members 200)
friend=$(jq -r --arg l "$API_LOCAL_FRIEND_LOGIN" '.members[] | select(.loginId == $l) | .ownerId' <<<"$members")
call PUT "/v1/follows/$friend" 204 >/dev/null
timeline=$(call GET "/v1/timeline?limit=10" 200)
echo "     timeline: $(jq '.items | length' <<<"$timeline") item(s) from $API_LOCAL_FRIEND_LOGIN" >&2

call DELETE "/v1/entries/$id" 204 >/dev/null
call GET "/v1/trash" 200 >/dev/null
call POST "/v1/trash/$id/restore" 200 >/dev/null
call DELETE "/v1/entries/$id" 204 >/dev/null
call DELETE "/v1/trash/$id" 204 >/dev/null
call DELETE "/v1/follows/$friend" 204 >/dev/null

TOKEN=""
renewed=$(call POST /v1/auth/refresh 200 "$(jq -n --arg t "$refresh" '{refreshToken: $t}')")
call POST /v1/auth/logout 204 "$(jq -n --arg t "$(jq -r .refreshToken <<<"$renewed")" '{refreshToken: $t}')" >/dev/null

echo "All requests succeeded." >&2
