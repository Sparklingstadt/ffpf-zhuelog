# ローカルで動かす

::: tip 元の文書
このページは `docs/api-local.md` を元にしています。手順が変わったときは、そちらと合わせて直してください。
:::

Go API を、手元の Mac の上だけで動かして試すための手順です。本番の Neon や Vercel には一切つながりません。段階 11 からは、Go に残るのは health のルート（`/health`・`/healthz`・`/ping`）だけです。

必要なもの: Docker、Go（`services/api/go.mod` の版）、pnpm（`pnpm install` 済み）、`curl` と `jq`。

## 1. 起動

```bash
pnpm run api:db
```

API 専用の Postgres を `127.0.0.1:55440` で起動し（`compose.api.yaml`）、マイグレーションを適用して、サンプルデータを入れます。何度実行しても重複しません。

```bash
pnpm run api:dev
```

API を `http://127.0.0.1:8081` で起動します（`go run`、Ctrl+C で停止）。設定はすべて `scripts/api-local-env.sh` のローカル専用の値で、`.env` には何も書きません。

API はコンテナではなく手元で動かします。API は DB の接続先が `localhost` 以外だと TLS の証明書の検証を必須にするので（Web と同じ）、コンテナから DB へつなぐと失敗するためです。

## 2. 一通り試す

API を起動したまま、別のターミナルで実行します。

```bash
pnpm run api:smoke
```

`GET /health` と `GET /ping` が `200`、`POST /v1/auth/password` が `404`（ログインは段階 11 で Web に移りました）であることを確かめ、想定と違うステータスが返ったところで止まります。

## サンプルのデータ

`scripts/api-local-seed.ts` は、ローカル専用のテスト用の会員と共有済みのエントリーを作ります。Web のログイン画面の「ID とパスワード」でも使えます（`.env` の `DATABASE_URL` をこの DB にしたとき。Go は要りません）。Go のログインのためのものでしたが、段階 11 から Go は使いません。Go は health だけです。

LINE とデモのリセットは Web（段階 10）が受け持ち、Go にはもうありません。LINE 連携はローカルでは使えません（本物の LINE のチャネルと OpenAI の API キーが要るため）。Web に LINE の環境変数が無いと、「LINE 連携」画面（`/account/line`）には「LINE 連携は今は使えません。」と出ます。e2e は偽の LINE API（`e2e/line-stub.ts`）で確かめます。

## curl で試す例

```bash
source scripts/api-local-env.sh
curl -s "$API_LOCAL_URL/health" | jq
```

## 片付け

```bash
pnpm run api:db:stop
```

DB を止めます。データは残るので、次の `pnpm run api:db` でそのまま使えます。データも消すときは `pnpm run api:db:stop -- -v` です。

## ドキュメントサイトを動かす

このサイト自体は VuePress で作っています（`docs-site/`）。

```bash
pnpm run api-docs:dev
```

`http://localhost:8080` で開発用のサーバーを起動します（ポートが使われていれば別の番号になります。起動時の表示を見てください）。Markdown を直すとすぐに反映されます。

```bash
pnpm run api-docs:build
```

静的なサイトを `docs-site/.vuepress/dist/` に出力します。
