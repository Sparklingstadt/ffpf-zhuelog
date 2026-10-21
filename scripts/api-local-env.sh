#!/usr/bin/env bash
# Local-only settings for trying the Go API. Source this file; never use these
# values anywhere but this machine. See docs/api-local.md.

export API_LOCAL_DATABASE_URL="postgresql://zhuelog_api:local-api-only@127.0.0.1:55440/zhuelog_api"
export API_LOCAL_URL="http://127.0.0.1:8081"

# Values the API requires at startup. GitHub login is not usable locally
# (it needs a real OAuth App), so the GitHub values are placeholders. GitHub
# user IDs start at 1, so the allowlist "0" matches nobody.
export DATABASE_URL="$API_LOCAL_DATABASE_URL"
export PORT=8081
export API_JWT_SECRET="local-only-jwt-secret-not-for-production-0123456789"
export GITHUB_MOBILE_CLIENT_ID="local-placeholder"
export GITHUB_MOBILE_CLIENT_SECRET="local-placeholder"
export GITHUB_MOBILE_REDIRECT_URI="zhuelog-local://oauth/callback"
export AUTH_ALLOWED_GITHUB_IDS="0"

# Sample members created by scripts/api-local-seed.ts (local test values).
export API_LOCAL_DEMO_LOGIN="demo"
export API_LOCAL_DEMO_PASSWORD="demo-password-123"
export API_LOCAL_FRIEND_LOGIN="friend"
export API_LOCAL_FRIEND_PASSWORD="friend-password-123"
