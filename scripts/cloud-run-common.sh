# Shared by the Cloud Run scripts (sourced, not run). See docs/cloud-run.md.

SERVICE="${SERVICE:-zhuelog}"
REGION="${REGION:-asia-northeast1}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"

if [[ -z "$PROJECT" ]]; then
  read -rp "Google CloudのプロジェクトID: " PROJECT
fi
[[ -n "$PROJECT" ]] || { echo "プロジェクトIDが必要です。" >&2; exit 1; }
gcloud config set project "$PROJECT" >/dev/null
echo "== プロジェクト $PROJECT / リージョン $REGION / サービス $SERVICE"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
# The default compute service account builds the image and runs the service.
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

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

service_url() {
  gcloud run services describe "$SERVICE" --region "$REGION" \
    --format='value(status.url)'
}
