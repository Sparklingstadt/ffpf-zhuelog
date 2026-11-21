# ローカルのサンプル DB と Go API（`services/api`）

手元の Mac の上だけで動く、サンプルの会員が入った DB と、Go API を試すための手順です。本番の Neon や Vercel には一切つながりません。

**段階 11b から、Web のログインに Go は要りません。** ログインとログアウトは Web が行い、`Session` の行を DB に書きます。Go に残るのは `/health`・`/healthz`・`/ping` だけで、段階 12 で消します。手元で Web にログインしたいだけなら、Go を起動する必要はありません（`pnpm run api:dev` は要りません）。

必要なもの: Docker、pnpm（`pnpm install` 済み）。Go を起動して試すときは、さらに Go（`services/api/go.mod` の版）と `curl` が要ります。

## 1. サンプルの DB を起動する

```bash
pnpm run api:db
```

専用の Postgres を `127.0.0.1:55440` で起動し（`compose.api.yaml`）、マイグレーションを適用して、サンプルの会員を入れます。何度実行しても重複しません。名前に `api` が付いていますが、Web のログインにも使えます。

Web からこの DB を使うには、`.env` の `DATABASE_URL` を `scripts/api-local-env.sh` の `API_LOCAL_DATABASE_URL` と同じ値にします（[docs/development.md](development.md) の「起動方法」）。

## 2. Go を試す（任意）

```bash
pnpm run api:dev
```

Go API を `http://127.0.0.1:8081` で起動します（`go run`、Ctrl+C で停止）。設定は `scripts/api-local-env.sh` のローカル専用の値で、`.env` には何も書きません。Go が読むのは `PORT` と `DATABASE_URL` だけです。

Go はコンテナではなく手元で動かします。Go は DB の接続先が `localhost` 以外だと TLS の証明書の検証を必須にするので（Web と同じ）、コンテナから DB へつなぐと失敗するためです。

起動したまま、別のターミナルで実行します。

```bash
pnpm run api:smoke
```

`GET /health` と `GET /ping` が `200`、`POST /v1/auth/password` が `404`（ログインは Web に移りました）であることを確かめ、想定と違うステータスが返ったところで止まります。

```bash
source scripts/api-local-env.sh
curl -s "$API_LOCAL_URL/health"
```

## サンプルのアカウント

`scripts/api-local-seed.ts` が作る、ローカル専用のテスト用アカウントです。Web のログイン画面の「ID とパスワード」で使えます（`.env` の `DATABASE_URL` を上の DB にしたとき）。

| loginId  | パスワード            | 内容                                |
| -------- | --------------------- | ----------------------------------- |
| `demo`   | `demo-password-123`   | 試すときに使う会員                  |
| `friend` | `friend-password-123` | 共有済みのエントリーを 2 件持つ会員 |

GitHub ログインは本物の OAuth App が要るので、ローカルでは使えません。パスワードログインかゲストで試してください。FFPF ID も、portal が要るので、普段は使いません（試すときは [docs/development.md](development.md) の「FFPF ID でのログイン」）。

LINE 連携も、ローカルでは使えません。本物の LINE のチャネルと OpenAI の API キーが要るためです。e2e は偽の LINE API（`e2e/line-stub.ts`）で確かめます。LINE の受け口と「LINE 連携」画面（`/account/line`）は Web が受け持ち（段階 10a）、Go には LINE のルートはありません（段階 10b で消しました）。Web に LINE の環境変数が無いと、画面には「LINE 連携は今は使えません。」と出ます。

ダミーの LINE 設定でコード発行画面を確認する場合は、Web の `.env.local` に `LINE_LINK_PREVIEW_MODE="true"` を設定してください。本番ボットへ送る QR とボタンを隠し、表示確認用であることを明示します。ローカル DB で発行したコードは本番の LINE ボットには登録されないため、本番での連携には本番画面で発行したコードを使います。

## 片付け

```bash
pnpm run api:db:stop
```

DB を止めます。データは残るので、次の `pnpm run api:db` でそのまま使えます。データも消すときは `pnpm run api:db:stop -- -v` です。
