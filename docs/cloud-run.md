# Cloud Runへのデプロイ

Vercelと同じアプリを、Google Cloud RunでもDockerコンテナとして動かせます。Vercelへのデプロイはこれまでどおりで、この手順はVercelの設定を変えません。

## Cloud Shellでまとめてデプロイする

### Web画面

[Cloud Shell](https://shell.cloud.google.com/)で次を実行します。課金を有効にしたGoogle Cloudプロジェクトが必要です。

```sh
git clone https://github.com/Sparklingstadt/ffpf-zhuelog.git
cd ffpf-zhuelog && ./scripts/deploy-cloud-run.sh
```

`scripts/deploy-cloud-run.sh` は、下の手順1・3（APIの有効化、Secret Managerへの登録、デプロイ、`AUTH_URL` の設定）を行います。`DATABASE_URL` などの秘密情報は、聞かれたときに入力します（画面には表示されません）。`AUTH_SECRET` は自動で作ります。GitHubのOAuth Appは最後に表示されるコールバックURLで作り、スクリプトをもう一度実行して設定します。それまではゲストとしてログインできます。登録済みの秘密情報はそのまま使い、空欄にした項目は今の値のままなので、何度実行しても構いません。

- LINEの設定は変えません（初回はLINE連携が無効の状態です）。Cloud Tasksも、LINE用なのでここでは設定しません。
- `DATABASE_URL` にVercelと同じDBを指定すると、VercelとCloud Runが同じデータを使います。マイグレーションは適用済みなので不要です。別のDBを使う場合は、先に手順2を行ってください。
- 実行中の操作では、既定のサービスアカウント（`<プロジェクト番号>-compute@developer.gserviceaccount.com`）に、ソースからのビルド権限（`roles/run.builder`）と、登録したシークレットの読み取り権限を付与します。

### LINE連携を移す

Web画面のデプロイ後に、Cloud Shellで次を実行します。

```sh
cd ffpf-zhuelog && git pull && ./scripts/enable-line-cloud-run.sh
```

`scripts/enable-line-cloud-run.sh` は、下の手順5と、手順3のLINE部分を行います。

- LINEのチャネルシークレット・チャネルアクセストークン・`OPENAI_API_KEY` を聞かれたら入力し、Secret Managerに登録します。値はVercelの環境変数、またはLINE Developersからコピーします。チャネルアクセストークンは再発行しないでください（Vercelで使っているトークンが無効になります）。
- `CRON_SECRET` は自動で作ります。公式アカウントのユーザーIDは、チャネルアクセストークンを使ってLINEのAPIから取得します。あなたのLINEユーザーIDだけを入力します。
- Cloud Tasksのキュー `zhuelog-line-drain` を作り、サービスアカウントにタスクを追加する権限（`roles/cloudtasks.enqueuer`）を付けます。
- サービスにLINEの設定とキュー名（`LINE_DRAIN_TASKS_QUEUE`）を加え、`--cpu-throttling`（リクエストベースの課金）にします。
- 以前のバージョンが作ったCloud Schedulerのジョブ `zhuelog-line-drain` があれば削除し（30分おきの拾い直しはVercel Cronが行います）、`/api/line/drain` が200を返すことを確認します。

最後に表示される手順に従って、手作業で切り替えます。

1. LINE DevelopersでWebhook URLを `<Cloud RunのURL>/api/line/webhook` に変え、「検証」を押す
2. 自分のLINEから文を送り、返信が届くことを確認する
3. Vercelの環境変数を次のようにして再デプロイする
   - `LINE_INTEGRATION_ENABLED` を `false`
   - `LINE_DRAIN_FORWARD_URL` を Cloud RunのURL（`https://zhuelog-xxxx.asia-northeast1.run.app`）
   - `CRON_SECRET` を Secret Managerの `zhuelog-CRON_SECRET` と同じ値（`gcloud secrets versions access latest --secret zhuelog-CRON_SECRET` で表示できます）

この順番なら、切り替えの間に届いたメッセージも取りこぼしません。LINEが無効な側はwebhookに503を返し、LINEが再送します。手順3までの間は、Vercel Cronは有効なVercel自身でジョブを処理します。ジョブはリース（2分）で排他しているので、VercelとCloud Runが同じDBを使っていても二重には処理しません。手順3のあとは、Vercel Cron（`vercel.json`、30分おき）の呼び出しを、VercelがCloud Runの `/api/line/drain` に取り次ぎます。`LINE_DRAIN_FORWARD_URL` を設定し忘れると、Vercelの `/api/line/drain` は503（`LINE_DISABLED`）を返し、取り残しは次のwebhookまで残ります。

このスクリプトの以前のバージョンでCloud Schedulerのジョブを作った場合は、スクリプトを実行し直すか、次のコマンドで削除してください（残すと30分おきの拾い直しが二重になります。害はありませんが、Cloud Runの起動が増えます）。

```sh
gcloud scheduler jobs delete zhuelog-line-drain --location asia-northeast1
```

手作業ですべて設定する場合は、以下の手順に従ってください。

## 仕組み

- ルートの `Dockerfile` で、Next.jsの `standalone` 出力（`.next/standalone/server.js`）を使う実行用イメージを作ります。`standalone` 出力はビルド時に `NEXT_OUTPUT=standalone` を指定したときだけ有効で、Vercelと E2E の `next start` は従来の出力のままです。
- 実行時は `node server.js` がポート `8080`（Cloud Runの `PORT`）で待ち受けます。イメージは非rootユーザー（`node`）で動き、書き込めるのはNext.jsのキャッシュ（`.next/cache`）だけです。
- イメージにはDBの接続先も秘密情報も含めません。すべて実行時の環境変数で渡します。マイグレーションも実行しません（下記）。

## Vercelとの違い

| 項目                     | Vercel                           | Cloud Run                                                                                          |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth.jsの公開URL         | 自動で判定                       | **`AUTH_URL` が必須**（例: `https://zhuelog-xxxx.asia-northeast1.run.app`）                        |
| LINEの取り残しを拾うCron | Vercel Cron（`vercel.json`）     | Vercel Cronの呼び出しを、Vercelが `LINE_DRAIN_FORWARD_URL` の `GET /api/line/drain` に取り次ぐ     |
| webhook後の処理          | `after()` で関数の中で続けて実行 | **Cloud Tasks** に `GET /api/line/drain` を頼み、別のリクエストとして処理する                      |
| `maxDuration`（60秒）    | 有効                             | 無視される。上限はCloud Runのリクエストタイムアウト（既定300秒）。LINE処理は独自に約50秒で打ち切る |

`AUTH_URL` を設定しないと、本番環境ではAuth.jsがホストを信頼せず、ログインが `UntrustedHost` で失敗します。設定すると、ログイン画面へのリダイレクト・OAuthのコールバックURL・CSPの `upgrade-insecure-requests` もこのURLを基準にします。

Cloud Runの既定（リクエストベースの課金）では、CPUはリクエストの処理中にしか割り当てられません。応答を返したあとに動く `after()` は極端に遅くなり、LINEの返信はCronが拾うまで遅れます。一方、`--no-cpu-throttling`（インスタンスベースの課金）にすると、インスタンスが起きている間ずっと課金されます。30分おきのCloud Schedulerで起きたインスタンスは15分ほど残るため、無料枠を超えて月に約18ドルかかりました。

そこで、`LINE_DRAIN_TASKS_QUEUE`（`projects/<プロジェクト>/locations/<リージョン>/queues/<キュー>`）を設定したサービスでは、webhookは処理待ちを保存したあと、Cloud Tasksに「`AUTH_URL` の `/api/line/drain` を `CRON_SECRET` 付きで呼ぶ」タスクを追加してから200を返します。添削・翻訳はCloud Tasksからのリクエストの中で動くので、CPUはその間だけ使われ、課金もその間だけです。タスクの追加にはメタデータサーバーから取るサービスアカウントのトークンを使うので、新しい秘密情報はいりません。追加に失敗したときは `after()` で試し、残りはVercel Cron（Vercelからの取り次ぎ）が拾います。LINEはwebhookの応答を2秒しか待たないため、webhookの中で添削を終えることはできません。

## 前提

- Google Cloudのプロジェクトと `gcloud` CLI（`gcloud auth login` 済み）
- 外部からつながるPostgreSQL（現在のNeonをそのまま使えます。`localhost` 以外への接続は `sslmode=verify-full` で証明書を検証します）
- 以下ではリージョンを `asia-northeast1`（東京）、サービス名を `zhuelog` とします。

```sh
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudtasks.googleapis.com
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
  --max-instances 1 \
  --set-env-vars "AUTH_GITHUB_ID=<OAuth AppのClient ID>,AUTH_ALLOWED_GITHUB_LOGINS=<ログイン名>,OPENAI_MODEL=gpt-6.1-sol,LINE_INTEGRATION_ENABLED=true,LINE_BOT_USER_ID=<U...>,LINE_ALLOWED_USER_ID=<U...>,LINE_NOTE_OWNER_ID=<持ち主ID>" \
  --set-secrets "DATABASE_URL=zhuelog-DATABASE_URL:latest,AUTH_SECRET=zhuelog-AUTH_SECRET:latest,AUTH_GITHUB_SECRET=zhuelog-AUTH_GITHUB_SECRET:latest,OPENAI_API_KEY=zhuelog-OPENAI_API_KEY:latest,LINE_CHANNEL_SECRET=zhuelog-LINE_CHANNEL_SECRET:latest,LINE_CHANNEL_ACCESS_TOKEN=zhuelog-LINE_CHANNEL_ACCESS_TOKEN:latest,CRON_SECRET=zhuelog-CRON_SECRET:latest"
```

- `--allow-unauthenticated`: ブラウザー・LINEのwebhook・Cloud Tasks・Vercel（Cronの取り次ぎ）から直接呼ぶため、Cloud Run側のIAM認証は使いません。認証・認可はアプリ（Auth.js、LINEの署名、`CRON_SECRET`）が行います。
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

## 5. Vercel Cronから取り次ぐ

30分おきの拾い直し（間隔の理由は [`line-integration.md`](line-integration.md) を参照）はVercel Cronが行います。Vercel Cronは自分のデプロイのURLしか呼べないので、LINEを無効にしたVercelの `/api/line/drain` が、受け取った呼び出しをCloud Runの `/api/line/drain` に取り次ぎます。Vercelの環境変数に次を設定して再デプロイします。

| 変数                       | 値                                               |
| -------------------------- | ------------------------------------------------ |
| `LINE_INTEGRATION_ENABLED` | `false`                                          |
| `LINE_DRAIN_FORWARD_URL`   | `AUTH_URL` と同じCloud RunのURL（`https:` のみ） |
| `CRON_SECRET`              | Secret Managerの `zhuelog-CRON_SECRET` と同じ値  |

Vercelの「Cron Jobs」画面から `/api/line/drain` を手動で実行し、Vercelのログに `LINE_DRAIN_FORWARD_FAILED` が出ていないこと、Cloud Runのログに200の `GET /api/line/drain` があることを確認します。`LINE_DRAIN_FORWARD_FAILED 401` は、VercelとCloud Runの `CRON_SECRET` が違うことを示します。`CRON_SECRET` を変えたときは、Secret Manager（とCloud Runの再デプロイ）とVercelの両方を更新してください。

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
