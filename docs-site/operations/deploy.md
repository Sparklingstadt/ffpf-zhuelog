# Vercel へのデプロイ

::: tip 元の文書
このページは `docs/api-deployment.md` を元にしています。手順が変わったときは、そちらと合わせて直してください。
:::

ネイティブアプリ向けの Go API を、Vercel へデプロイするための準備と手順です。Web（Next.js）とは **別の Vercel プロジェクト** として、同じリポジトリの `services/api` をデプロイします。仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` と `docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md` にあります。

Vercel の Go の Framework Preset は、`services/api` の `go.mod` と `main.go` を見つけて、普通の `net/http` サーバーとして動かします（Fluid compute）。設定は `services/api/vercel.json`（`"framework": "go"`）にあります。Go の実行は Vercel では Beta です。

Vercel の準備とモバイル用 GitHub OAuth App の登録は、リポジトリの管理者が手作業で 1 回だけ行います。以後は Vercel の Git 連携で、main へのマージが本番、PR がプレビューにデプロイされます。

## 1. モバイル用 GitHub OAuth App の登録

Web 用とは別の OAuth App を新しく作ります。GitHub の **Settings → Developer settings → OAuth Apps → New OAuth App** で登録します。

- Application name: 任意（例: `学习録 mobile`）
- Homepage URL: Web の本番 URL
- Authorization callback URL: アプリのカスタム URL スキーム（例: `yourapp://oauth/callback`）

控える値は Client ID と Client Secret の 2 つです（手順 3 で使います）。カスタム URL スキームは `GITHUB_MOBILE_REDIRECT_URI` にも同じ値を設定します。Go API は、リクエストの `redirectUri` がこの値と完全一致することを要求します。

## 2. Vercel プロジェクトを作る

1. Vercel のダッシュボードで **Add New… → Project** を選び、このリポジトリ（`Sparklingstadt/ffpf-zhuelog`）を Import します。Web のプロジェクトとは別に、新しいプロジェクト（例: `zhuelog-api`）を作ります。
2. **Root Directory** に `services/api` を指定します。
3. **Framework Preset** が `Go` になっていることを確かめます（`services/api/vercel.json` でも指定しています）。
4. **Settings → Git → Ignored Build Step** に次を設定し、`services/api/` に変更が無いコミットではビルドを飛ばします（Root Directory が `services/api` なので、`.` がこのディレクトリを指します）。

   ```bash
   git diff --quiet HEAD^ HEAD -- .
   ```

## 3. 環境変数

**Settings → Environment Variables** に設定します。`PORT` は Vercel が設定するので不要です。

| 名前                          | 内容                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）。`?schema=` は付けない                              |
| `API_JWT_SECRET`              | アクセス JWT の HS256 鍵。`openssl rand -base64 48` で作る（32 バイト以上）。Auth.js の `AUTH_SECRET` とは別の値 |
| `GITHUB_MOBILE_CLIENT_ID`     | モバイル用 GitHub OAuth App の Client ID                                                                         |
| `GITHUB_MOBILE_CLIENT_SECRET` | モバイル用 GitHub OAuth App の Client Secret                                                                     |
| `GITHUB_MOBILE_REDIRECT_URI`  | アプリのカスタム URL スキーム                                                                                    |
| `AUTH_ALLOWED_GITHUB_IDS`     | admin の許可リスト。GitHub の数値 ID をカンマ区切りで（Web と同じ値）                                            |

**Production と Preview で値を分けてください。** PR ごとのプレビューのデプロイが本番の DB を書き換えないよう、Preview の `DATABASE_URL` には本番の接続文字列を入れず、Neon のブランチなど別の DB を指定します。Preview に `DATABASE_URL` を入れない場合、プレビューのデプロイは起動時に止まります（必須の値が無いため）。

DB への接続は、Web と同じく TLS で証明書まで検証します。ホストが `localhost`・`127.0.0.1`・`::1` 以外のとき（または `sslmode` が `prefer`・`require`・`verify-ca` のとき）、Go API は `sslmode` を `verify-full` に置き換えます。Neon の接続文字列の `sslmode=require` はそのままで構いません。`?schema=public` は無視しますが、それ以外のスキーマは `search_path` の起動パラメータになり、プーラーに拒否されることがあるので付けないでください。

