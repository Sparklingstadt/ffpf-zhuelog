# Cloud Runへのデプロイ

Vercelと同じアプリを、Google Cloud RunでもDockerコンテナとして動かせます。Vercelへのデプロイはこれまでどおりで、この手順はVercelの設定を変えません。

## 仕組み

- ルートの `Dockerfile` で、Next.jsの `standalone` 出力（`.next/standalone/server.js`）を使う実行用イメージを作ります。`standalone` 出力はビルド時に `NEXT_OUTPUT=standalone` を指定したときだけ有効で、Vercelと E2E の `next start` は従来の出力のままです。
- 実行時は `node server.js` がポート `8080`（Cloud Runの `PORT`）で待ち受けます。イメージは非rootユーザー（`node`）で動き、書き込めるのはNext.jsのキャッシュ（`.next/cache`）だけです。
- イメージにはDBの接続先も秘密情報も含めません。すべて実行時の環境変数で渡します。マイグレーションも実行しません（下記）。

## Vercelとの違い

| 項目                         | Vercel                       | Cloud Run                                                                                          |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth.jsの公開URL             | 自動で判定                   | **`AUTH_URL` が必須**（例: `https://zhuelog-xxxx.asia-northeast1.run.app`）                        |
| LINEの取り残しを拾うCron     | Vercel Cron（`vercel.json`） | **Cloud Scheduler** から `GET /api/line/drain` を呼ぶ                                              |
| webhook後の処理（`after()`） | 関数の中で続けて実行         | 応答後もCPUを使えるよう **`--no-cpu-throttling`** を指定する                                       |
| `maxDuration`（60秒）        | 有効                         | 無視される。上限はCloud Runのリクエストタイムアウト（既定300秒）。LINE処理は独自に約50秒で打ち切る |

`AUTH_URL` を設定しないと、本番環境ではAuth.jsがホストを信頼せず、ログインが `UntrustedHost` で失敗します。設定すると、ログイン画面へのリダイレクト・OAuthのコールバックURL・CSPの `upgrade-insecure-requests` もこのURLを基準にします。

`after()` は応答を返したあとに動くため、Cloud Runの既定（リクエスト処理中だけCPUを割り当てる）では極端に遅くなり、LINEの返信はCronが拾うまで遅れます。`--no-cpu-throttling`（インスタンスベースの課金）にしてください。

## 前提

- Google Cloudのプロジェクトと `gcloud` CLI（`gcloud auth login` 済み）
- 外部からつながるPostgreSQL（現在のNeonをそのまま使えます。`localhost` 以外への接続は `sslmode=verify-full` で証明書を検証します）
- 以下ではリージョンを `asia-northeast1`（東京）、サービス名を `zhuelog` とします。

```sh
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com
```

## 1. 秘密情報をSecret Managerに登録する

秘密の値はコマンドの引数に書かず、標準入力から登録します（シェルの履歴に残さないため）。

```sh
for name in DATABASE_URL AUTH_SECRET AUTH_GITHUB_SECRET OPENAI_API_KEY \
  LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN CRON_SECRET; do
  printf '%s の値: ' "$name"; read -rs value; echo
  printf '%s' "$value" | gcloud secrets create "zhuelog-$name" --data-file=-
done
```

LINE連携を使わない場合、`LINE_*` と `CRON_SECRET` は不要です。Cloud Runの実行サービスアカウント（既定は `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`）に、各シークレットの「Secret Managerのシークレットアクセサー」（`roles/secretmanager.secretAccessor`）を付与してください。

## 2. マイグレーションを適用する

イメージはマイグレーションを実行しません。デプロイの前に、対象DBを明示して適用します（Vercelのときと同じ手順です）。

```sh
DATABASE_URL='<本番DBの接続文字列>' pnpm run db:deploy
```

## 3. デプロイする

`--source .` を指定すると、Cloud Buildがリポジトリの `Dockerfile` でイメージを作ってデプロイします。`.env*` はアップロードもイメージへのコピーもされません。

