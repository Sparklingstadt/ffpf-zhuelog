# Vercel へのデプロイ

::: tip 元の文書
このページは `docs/api-deployment.md` を元にしています。手順が変わったときは、そちらと合わせて直してください。
:::

Go API を、Vercel へデプロイするための準備と手順です。Go API は、ネイティブアプリと Web（Next.js）の両方が使います。Web（Next.js）とは **別の Vercel プロジェクト** として、同じリポジトリの `services/api` をデプロイします。仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` と `docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md` にあります。

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
4. **Settings → Git → Ignored Build Step** に次を設定し、`services/api/` に変更が無いときはビルドを飛ばします（Root Directory が `services/api` なので、`.` がこのディレクトリを指します）。前回デプロイしたコミット（`VERCEL_GIT_PREVIOUS_SHA`）から今回までをまとめて比べるので、1 回の push に複数のコミットがあっても、途中のコミットの変更を見落としません（前回のデプロイが無いときは直前のコミットと比べます）。

   ```bash
   git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .
   ```

## 3. 環境変数

**Settings → Environment Variables** に設定します。`PORT` は Vercel が設定するので不要です。

| 名前                          | 内容                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）。`?schema=` は付けない            |
| `API_JWT_SECRET`              | アクセス JWT の HS256 鍵。`openssl rand -base64 48` で作る（32 バイト以上）                    |
| `GITHUB_MOBILE_CLIENT_ID`     | モバイル用 GitHub OAuth App の Client ID                                                       |
| `GITHUB_MOBILE_CLIENT_SECRET` | モバイル用 GitHub OAuth App の Client Secret                                                   |
| `GITHUB_MOBILE_REDIRECT_URI`  | アプリのカスタム URL スキーム                                                                  |
| `AUTH_ALLOWED_GITHUB_IDS`     | admin の許可リスト。GitHub の数値 ID をカンマ区切りで（Go API だけに設定します）               |
| `GITHUB_WEB_CLIENT_ID`        | Web 用 GitHub OAuth App の Client ID（Web の GitHub ログインに必要。下の注を参照）             |
| `GITHUB_WEB_CLIENT_SECRET`    | Web 用 GitHub OAuth App の Client Secret                                                       |
| `GITHUB_WEB_REDIRECT_URI`     | `https://<Web のホスト>/api/auth/callback/github/go`                                           |
| `API_WEB_PROXY_SECRET`        | Web サーバーと共有する秘密。32 バイト以上（`openssl rand -base64 48`）。Web から使うときは必要 |

**Production と Preview で値を分けてください。**

