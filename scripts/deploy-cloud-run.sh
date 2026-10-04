#!/usr/bin/env bash
# Deploys the web app to Cloud Run from Google Cloud Shell. See docs/cloud-run.md.
#
#   git clone https://github.com/Sparklingstadt/ffpf-zhuelog.git
#   cd ffpf-zhuelog && ./scripts/deploy-cloud-run.sh
#
# Safe to re-run: existing secrets are kept, and a blank answer keeps the
# current value. LINE stays on Vercel (LINE_INTEGRATION_ENABLED=false).
set -euo pipefail

SERVICE="${SERVICE:-zhuelog}"
REGION="${REGION:-asia-northeast1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"

cd "$(dirname "$0")/.."

if [[ -z "$PROJECT" ]]; then
  read -rp "Google CloudのプロジェクトID: " PROJECT
fi
[[ -n "$PROJECT" ]] || { echo "プロジェクトIDが必要です。" >&2; exit 1; }
gcloud config set project "$PROJECT" >/dev/null

echo "== プロジェクト $PROJECT / リージョン $REGION / サービス $SERVICE"
echo "== APIを有効化しています（初回は数分かかります）"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
# The default compute service account builds the image and runs the service.
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "== $RUNTIME_SA にソースからのビルド権限を付与しています"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/run.builder \
  --condition None >/dev/null

secret_exists() {
  gcloud secrets describe "zhuelog-$1" >/dev/null 2>&1
}

# Creates the secret from stdin and lets the service read it.
create_secret() {
  gcloud secrets create "zhuelog-$1" --replication-policy automatic \
    --data-file - >/dev/null
  gcloud secrets add-iam-policy-binding "zhuelog-$1" \
    --member "serviceAccount:$RUNTIME_SA" \
    --role roles/secretmanager.secretAccessor >/dev/null
  echo "   zhuelog-$1 を登録しました"
}

# Asks for a value without echoing it. Blank skips an optional secret.
prompt_secret() {
  local name="$1" description="$2" required="$3" value
  if secret_exists "$name"; then
    echo "   zhuelog-$name は登録済みです（変更はSecret Managerで行ってください）"
    return
  fi
  while true; do
    read -rsp "$description: " value
    echo
    if [[ -n "$value" ]]; then
      printf '%s' "$value" | create_secret "$name"
      return
    fi
    [[ "$required" == required ]] || { echo "   スキップしました"; return; }
    echo "   必須です。"
  done
}

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

env_vars="LINE_INTEGRATION_ENABLED=false"
[[ -n "$github_id" ]] && env_vars+=",AUTH_GITHUB_ID=$github_id"
# The list may contain commas, so use gcloud's alternate delimiter syntax.
[[ -n "$github_logins" ]] &&
  env_vars="^@^${env_vars//,/@}@AUTH_ALLOWED_GITHUB_LOGINS=$github_logins"

secrets="DATABASE_URL=zhuelog-DATABASE_URL:latest,AUTH_SECRET=zhuelog-AUTH_SECRET:latest"
for name in OPENAI_API_KEY AUTH_GITHUB_SECRET; do
  secret_exists "$name" && secrets+=",$name=zhuelog-$name:latest"
done

echo "== ビルドしてデプロイしています（5分ほどかかります）"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --max-instances 1 \
  --update-env-vars "$env_vars" \
  --update-secrets "$secrets" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
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
EOF