```sh
gcloud run deploy zhuelog \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --max-instances 1 \
  --set-env-vars "AUTH_GITHUB_ID=<OAuth AppのClient ID>,AUTH_ALLOWED_GITHUB_LOGINS=<ログイン名>,OPENAI_MODEL=gpt-6.1-sol,LINE_INTEGRATION_ENABLED=true,LINE_BOT_USER_ID=<U...>,LINE_ALLOWED_USER_ID=<U...>" \
  --set-secrets "DATABASE_URL=zhuelog-DATABASE_URL:latest,AUTH_SECRET=zhuelog-AUTH_SECRET:latest,AUTH_GITHUB_SECRET=zhuelog-AUTH_GITHUB_SECRET:latest,OPENAI_API_KEY=zhuelog-OPENAI_API_KEY:latest,LINE_CHANNEL_SECRET=zhuelog-LINE_CHANNEL_SECRET:latest,LINE_CHANNEL_ACCESS_TOKEN=zhuelog-LINE_CHANNEL_ACCESS_TOKEN:latest,CRON_SECRET=zhuelog-CRON_SECRET:latest"
```

- `--allow-unauthenticated`: ブラウザー・LINEのwebhook・Cloud Schedulerから直接呼ぶため、Cloud Run側のIAM認証は使いません。認証・認可はアプリ（Auth.js、LINEの署名、`CRON_SECRET`）が行います。
- `--max-instances 1`: 本人のAPIキーでの添削のレート制限はインスタンスごとのメモリーで数えます。インスタンスを1つにすると、この制限が全体で正確になります。増やしてもアプリは動きますが、制限はインスタンスごとになります。
- `OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` はE2Eテスト専用です。設定しないでください。

最初のデプロイが終わったら、サービスのURLを `AUTH_URL` に設定します。

```sh
URL=$(gcloud run services describe zhuelog --region asia-northeast1 --format='value(status.url)')
gcloud run services update zhuelog --region asia-northeast1 --update-env-vars "AUTH_URL=$URL"
```

独自ドメインを割り当てる場合は、`AUTH_URL` をそのドメインのURLにします。

## 4. 外部サービスのURLを切り替える

- **GitHub OAuth App**: Authorization callback URLを `<AUTH_URL>/api/auth/callback/github` にします。Vercelと並行して動かす間は、Cloud Run専用のOAuth Appを作ってください（OAuth Appのコールバックは1つです）。
- **LINE**: LINE DevelopersのWebhook URLを `<AUTH_URL>/api/line/webhook` にして「検証」します。webhookは1つなので、切り替えた時点からLINEはCloud Runで処理されます。

## 5. Cloud SchedulerでCronを設定する

Vercel Cronの代わりに、30分おきに `/api/line/drain` を呼びます（間隔の理由は [`line-integration.md`](line-integration.md) を参照）。`CRON_SECRET` はSecret Managerと同じ値です。

```sh
printf 'CRON_SECRET: '; read -rs CRON_SECRET; echo
gcloud scheduler jobs create http zhuelog-line-drain \
  --location asia-northeast1 \
  --schedule '*/30 * * * *' \
  --time-zone Asia/Tokyo \
  --http-method GET \
  --uri "$URL/api/line/drain" \
  --headers "Authorization=Bearer $CRON_SECRET"
unset CRON_SECRET
```

`gcloud scheduler jobs run zhuelog-line-drain --location asia-northeast1` で手動実行し、Cloud Runのログに401が出ていないことを確認します。`CRON_SECRET` を変えたときは、Secret Managerとこのジョブのヘッダーの両方を更新してください。

## 確認

- `<AUTH_URL>/` を開くと `/signin` に移動し、ゲスト・GitHubでログインできる
- 学習ノート・日付別ログが表示される（DBに接続できている）
- LINEに短い文を送ると返信が届く

## ローカルでイメージを試す

`docker compose up -d` で開発用DBを起動し、マイグレーション済みの状態で実行します（Linuxの例）。

```sh
docker build -t zhuelog .
docker run --rm --network host -e PORT=8080 \
  -e DATABASE_URL='postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public' \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_URL=http://localhost:8080 \
  zhuelog
```

<http://localhost:8080> を開き、ゲストでログインできることを確認します。`--network host` を使うのは、開発用DBが `127.0.0.1` だけに公開されていて、`localhost` 以外の接続先には `sslmode=verify-full` が付くためです。`docker run --env-file .env` は値の引用符を取り除かないので使わないでください。
