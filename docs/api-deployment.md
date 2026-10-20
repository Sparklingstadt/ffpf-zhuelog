# Go API（`services/api`）のデプロイ手順

ネイティブアプリ向けの Go API を Cloud Run へデプロイするための準備と手順です。仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` にあります。

GCP 側の準備（Artifact Registry、サービスアカウント、Workload Identity Federation、Secret Manager）と、モバイル用 GitHub OAuth App の登録は、リポジトリの管理者が手作業で行います。`.github/workflows/api-deploy.yml` は、main への push のうち `services/api/**` に変更があるときと、手動実行（`workflow_dispatch`）で動きます。

**Actions Variables の `GCP_PROJECT_ID` が空のあいだは、デプロイのジョブはスキップされます。** 手順 3 を終えるまで、mainへマージしても失敗する実行は出ません。

## 0. マージの前に（最重要）

このブランチは Prisma マイグレーションを **2 つ** 追加します。

- `20261020120000_add_api_refresh_tokens`（`ApiRefreshToken` テーブル）
- `20261020130000_add_api_refresh_token_login`（`ApiRefreshToken.login` 列）

main は Vercel の本番へ自動でデプロイされます。**マージの前に**、両方を本番 DB（Neon）へ適用してください（手順 4）。Go API は本番デプロイ前に Neon へ接続するため、適用されていないとログインとリフレッシュが失敗します。

## 1. モバイル用 GitHub OAuth App の登録

Web 用とは別の OAuth App を新しく作ります。GitHub の **Settings → Developer settings → OAuth Apps → New OAuth App** で登録します。

- Application name: 任意（例: `学习録 mobile`）
- Homepage URL: Web の本番 URL
- Authorization callback URL: アプリのカスタム URL スキーム（例: `yourapp://oauth/callback`）

登録後に控える値は 2 つです。

- Client ID: Actions Variable `API_GITHUB_CLIENT_ID` に設定します。
- Client Secret: 手順 2 の Secret Manager に `api-github-client-secret` として入れます。

カスタム URL スキームは、Actions Variable `API_GITHUB_REDIRECT_URI` にも同じ値を設定します。Go API は、リクエストの `redirectUri` がこの値と完全一致することを要求します。

## 2. GCP の準備

以下の `PROJECT_ID`・`REGION` は自分の値に置き換えます。

```bash
PROJECT_ID="your-gcp-project"
REGION="asia-northeast1"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com --project "$PROJECT_ID"
```

### Artifact Registry

workflow は、リポジトリ名 `zhuelog-api` にイメージを push します。

```bash
gcloud artifacts repositories create zhuelog-api \
  --repository-format docker --location "$REGION" --project "$PROJECT_ID"
```

### サービスアカウント

デプロイ用（GitHub Actions が使う）と、実行用（Cloud Run のコンテナが使う）を分けます。workflow は実行用に `api-runtime@<PROJECT_ID>.iam.gserviceaccount.com` を指定するので、名前は `api-runtime` にしてください。

```bash
gcloud iam service-accounts create api-deploy --project "$PROJECT_ID"
gcloud iam service-accounts create api-runtime --project "$PROJECT_ID"

DEPLOY_SA="api-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# デプロイ用: Cloud Run のデプロイと、イメージの push
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/run.admin
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/artifactregistry.writer
# デプロイ用 SA が、実行用 SA としてサービスを動かすための権限
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser
```

### Workload Identity Federation

GitHub Actions がキーなしで GCP に認証するための設定です。**このリポジトリだけ** が使えるように、属性条件で `Sparklingstadt/ffpf-zhuelog` に限定します。

```bash
gcloud iam workload-identity-pools create github --location global --project "$PROJECT_ID"

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location global --workload-identity-pool github --project "$PROJECT_ID" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition 'attribute.repository == "Sparklingstadt/ffpf-zhuelog"'

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/Sparklingstadt/ffpf-zhuelog"
```

プロバイダのリソース名は、Actions Variable `GCP_WIF_PROVIDER` に設定します。

```text
projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-actions
```

### Secret Manager

workflow が参照するシークレットは次の 3 つです。名前は変えないでください。

| シークレット名             | 内容                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `api-database-url`         | Neon の接続文字列（下の注意を参照）                        |
| `api-jwt-secret`           | アクセス JWT の HS256 鍵。`openssl rand -base64 48` で作る |
| `api-github-client-secret` | モバイル用 GitHub OAuth App の Client Secret               |

```bash
# 値は標準入力から渡し、シェルの履歴やファイルに残さない
printf '%s' "<Neon の接続文字列>" | gcloud secrets create api-database-url --data-file=- --project "$PROJECT_ID"
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create api-jwt-secret --data-file=- --project "$PROJECT_ID"
printf '%s' "<Client Secret>" | gcloud secrets create api-github-client-secret --data-file=- --project "$PROJECT_ID"

for s in api-database-url api-jwt-secret api-github-client-secret; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" \
    --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor
done
```

**`api-database-url` には、Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）を入れ、`?schema=` パラメータは付けないでください。** Go API は `schema` を `search_path` の起動パラメータに変換しますが、プーラーがこの起動パラメータを拒否することがあります。Neon の既定のスキーマは `public` なので、付けなくても同じテーブルを読み書きします。`sslmode=require` は付けたままにします。

## 3. Actions Variables の設定

GitHub のリポジトリの **Settings → Secrets and variables → Actions → Variables** に設定します。Secrets ではなく **Variables** です（秘密情報ではないため）。

| 名前                        | 内容                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`            | GCP のプロジェクト ID。**これが空のあいだはデプロイがスキップされる**             |
| `GCP_REGION`                | Cloud Run と Artifact Registry のリージョン（例: `asia-northeast1`）              |
| `GCP_WIF_PROVIDER`          | 手順 2 の WIF プロバイダのリソース名                                              |
| `GCP_DEPLOY_SA`             | デプロイ用サービスアカウント（`api-deploy@<PROJECT_ID>.iam.gserviceaccount.com`） |
| `API_SERVICE_NAME`          | Cloud Run のサービス名（例: `zhuelog-api`）                                       |
| `API_GITHUB_CLIENT_ID`      | モバイル用 GitHub OAuth App の Client ID（`GITHUB_MOBILE_CLIENT_ID`）             |
| `API_GITHUB_REDIRECT_URI`   | アプリのカスタム URL スキーム（`GITHUB_MOBILE_REDIRECT_URI`）                     |
| `API_ALLOWED_GITHUB_LOGINS` | admin の許可リスト。Web の `AUTH_ALLOWED_GITHUB_LOGINS` と同じ値（カンマ区切り）  |

最後の 3 つは Cloud Run の環境変数として渡されます。`API_ALLOWED_GITHUB_LOGINS` はカンマを含むため、workflow は `gcloud run deploy --set-env-vars` に区切り文字 `@` を指定して渡しています（`^@^KEY=値@KEY2=値`）。値の中に `@` を含めないでください。

## 4. マージの前に: 本番 Neon へのマイグレーション適用

main は Vercel の本番へ自動でデプロイされます。このブランチの 2 つのマイグレーション（手順 0）を、**マージの前に** 本番 DB へ適用します。Vercel とリンク済みのリポジトリで、このブランチをチェックアウトして実行してください。main にはまだマイグレーションがないため、main のままだと「No pending migrations」と表示され、適用できたように見えてしまいます。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

`prisma.config.ts` は `.env` だけを読むため、`--env-file` で取得したファイルを明示的に渡しています（`DATABASE_URL=… pnpm exec prisma migrate deploy` と同じ効果です）。`migrate status` で `20261020120000_add_api_refresh_tokens` と `20261020130000_add_api_refresh_token_login` が適用済みになっていること（「Database schema is up to date!」）を、マージの前に必ず確認してください。

2 つとも、テーブルと null を許す列を足すだけなので、今の Web のコードのまま先に適用しても動作は変わりません。

## 5. デプロイと確認

手順 1〜4 を終えたら、main へマージします。`services/api/**` に変更があれば自動で、無ければ **Actions → API deploy → Run workflow** で手動実行します。

デプロイ後は、Cloud Run のサービス URL（`gcloud run services describe <API_SERVICE_NAME> --region <REGION> --format 'value(status.url)'`）で確認します。

```bash
curl -i https://<サービスURL>/health
```

`200` が返れば、DB への接続まで確認できています（失敗時は `503`）。`/healthz` は使わないでください。Cloud Run は `/healthz` を予約しており、リクエストがコンテナに届きません（Go API は同じ内容の `/healthz` も持っていますが、ローカルでの確認用です）。アプリからのログインは、`POST /v1/auth/password` か `POST /v1/auth/github` で確認します。

## 運用上の注意

### `API_JWT_SECRET` のローテーション

`API_JWT_SECRET` は Auth.js の `AUTH_SECRET` とは別の値です。作り方は `openssl rand -base64 48` です（32 バイト以上が必須）。

ローテーションすると、**発行済みのアクセストークンはすべて無効になります**（署名が合わなくなるため）。ただしリフレッシュトークンは DB のハッシュで検証するので影響を受けず、アプリは `POST /v1/auth/refresh` で新しいアクセストークンを取り直せます。手順は次のとおりです。

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add api-jwt-secret --data-file=- --project "$PROJECT_ID"
```

Cloud Run は新しいリビジョンの起動時にシークレットの `latest` を読むので、新しい値を反映するには再デプロイ（workflow の手動実行）が必要です。

### レート制限と `X-Forwarded-For`

`/v1/auth/*` のレート制限は、IP ごとにメモリ上で数えます。IP には `X-Forwarded-For` の **最後の値** を使います。これは Cloud Run のフロントエンドが付ける値で、クライアントが偽装できないため正しく動きます。**Cloud Run の外から直接コンテナへ到達できる経路（別のロードバランサーや公開ポートなど）を作らないでください。** 経路が増えると、攻撃者が `X-Forwarded-For` を偽装して制限を回避できます。パスワードの総当たりは、DB 側のロック（5 回失敗で 15 分）でも防ぎます。

### 認証と公開範囲

サービスは `--allow-unauthenticated` で公開します。アプリから直接呼ぶ API で、認証はアプリ層（アクセス JWT）で行うためです。最大インスタンス数は 2 で、Neon の接続数を抑えています。
