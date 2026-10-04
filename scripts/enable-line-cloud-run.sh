#!/usr/bin/env bash
# Moves the LINE integration to Cloud Run from Google Cloud Shell. Run it after
# deploy-cloud-run.sh. See docs/cloud-run.md.
#
#   cd ffpf-zhuelog && git pull && ./scripts/enable-line-cloud-run.sh
#
# Enables LINE on the Cloud Run service, keeps the CPU allocated after a
# response (for the webhook's after()), schedules /api/line/drain every 30
# minutes and checks that the drain answers. The LINE webhook URL is switched
# by hand afterwards. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/cloud-run-common.sh

echo "== APIを有効化しています"
gcloud services enable run.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com

URL="$(service_url 2>/dev/null || true)"
[[ -n "$URL" ]] || {
  echo "プロジェクト $PROJECT の $REGION に、Cloud Runのサービス $SERVICE がありません。" >&2
  echo "Web画面をデプロイしたプロジェクトで実行するか、先に ./scripts/deploy-cloud-run.sh を実行してください。" >&2
  exit 1
}

echo "== 秘密情報（入力内容は表示されません）"
echo "   Vercelの環境変数、またはLINE Developersの「チャネル基本設定」「Messaging API設定」からコピーしてください。"
prompt_secret LINE_CHANNEL_SECRET "LINE_CHANNEL_SECRET（チャネルシークレット）" required
prompt_secret LINE_CHANNEL_ACCESS_TOKEN "LINE_CHANNEL_ACCESS_TOKEN（チャネルアクセストークン。再発行はしないでください）" required
prompt_secret OPENAI_API_KEY "OPENAI_API_KEY（添削・翻訳の生成に使います）" required
if ! secret_exists CRON_SECRET; then
  openssl rand -hex 32 | tr -d '\n' | create_secret CRON_SECRET
fi

# Sends a bearer token via a header file, keeping it out of the process list.
curl_bearer() {
  local token="$1"
  shift
  curl -H @<(printf 'Authorization: Bearer %s\n' "$token") "$@"
}

# The bot's user ID comes from the token itself, which also checks the token.
access_token="$(gcloud secrets versions access latest --secret zhuelog-LINE_CHANNEL_ACCESS_TOKEN)"
bot_id="$(curl_bearer "$access_token" -sf https://api.line.me/v2/bot/info |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["userId"])')" || {
  echo "LINEのチャネルアクセストークンでBot情報を取得できませんでした。トークンを確認してください" >&2
  echo "（Secret Managerの zhuelog-LINE_CHANNEL_ACCESS_TOKEN に新しいバージョンを追加すると直せます）。" >&2
  exit 1
}
unset access_token
echo "   公式アカウントのユーザーID: $bot_id"

while true; do
  read -rp "あなたのLINEユーザーID（Uから始まる33文字。LINE Developersの「チャネル基本設定」の下部）: " user_id
  [[ "$user_id" =~ ^U[0-9a-fA-F]{32}$ ]] && break
  echo "   形式が違います。"
done

echo "== Cloud Run でLINE連携を有効にしています"
gcloud run services update "$SERVICE" --region "$REGION" \
  --no-cpu-throttling \
  --update-env-vars "LINE_INTEGRATION_ENABLED=true,LINE_BOT_USER_ID=$bot_id,LINE_ALLOWED_USER_ID=$user_id" \
  --update-secrets "LINE_CHANNEL_SECRET=zhuelog-LINE_CHANNEL_SECRET:latest,LINE_CHANNEL_ACCESS_TOKEN=zhuelog-LINE_CHANNEL_ACCESS_TOKEN:latest,OPENAI_API_KEY=zhuelog-OPENAI_API_KEY:latest,CRON_SECRET=zhuelog-CRON_SECRET:latest" \
  --quiet >/dev/null

echo "== Cloud Scheduler（30分おき）を設定しています"
cron_secret="$(gcloud secrets versions access latest --secret zhuelog-CRON_SECRET)"
job=(zhuelog-line-drain --location "$REGION" --schedule '*/30 * * * *'
  --time-zone Asia/Tokyo --http-method GET --uri "$URL/api/line/drain")
if gcloud scheduler jobs describe zhuelog-line-drain --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${job[@]}" \
    --update-headers "Authorization=Bearer $cron_secret" --quiet >/dev/null
else
  gcloud scheduler jobs create http "${job[@]}" \
    --headers "Authorization=Bearer $cron_secret" --quiet >/dev/null
fi

echo "== /api/line/drain を確認しています"
status="$(curl_bearer "$cron_secret" -s -o /dev/null -w '%{http_code}' \
  "$URL/api/line/drain")"
unset cron_secret
case "$status" in
  200) echo "   OK（Cloud RunでLINE連携が有効になりました）" ;;
  401) echo "   401: サービスの CRON_SECRET が Secret Manager の値と一致しません。もう一度実行してください。" >&2; exit 1 ;;
  503) echo "   503: LINEの設定かDBへの接続に問題があります。Cloud Runのログを確認してください。" >&2; exit 1 ;;
  *) echo "   想定外の応答（$status）です。Cloud Runのログを確認してください。" >&2; exit 1 ;;
esac

cat <<EOF

残りの手順（手作業）:
1. LINE Developers の「Messaging API設定」で Webhook URL を次に変えて「検証」を押す。
     $URL/api/line/webhook
2. 自分のLINEから短い中文を送り、返信が届くことを確認する。
3. Vercel の環境変数 LINE_INTEGRATION_ENABLED を false にして再デプロイする
   （切り替えの前後に届いたメッセージも、どちらかが二重にならずに処理します）。
EOF
