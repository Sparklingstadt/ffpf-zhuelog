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

- `DATABASE_URL` にVercelと同じDBを指定すると、VercelとCloud Runが同じデータを使います。マイグレーションは適用済みなので不要です。別のDBを使う場合は、先に手順2を行ってください。
- 実行中の操作では、既定のサービスアカウント（`<プロジェクト番号>-compute@developer.gserviceaccount.com`）に、ソースからのビルド権限（`roles/run.builder`）と、登録したシークレットの読み取り権限を付与します。

手作業ですべて設定する場合は、以下の手順に従ってください。

## 仕組み

- ルートの `Dockerfile` で、Next.jsの `standalone` 出力（`.next/standalone/server.js`）を使う実行用イメージを作ります。`standalone` 出力はビルド時に `NEXT_OUTPUT=standalone` を指定したときだけ有効で、Vercelと E2E の `next start` は従来の出力のままです。
- 実行時は `node server.js` がポート `8080`（Cloud Runの `PORT`）で待ち受けます。イメージは非rootユーザー（`node`）で動き、書き込めるのはNext.jsのキャッシュ（`.next/cache`）だけです。
- イメージにはDBの接続先も秘密情報も含めません。すべて実行時の環境変数で渡します。マイグレーションも実行しません（下記）。

## Vercelとの違い

| 項目             | Vercel     | Cloud Run                                                                   |
| ---------------- | ---------- | --------------------------------------------------------------------------- |
| Auth.jsの公開URL | 自動で判定 | **`AUTH_URL` が必須**（例: `https://zhuelog-xxxx.asia-northeast1.run.app`） |

`AUTH_URL` を設定しないと、本番環境ではAuth.jsがホストを信頼せず、ログインが `UntrustedHost` で失敗します。設定すると、ログイン画面へのリダイレクト・OAuthのコールバックURL・CSPの `upgrade-insecure-requests` もこのURLを基準にします。

## 前提

- Google Cloudのプロジェクトと `gcloud` CLI（`gcloud auth login` 済み）
- 外部からつながるPostgreSQL（現在のNeonをそのまま使えます。`localhost` 以外への接続は `sslmode=verify-full` で証明書を検証します）
- 以下ではリージョンを `asia-northeast1`（東京）、サービス名を `zhuelog` とします。

```sh
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com
```

## 1. 秘密情報をSecret Managerに登録する

秘密の値はコマンドの引数に書かず、標準入力から登録します（シェルの履歴に残さないため）。

```sh
for name in DATABASE_URL AUTH_SECRET AUTH_GITHUB_SECRET; do
  printf '%s の値: ' "$name"; read -rs value; echo
  printf '%s' "$value" | gcloud secrets create "zhuelog-$name" --data-file=-
done
```

Cloud Runの実行サービスアカウント（既定は `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`）に、各シークレットの「Secret Managerのシークレットアクセサー」（`roles/secretmanager.secretAccessor`）を付与してください。

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
  --set-env-vars "AUTH_GITHUB_ID=<OAuth AppのClient ID>,AUTH_ALLOWED_GITHUB_LOGINS=<ログイン名>" \
  --set-secrets "DATABASE_URL=zhuelog-DATABASE_URL:latest,AUTH_SECRET=zhuelog-AUTH_SECRET:latest,AUTH_GITHUB_SECRET=zhuelog-AUTH_GITHUB_SECRET:latest"
```

- `--allow-unauthenticated`: ブラウザーから直接開くため、Cloud Run側のIAM認証は使いません。認証・認可はアプリ（Auth.js）が行います。
- `--max-instances 1`: 費用を抑えるための上限です。増やしてもアプリは動きます。

最初のデプロイが終わったら、サービスのURLを `AUTH_URL` に設定します。

```sh
URL=$(gcloud run services describe zhuelog --region asia-northeast1 --format='value(status.url)')
gcloud run services update zhuelog --region asia-northeast1 --update-env-vars "AUTH_URL=$URL"
```

独自ドメインを割り当てる場合は、`AUTH_URL` をそのドメインのURLにします。

## 4. GitHub OAuth AppのURLを切り替える

- **GitHub OAuth App**: Authorization callback URLを `<AUTH_URL>/api/auth/callback/github` にします。Vercelと並行して動かす間は、Cloud Run専用のOAuth Appを作ってください（OAuth Appのコールバックは1つです）。

## 確認

- `<AUTH_URL>/` を開くと `/signin` に移動し、ゲスト・GitHubでログインできる
- 学習ノート・日付別ログが表示される（DBに接続できている）

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