## 4. 本番の DB の確認

Go API が使うテーブルは、Prisma のマイグレーションで本番の Neon に適用済みです（`ApiRefreshToken`、`SignInThrottle` など）。今後スキーマを変えるときは、main へマージする前に本番へ適用します（main は Web と Go API の両方の本番へ自動でデプロイされるため）。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

会員一覧（`GET /v1/members`）は、DB の日本語の照合順序 `ja-x-icu` で並べます。本番の Neon にあるかを一度確かめてください（1 行返れば問題ありません。無いと会員一覧が `500` になります）。

```sql
SELECT 1 FROM pg_collation WHERE collname = 'ja-x-icu';
```

## 5. デプロイと確認

main にマージすると本番にデプロイされます（`services/api/` に変更がある場合）。初回や変更が無いときは、ダッシュボードの **Deployments → Redeploy** で実行します。

```bash
curl -i https://<プロジェクト>.vercel.app/health
```

`200` が返れば、DB への接続まで確認できています（失敗時は `503`）。`/ping` は DB にアクセスせずに `200` を返します。アプリからのログインは `POST /v1/auth/password` か `POST /v1/auth/github` で確認します。

## 運用上の注意

### 本文の上限と CSV

Vercel の関数は、要求と応答の本文がそれぞれ **4.5 MB まで** です（設定やプランでは上げられません）。そのため CSV のインポートは **4 MiB まで** にしています（Web も同じ）。`POST /v1/imports/csv` だけ本文の上限を 4 MiB + 256 KiB に広げ、ほかのルートは 1 MiB です。

サーバー全体の読み取り・書き込みのタイムアウトは 30 秒ですが、CSV のアップロードだけは認証を通った後に 4 分まで延ばします（Vercel の関数の最大実行時間より短くしています）。

### `API_JWT_SECRET` のローテーション

ローテーションすると、**発行済みのアクセストークンはすべて無効になります**（署名が合わなくなるため）。リフレッシュトークンは DB のハッシュで検証するので影響を受けず、アプリは `POST /v1/auth/refresh` で新しいアクセストークンを取り直せます。新しい値を環境変数に設定し、再デプロイすると反映されます。入れ替えの途中は、古いインスタンスと新しいインスタンスが短い時間並んで動くため、古い鍵と新しい鍵のトークンが一時的に混在します。

### レート制限と `X-Forwarded-For`

`/v1/auth/*` には 2 種類の制限があります。

- **IP ごとのレート制限**: インスタンスのメモリ上で数え、1 分に 10 回までです。Vercel はインスタンスを自動で増やすので、インスタンスが複数あるときは合計でこれより多く通ることがあります。
- **パスワードログインの試行回数**: DB の `SignInThrottle` テーブルで数えます。Web と同じテーブル・同じキーを使います。15 分の枠で、1 つのクライアントからのパスワードログインは 20 回まで、同じクライアントから同じ loginId へは 5 回まで（成功すると 0 に戻ります）。超えると `429`（`rate_limited`）を返します。

どちらも、クライアントのアドレスには `X-Forwarded-For` の **最後の値** を使います。Vercel はこのヘッダーをクライアントの IP で上書きし、クライアントが送った値は渡さないので、偽装されません。**Vercel の前に別のプロキシ（CDN など）を置かないでください。** 置くと、すべてのクライアントがそのプロキシの 1 つのアドレスとして数えられます。

### DB の接続数とパスワードの計算

Go API は 1 つのインスタンスあたり最大 3 本の DB 接続を持ちます。Vercel がインスタンスを増やすと接続数も増えるので、Neon の pooled 接続文字列を使ってください。

パスワードの検証（scrypt、N=2^15・r=8）は 1 回ごとに 32 MiB を使うため、インスタンスごとに同時に 4 件までしか計算しません（5 件目以降は空くまで待ちます）。

### 公開範囲

エンドポイントはインターネットに公開します。アプリから直接呼ぶ API で、認証はアプリ層（アクセス JWT）で行うためです。CORS は設定していません（ブラウザから直接は呼びません）。