- PR ごとのプレビューのデプロイが本番の DB を書き換えないよう、Preview の `DATABASE_URL` には本番の接続文字列を入れず、Neon のブランチなど別の DB を指定します。
- Preview の `API_JWT_SECRET` は、本番とは **別の値** にします。同じ値だと、プレビューのデプロイが発行したアクセストークンが本番でもそのまま通り、本番で他人のデータを読み書きできてしまうためです。
- Preview で GitHub ログインを試すなら、本番とは別のモバイル用 OAuth App（と Client Secret）を使います。Preview に `DATABASE_URL` を入れない場合、プレビューのデプロイは起動時に止まります（必須の値が無いため）。
- `GITHUB_WEB_*` の 3 つは **すべて設定するか、すべて空** にします（一部だけだと起動時に止まります）。Go API は `POST /v1/auth/github` の `redirectUri` が `GITHUB_WEB_REDIRECT_URI` と完全一致したときは Web 用の OAuth App で、`GITHUB_MOBILE_REDIRECT_URI` と一致したときはモバイル用で `code` を交換します。どちらとも一致しなければ `401` です。
- `GITHUB_WEB_*` と `API_WEB_PROXY_SECRET` は、Go API の起動には要りません。ただし Web は Go API でログインするので、Web から使うときは必要です。
- Web 用の OAuth App は、以前から Web で使っているものをそのまま使えます。GitHub は登録した callback URL の **下の階層** を `redirect_uri` に使えるので、Web の callback（`https://<Web>/api/auth/callback/github/go`）は登録済みの callback（`/api/auth/callback/github`）の下になり、OAuth App の設定を変える必要はありません。
- `API_WEB_PROXY_SECRET` は、Web（Next.js）が利用者の IP を渡すための共有の秘密です。使い方は [レート制限とクライアントの IP](#レート制限とクライアントの-ip) を見てください。空のときは `X-Zhuelog-Client-IP` を常に無視します。
- `API_WEB_PROXY_SECRET` も `API_JWT_SECRET` と同じく、Production と Preview で **別の値** にします。同じだと、プレビューの Web が本番の Go API に任意の IP を名乗れてしまいます。

DB への接続は、TLS で証明書まで検証します。ホストが `localhost`・`127.0.0.1`・`::1` 以外のとき（または `sslmode` が `prefer`・`require`・`verify-ca` のとき）、Go API は `sslmode` を `verify-full` に置き換えます。Neon の接続文字列の `sslmode=require` はそのままで構いません。`?schema=public` は無視しますが、それ以外のスキーマは `search_path` の起動パラメータになり、プーラーに拒否されることがあるので付けないでください。

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

## 6. Web の設定

Web（Next.js）は、ログインも学習ノートの読み書きも Go API で行います。DB には直接つながりません。仕様は `docs/superpowers/specs/2026-10-21-web-auth-via-go-api-design.md` と `docs/superpowers/specs/2026-10-22-web-data-via-go-api-design.md` にあります。

Go API の Vercel プロジェクトには、`GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`・`API_WEB_PROXY_SECRET` を入れておきます（上の「3. 環境変数」の表）。Web の Vercel プロジェクトに入れる値は、次の 4 つです。

| 名前                   | 内容                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `GO_API_URL`           | Go API の URL（例: `https://<プロジェクト>.vercel.app`）。末尾の `/` は不要 |
| `API_WEB_PROXY_SECRET` | Go API と **同じ値**                                                        |
| `AUTH_URL`             | Web の公開されている origin（例: `https://<Web のホスト>`）                 |
| `AUTH_GITHUB_ID`       | Go API の `GITHUB_WEB_CLIENT_ID` と **同じ OAuth App** の Client ID         |

注意:

- `GO_API_URL` は `https://` にします（`http://` は `localhost` と `127.0.0.1` だけ使えます）。4 つのどれかが無いと、Web はログインできません。
- `AUTH_URL` は必ず設定し、利用者が開く Web の origin と同じにします。GitHub ログインの `redirect_uri` は、この origin から作ります。
- Go API の `GITHUB_WEB_REDIRECT_URI` は、`<AUTH_URL の origin>/api/auth/callback/github/go` と **1 文字も違わず** 同じにします。違うと Go API が `401` を返し、GitHub ログインができません。そのため、URL が合わないプレビューのデプロイでは GitHub ログインは使えません（パスワードとゲストのログインは使えます）。
- `AUTH_GITHUB_ID` と `GITHUB_WEB_CLIENT_ID` が別の OAuth App だと、GitHub が発行した `code` を Go API が交換できず、GitHub ログインが失敗します。
- `AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` は、Web では使いません。`DATABASE_URL` も Web の実行とビルドには要りません。ただし、マイグレーションの手順（`vercel env pull`）で本番の `DATABASE_URL` を取るのに使うので、Web のプロジェクトに残しておいて構いません。

### 段階3のマージの前に行うこと

段階3（Web のデータを Go API で読み書きする変更）をマージすると、Web から Auth.js と DB への接続が無くなります。Go API が無いと、Web は動きません。そのため、**マージの前に** 次を済ませてください。

1. Go API の Vercel プロジェクトを作り（上の 1.〜5.）、`/health` が `200` を返すことを確かめます。
2. Go API に `GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`・`API_WEB_PROXY_SECRET` を入れ、再デプロイします。
3. 本番の Web の Vercel プロジェクトに、上の表の 4 つ（`GO_API_URL` など）を入れ、再デプロイします。今の main の Web は、`GO_API_URL` があるとログインを Go API で行います。
4. 本番の Web で、GitHub・パスワード・ゲストのログインと、ログアウトができることを確かめます。切り替えると Auth.js の Cookie は使われなくなるので、**全員が一度ログインし直し** になります。
5. 確かめられたら、段階3をマージします。

`DATABASE_URL`・`AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` は、段階3が本番で問題なく動くまで Web に残しておきます（下の「戻す手順」で使います）。

### 戻す手順

段階3のあとは、Auth.js に切り替える設定はありません。戻すときは、段階3のマージを取り消し（revert し）、Web を再デプロイします。取り消した後の Web は、学習ノートを DB から直接読み書きするので、Web に `DATABASE_URL` が要ります。ログインは、`GO_API_URL` があるうちは Go API のままです。Auth.js のログインまで戻すときは、さらに Web から `GO_API_URL` を消して再デプロイします。このとき `AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` も要り、全員がログインし直しになります。

## 運用上の注意

### 本文の上限と CSV

Vercel の関数は、要求と応答の本文がそれぞれ **4.5 MB まで** です（設定やプランでは上げられません）。そのため CSV のインポートは **4 MiB まで** にしています（Web の画面も同じ上限です）。`POST /v1/imports/csv` だけ本文の上限を 4 MiB + 256 KiB に広げ、ほかのルートは 1 MiB です。

サーバー全体の読み取り・書き込みのタイムアウトは 30 秒ですが、CSV のアップロードだけは認証を通った後に 4 分まで延ばします（Vercel の関数の最大実行時間より短くしています）。

### `API_JWT_SECRET` のローテーション

ローテーションすると、**発行済みのアクセストークンはすべて無効になります**（署名が合わなくなるため）。リフレッシュトークンは DB のハッシュで検証するので影響を受けず、アプリは `POST /v1/auth/refresh` で新しいアクセストークンを取り直せます。新しい値を環境変数に設定し、再デプロイすると反映されます。入れ替えの途中は、古いインスタンスと新しいインスタンスが短い時間並んで動くため、古い鍵と新しい鍵のトークンが一時的に混在します。

### レート制限とクライアントの IP

`/v1/auth/*` には 2 種類の制限があります。

- **IP ごとのレート制限**: インスタンスのメモリ上で数え、1 分に 10 回までです。Vercel はインスタンスを自動で増やすので、インスタンスが複数あるときは合計でこれより多く通ることがあります。
- **パスワードログインの試行回数**: DB の `SignInThrottle` テーブルで数えます。Web からのログインも Go API を通るので、Web とアプリの試行は合わせて数えます。15 分の枠で、1 つのクライアントからのパスワードログインは 20 回まで、同じクライアントから同じ loginId へは 5 回まで（成功すると 0 に戻ります）。超えると `429`（`rate_limited`）を返します。

どちらも、クライアントのアドレスには、次の順で決まる値を使います。

1. `X-Zhuelog-Proxy-Secret` ヘッダーが `API_WEB_PROXY_SECRET` と一致し（定数時間で比べます）、`X-Zhuelog-Client-IP` が空でなければ、その値。Web（Next.js）から Go API を呼ぶと、Go API から見た送信元は Vercel の関数になり、全員が 1 つの IP として数えられてしまいます。そこで Web が利用者の IP を `X-Zhuelog-Client-IP` で渡します。秘密が一致しないとき、`API_WEB_PROXY_SECRET` が未設定のときは、このヘッダーを常に無視します。
2. そうでなければ、`X-Forwarded-For` の **最後の値**（無ければ接続元のアドレス）。Vercel はこのヘッダーをクライアントの IP で上書きし、クライアントが送った値は渡さないので、偽装されません。**Vercel の前に別のプロキシ（CDN など）を置かないでください。** 置くと、すべてのクライアントがそのプロキシの 1 つのアドレスとして数えられます。

### リフレッシュの猶予（30 秒）

ブラウザは同時に複数の要求を出すので、同じリフレッシュトークンで `POST /v1/auth/refresh` が同時に起こることがあります。2 本目を「使用済みのトークン」として扱うと、ファミリー全体が失効して利用者がログアウトされてしまいます。そこで、ローテーションから **30 秒以内** に、同じファミリーに有効なトークンが残っているときは、古いトークンが来てもファミリーを失効させず、同じファミリーで新しいトークン一式を出します。30 秒を過ぎた古いトークン、またはファミリーが失効済み（ログアウト・再利用の検知）のときは、今までどおり盗用とみなして `401` です。

残るリスク：盗まれたトークンが、本人のリフレッシュと同じ 30 秒のうちに使われたときは、再利用として検知できません。猶予の長さは固定です（設定で変えられません）。

### ゲストのセッション

`POST /v1/auth/guest` は認証なしで、ゲストのトークン一式を返します（`role: "guest"`、`ownerId: "guest"`）。誰でも呼べるので、DB の行を増やされにくいよう、ゲストのリフレッシュトークンの寿命は **24 時間** です。期限切れの行は、ゲストがログインするたびに削除します。ゲストのトークンは `GET /v1/me` 以外の認証つきルートでは `403` です。

### DB の接続数とパスワードの計算

Go API は 1 つのインスタンスあたり最大 3 本の DB 接続を持ちます。Vercel がインスタンスを増やすと接続数も増えるので、Neon の pooled 接続文字列を使ってください。

パスワードの検証（scrypt、N=2^15・r=8）は 1 回ごとに 32 MiB を使うため、インスタンスごとに同時に 4 件までしか計算しません（5 件目以降は空くまで待ちます）。

### 公開範囲

エンドポイントはインターネットに公開します。アプリから直接呼ぶ API で、認証はアプリ層（アクセス JWT）で行うためです。CORS は設定していません（ブラウザから直接は呼びません）。
