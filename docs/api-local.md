# Go API（`services/api`）をローカルで試す

ネイティブアプリ向けの Go API を、この Mac の上だけで動かして試すための手順です。本番の Neon や Vercel には一切つながりません。

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

ログイン、エントリーの作成・一覧・詳細・編集、共有と解除、会員一覧、フォロー・タイムライン・解除、ゴミ箱への移動・一覧・復元・完全削除、リフレッシュ、ログアウトを順に呼び、想定と違うステータスが返ったところで止まります。

## サンプルのアカウント

`scripts/api-local-seed.ts` が作る、ローカル専用のテスト用アカウントです。

| loginId  | パスワード            | 内容                                |
| -------- | --------------------- | ----------------------------------- |
| `demo`   | `demo-password-123`   | 試すときに使う会員                  |
| `friend` | `friend-password-123` | 共有済みのエントリーを 2 件持つ会員 |

GitHub ログイン（`POST /v1/auth/github`）は本物の OAuth App が必要なので、ローカルでは使えません。パスワードログインで試してください。

LINE 連携も、ローカルでは使えません。本物の LINE のチャネルと OpenAI の API キーが要るためです。`scripts/api-local-env.sh` は LINE の環境変数を設定しないので、`/v1/line/*` のルート（5 つ）は `404` になります。Web の「LINE 連携」画面（`/account/line`）には、「LINE 連携は今は使えません。」と出ます。

ダミーの LINE 設定でコード発行画面を確認する場合は、Web の `.env.local` に `LINE_LINK_PREVIEW_MODE="true"` を設定してください。本番ボットへ送る QR とボタンを隠し、表示確認用であることを明示します。ローカル DB で発行したコードは本番の LINE ボットには登録されないため、本番での連携には本番画面で発行したコードを使います。

## curl で試す例

```bash
source scripts/api-local-env.sh
TOKEN=$(curl -s -X POST "$API_LOCAL_URL/v1/auth/password" \
  -H 'Content-Type: application/json' \
  -d '{"loginId":"demo","password":"demo-password-123"}' | jq -r .accessToken)

curl -s "$API_LOCAL_URL/v1/entries?limit=5" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API_LOCAL_URL/v1/members" -H "Authorization: Bearer $TOKEN" | jq
```

アクセストークンの有効期限は 15 分です。切れたら `POST /v1/auth/refresh` か、もう一度ログインしてください。`/v1/auth/*` には IP ごとに 1 分 10 回の制限があります。パスワードログインはさらに、15 分のあいだに同じ IP から 20 回まで、同じ IP から同じ loginId へは 5 回まで（成功すると 0 に戻ります）で、超えると `429` が返ります。止まったときは 15 分待ってください。

`GET /v1/members` は会員の `ownerId`・`displayName`・フォローの状態だけを返し、loginId は返しません（ログインに使う ID を他の会員に見せないため）。

## 片付け

```bash
pnpm run api:db:stop
```

DB を止めます。データは残るので、次の `pnpm run api:db` でそのまま使えます。データも消すときは `pnpm run api:db:stop -- -v` です。
