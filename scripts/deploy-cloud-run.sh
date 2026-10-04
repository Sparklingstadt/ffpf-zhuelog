#!/usr/bin/env bash
# Deploys the web app to Cloud Run from Google Cloud Shell. See docs/cloud-run.md.
#
#   git clone https://github.com/Sparklingstadt/ffpf-zhuelog.git
#   cd ffpf-zhuelog && ./scripts/deploy-cloud-run.sh
#
# Safe to re-run: existing secrets are kept, and a blank answer keeps the
# current value. LINE is set up separately by enable-line-cloud-run.sh and is
# left as it is here.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/cloud-run-common.sh

echo "== APIを有効化しています（初回は数分かかります）"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

echo "== $RUNTIME_SA にソースからのビルド権限を付与しています"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/run.builder \
  --condition None >/dev/null

echo "== 秘密情報（入力内容は表示されません）"
echo "   DATABASE_URL はVercelの環境変数、またはNeonの接続文字列からコピーしてください。"
prompt_secret DATABASE_URL "DATABASE_URL（postgresql://...）" required
if ! secret_exists AUTH_SECRET; then
  openssl rand -base64 32 | tr -d '\n' | create_secret AUTH_SECRET
fi
prompt_secret OPENAI_API_KEY "OPENAI_API_KEY（管理者のChatGPT用。空欄でスキップ）" optional
prompt_secret AUTH_GITHUB_SECRET "GitHub OAuth AppのClient Secret（空欄でスキップ）" optional

echo "== 公開してよい設定（空欄なら今の値のまま）"
read -rp "GitHub OAuth AppのClient ID: " github_id
read -rp "管理者のGitHubログイン名（複数はカンマ区切り）: " github_logins

env_vars=()
[[ -n "$github_id" ]] && env_vars+=("AUTH_GITHUB_ID=$github_id")
[[ -n "$github_logins" ]] && env_vars+=("AUTH_ALLOWED_GITHUB_LOGINS=$github_logins")
env_flags=()
if ((${#env_vars[@]})); then
  # The login list may contain commas, so use gcloud's alternate delimiter.
  env_flags=(--update-env-vars "^@^$(IFS=@; echo "${env_vars[*]}")")
fi

secrets="DATABASE_URL=zhuelog-DATABASE_URL:latest,AUTH_SECRET=zhuelog-AUTH_SECRET:latest"
for name in OPENAI_API_KEY AUTH_GITHUB_SECRET; do
  if secret_exists "$name"; then
    secrets+=",$name=zhuelog-$name:latest"
  fi
done

echo "== ビルドしてデプロイしています（5分ほどかかります）"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --max-instances 1 \
  "${env_flags[@]}" \
  --update-secrets "$secrets" \
  --quiet

URL="$(service_url)"
current_auth_url="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format=json | python3 -c '
import json, sys
env = json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env", [])
print(next((e.get("value", "") for e in env if e["name"] == "AUTH_URL"), ""))')"
if [[ "$current_auth_url" != "$URL" ]]; then
  echo "== AUTH_URL を $URL に設定しています"
  gcloud run services update "$SERVICE" --region "$REGION" \
    --update-env-vars "AUTH_URL=$URL" --quiet >/dev/null
fi

cat <<EOF

デプロイしました: $URL

- ゲストとしてログインし、学習ノートが表示されることを確認してください。
- GitHubでの管理者ログインを使うには、Cloud Run用のGitHub OAuth Appを作り、
  Authorization callback URL を次にしてから、このスクリプトをもう一度実行してください。
    $URL/api/auth/callback/github
- LINE連携をCloud Runに移すには ./scripts/enable-line-cloud-run.sh を実行します。
EOF
