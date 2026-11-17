# Go API（`services/api`）のデプロイ手順

Go API を、Vercel へデプロイするための準備と手順です。Go API は、ネイティブアプリと Web（Next.js）の両方が使います。Web（Next.js）とは **別の Vercel プロジェクト** として、同じリポジトリの `services/api` をデプロイします。仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` と `docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md` にあります。

Vercel の Go の Framework Preset は、`services/api` の `go.mod` と `main.go` を見つけて、普通の `net/http` サーバーとして動かします（Fluid compute）。設定は `services/api/vercel.json`（`"framework": "go"`）にあります。Go の実行は Vercel では Beta です。

Vercel の準備とモバイル用 GitHub OAuth App の登録は、リポジトリの管理者が手作業で 1 回だけ行います。以後は Vercel の Git 連携で、main へのマージが本番、PR がプレビューにデプロイされます。

## 1. モバイル用 GitHub OAuth App の登録

Web 用とは別の OAuth App を新しく作ります。GitHub の **Settings → Developer settings → OAuth Apps → New OAuth App** で登録します。

- Application name: 任意（例: `学习録 mobile`）
- Homepage URL: Web の本番 URL
- Authorization callback URL: アプリのカスタム URL スキーム（例: `yourapp://oauth/callback`）

控える値は Client ID と Client Secret の 2 つです（手順 3 で使います）。カスタム URL スキームは `GITHUB_MOBILE_REDIRECT_URI` にも同じ値を設定します。Go API は、リクエストの `redirectUri` がこの値と完全一致することを要求します。

アプリがまだ無いときは、OAuth App を作らずに仮の値（例: Client ID `unused-mobile-client`、Client Secret `unused-mobile-secret`、`GITHUB_MOBILE_REDIRECT_URI` は `zhuelog://oauth/callback`）を入れて構いません。Go API は起動し、モバイルの GitHub ログインだけが失敗します（Web とパスワードのログインには影響しません）。アプリを作るときに本物の値に替えます。

## 2. Vercel プロジェクトを作る

1. Vercel のダッシュボードで **Add New… → Project** を選び、このリポジトリ（`Sparklingstadt/ffpf-zhuelog`）を Import します。Web のプロジェクトとは別に、新しいプロジェクト（本番は `ffpf-zhuelog-api`）を作ります。
2. **Root Directory** に `services/api` を指定します。
3. **Framework Preset** が `Go` になっていることを確かめます（`services/api/vercel.json` でも指定しています）。
4. **Settings → Deployment Protection** で **Vercel Authentication** を外します。新しいプロジェクトには最初から付いていて、付いたままだと Web のサーバーもアプリも API を呼べません（API はアプリ層の JWT で認証します）。
5. **Settings → Build and Deployment → Root Directory** の **Skip deployments when there are no changes to the root directory or its dependencies** をオンにし、`services/api/` に変更が無いときはデプロイを飛ばします。Vercel のビルド環境には `.git` が無いので、`git diff` を使う Ignored Build Step は動きません（エラーになります）。

## 3. 環境変数

**Settings → Environment Variables** に設定します。`PORT` は Vercel が設定するので不要です。

ビルドのために `GOFLAGS` に `-buildvcs=false` を入れます（Production と Preview）。Vercel のビルド環境には `.git` が無く、`go build` がコミットの情報を埋め込めずに失敗するためです。

| 名前                          | 内容                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）。`?schema=` は付けない（下の注を参照）                                                        |
| `API_JWT_SECRET`              | アクセス JWT の HS256 鍵。`openssl rand -base64 48` で作る（32 バイト以上）                                                                                |
| `GITHUB_MOBILE_CLIENT_ID`     | モバイル用 GitHub OAuth App の Client ID                                                                                                                   |
| `GITHUB_MOBILE_CLIENT_SECRET` | モバイル用 GitHub OAuth App の Client Secret                                                                                                               |
| `GITHUB_MOBILE_REDIRECT_URI`  | アプリのカスタム URL スキーム                                                                                                                              |
| `AUTH_ALLOWED_GITHUB_IDS`     | admin の許可リスト。GitHub の数値 ID をカンマ区切りで（Go API と Web の両方に、同じ値を設定します）                                                        |
| `GITHUB_WEB_CLIENT_ID`        | Web 用 GitHub OAuth App の Client ID（Web の GitHub ログインに必要。下の注を参照）                                                                         |
| `GITHUB_WEB_CLIENT_SECRET`    | Web 用 GitHub OAuth App の Client Secret                                                                                                                   |
| `GITHUB_WEB_REDIRECT_URI`     | `https://<Web のホスト>/api/auth/callback/github/go`                                                                                                       |
| `API_WEB_PROXY_SECRET`        | Web サーバーと共有する秘密。32 バイト以上（`openssl rand -base64 48`）。Web から使うときは必要                                                             |
| `DEMO_LOGIN_ID`               | デモアカウントのログイン ID（例: `demo`。任意）。空のときはデモが無い状態です。Go はログインにだけ使います（リセットは Web）。「10. デモアカウント」を参照 |
| `FFPF_ID_ISSUER`              | FFPF ID（ffpf-portal）の issuer（例: `https://ffpf-portal.vercel.app`）。FFPF ID を使うときだけ。「9. FFPF ID でのログイン」を参照                         |
| `FFPF_ID_CLIENT_ID`           | portal に登録した zhuelog のクライアント ID（例: `zhuelog`）                                                                                               |
| `FFPF_ID_CLIENT_SECRET`       | `pnpm run oidc:client zhuelog`（ffpf-portal）で作ったシークレット                                                                                          |
| `FFPF_ID_REDIRECT_URI`        | `https://<Web のホスト>/api/auth/callback/ffpf`                                                                                                            |

- `DATABASE_URL` は、手で入れなくても、チームの **Storage** タブで Web が使っている Neon のストアを開き、**Connect Project** から Go API のプロジェクトをつなぐと入ります（pooled の接続文字列です。`channel_binding=require` が付いていても Go API はそのまま使えます）。
- `GITHUB_WEB_CLIENT_SECRET` は、Vercel に入れた値を読み戻せないので、GitHub の OAuth App の画面で **Generate a new client secret** を押して新しく作ります。段階3をマージするまでは、本番の Web（Auth.js）のログインが古い Secret を使うので、古い Secret を消さないでください。

**Production と Preview で値を分けてください。**

- PR ごとのプレビューのデプロイが本番の DB を書き換えないよう、Preview の `DATABASE_URL` には本番の接続文字列を入れず、Neon のブランチなど別の DB を指定します。
- Preview の `API_JWT_SECRET` は、本番とは **別の値** にします。同じ値だと、プレビューのデプロイが発行したアクセストークンが本番でもそのまま通り、本番で他人のデータを読み書きできてしまうためです。
- Preview で GitHub ログインを試すなら、本番とは別のモバイル用 OAuth App（と Client Secret）を使います。Preview に `DATABASE_URL` を入れない場合、プレビューのデプロイは起動時に止まります（必須の値が無いため）。

- `GITHUB_WEB_*` の 3 つは **すべて設定するか、すべて空** にします（一部だけだと起動時に止まります）。Go API は `POST /v1/auth/github` の `redirectUri` が `GITHUB_WEB_REDIRECT_URI` と完全一致したときは Web 用の OAuth App で、`GITHUB_MOBILE_REDIRECT_URI` と一致したときはモバイル用で `code` を交換します。どちらとも一致しなければ `401` です。`GITHUB_WEB_REDIRECT_URI` を `GITHUB_MOBILE_REDIRECT_URI` と同じ値にすると、起動時に止まります。
- `GITHUB_WEB_*` と `API_WEB_PROXY_SECRET` は、Go API の起動には要りません。ただし Web は Go API でログインするので、Web から使うときは必要です。
- Web 用の OAuth App は、以前から Web で使っているものをそのまま使えます。GitHub は登録した callback URL の **下の階層** を `redirect_uri` に使えるので、Web の callback（`https://<Web>/api/auth/callback/github/go`）は登録済みの callback（`/api/auth/callback/github`）の下になり、OAuth App の設定を変える必要はありません。
- `API_WEB_PROXY_SECRET` は、Web（Next.js）が利用者の IP を渡すための共有の秘密です。使い方は 下の「レート制限とクライアントの IP」 を見てください。空のときは `X-Zhuelog-Client-IP` を常に無視します。設定すると、`POST /v1/auth/guest` は `X-Zhuelog-Proxy-Secret` が一致する呼び出し（Web のサーバー）だけを受け付け、それ以外は `403` です（下の「ゲストのセッション」）。
- `API_WEB_PROXY_SECRET` も `API_JWT_SECRET` と同じく、Production と Preview で **別の値** にします。同じだと、プレビューの Web が本番の Go API に任意の IP を名乗れてしまいます。
- 段階 10b で、Go から LINE のルートと 2 つの Cron とデモのリセットを外したので、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`OPENAI_LEARNING_MODEL`・`CRON_SECRET`・`OPENAI_API_BASE_URL`・`LINE_API_BASE_URL` を Go は読みません。Go の Vercel プロジェクトからも消してよい値です（手順は下の「段階10（LINE とデモのリセットの cron）のマージの前と後」の手順 3）。`DEMO_LOGIN_ID` は残します。
- `DEMO_LOGIN_ID` は、ログイン ID と同じ形（英小文字・数字・`.` `_` `-` の 3〜32 文字）にします。違うと起動時に止まります。同じログイン ID の会員がすでにいると、その会員のデータが毎晩消えるので、使われていない ID にします（消えるのは Web のリセットです）。
- `FFPF_ID_*` の 4 つは **すべて設定するか、すべて空** にします（一部だけだと起動時に止まります）。`FFPF_ID_ISSUER` は `https://` の URL で、`?` や `#` を含めません（`http://` は `localhost` と `127.0.0.1` だけ）。違うと起動時に止まります。4 つが空のときは、`POST /v1/auth/ffpf` が `503` を返します（FFPF ID のログインが無い状態です）。

DB への接続は、TLS で証明書まで検証します。ホストが `localhost`・`127.0.0.1`・`::1` 以外のとき（または `sslmode` が `prefer`・`require`・`verify-ca` のとき）、Go API は `sslmode` を `verify-full` に置き換えます。Neon の接続文字列の `sslmode=require` はそのままで構いません。`?schema=public` は無視しますが、それ以外のスキーマは `search_path` の起動パラメータになり、プーラーに拒否されることがあるので付けないでください。

## 4. 本番の DB の確認

Go API が使うテーブルは、Prisma のマイグレーションで本番の Neon に適用済みです（`ApiRefreshToken`、`SignInThrottle` など）。段階 11a で足した `Session`（Web のログイン用。11b まで空）も、Web の本番ビルドが当てます。マイグレーションは、Web の **本番ビルド** が自動で適用します。`vercel.json` の `buildCommand` が `scripts/vercel-build.sh` を動かし、`VERCEL_ENV=production` のときだけ `prisma migrate deploy` を実行してから `next build` します（Preview のビルドは自分の Neon ブランチを使い、マイグレーションは当てません）。そのため、Web の Production には `DATABASE_URL` が必要です。無い・つながらない・DDL が失敗すると、本番の Web のデプロイが失敗します（失敗したビルドの本番は、前のバージョンのままです）。

**マイグレーションの制約**: Web のデプロイで自動的に当たる一方、Go API は別のプロジェクトで、あとから手で（main をマージした後に）デプロイします。この間、DB のスキーマは新しく、動いている Go API は古いままです。そのため、マイグレーションは今動いている Go API とそのまま両立する形にします。足してよいのは、表の追加と、null を許す列（または既定値のある列）の追加だけです。列・表の削除や名前の変更、型の変更、NOT NULL の追加のような壊す変更は、2 段階に分けます（1 回目で新しい形を足して Go API を切り替え、2 回目のリリースで古い形を削除します）。

マイグレーションが当たったことの確認と、自動で当たらなかったときの手動の適用は、次のとおりです。`migrate status` で未適用が無いこと（「Database schema is up to date!」）を確かめます。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

会員の一覧（Web の `/follow`）は、DB の日本語の照合順序 `ja-x-icu` で並べます。本番の Neon にあるかを一度確かめてください（1 行返れば問題ありません。無いと `/follow` がエラーになります）。

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

Web（Next.js）は、ログインも学習ノートの読み書きも Go API で行います。ただし、ログイン中の人を決めるところは Web が自分で行います。Go が出すアクセストークン（`zl_access`）を `API_JWT_SECRET` で確かめ、DB の `PasswordAccount`・`FfpfAccount` を Prisma（`src/infrastructure/prisma/`）で読み、会員の管理とパスワードの変更では `PasswordAccount`（作成・パスワードの再設定と変更）と `SignInThrottle`（パスワード変更の回数）にも書きます（Go API を畳む移行の段階 0。設計は `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`）。ほかのデータとログインは今も Go API を通します。段階 11a で、Web が自分でログインするための部品（`Session` の表、セッションの保存、各ログインのユースケース、GitHub と FFPF ID のクライアント）を足しましたが、まだどこからも呼びません（つなぐのは 11b です）。パスワードの変更と管理者の再設定は、そのアカウントの `Session` も同じトランザクションで消します。仕様は `docs/superpowers/specs/2026-10-21-web-auth-via-go-api-design.md` と `docs/superpowers/specs/2026-10-22-web-data-via-go-api-design.md` にあります。

Go API の Vercel プロジェクトには、`GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`・`API_WEB_PROXY_SECRET` を入れておきます（上の「3. 環境変数」の表）。Web の Vercel プロジェクトに入れる値は、次の 4 つに、あとの「Web が実行時に使う DB と秘密」の 3 つ（と `DATABASE_URL`）を足したものです。

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
- `AUTH_SECRET`・`AUTH_GITHUB_SECRET` は、Web では使いません。`DATABASE_URL` は、Web の実行時にも、**本番のビルド**の `prisma migrate deploy` にも使います（「4. 本番の DB の確認」）。消すと、ログイン中の人を決められず、本番の Web のデプロイも失敗します。

LINE 連携を使うときは、Web の Vercel プロジェクトに、もう 1 つ次の値を入れます（無くても Web は動きます）。

| 名前                       | 内容                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `LINE_ADD_FRIEND_URL`      | LINE 公式アカウントの友だち追加のリンク（例: `https://line.me/R/ti/p/@your-account`）。`https://` で始まるものだけ使います   |
| `LINE_OFFICIAL_ACCOUNT_ID` | 連携 QR と「LINEで開く」の送信先となる公式アカウントの公開 ID（`@393bohaw`）。コードは入力欄に入るだけで、自動送信はしません |

`LINE_ADD_FRIEND_URL` が無い・`https://` で始まらないときは、「LINE 連携」画面（`/account/line`）に友だち追加のリンクを出しません（連携コードの発行と解除はできます）。

FFPF ID でのログインを使うときは、Web の Vercel プロジェクトに、次の 2 つも入れます（「9. FFPF ID でのログイン」）。Client Secret は Go API だけが持ちます。

| 名前                | 内容                                        |
| ------------------- | ------------------------------------------- |
| `FFPF_ID_ISSUER`    | Go API の `FFPF_ID_ISSUER` と **同じ値**    |
| `FFPF_ID_CLIENT_ID` | Go API の `FFPF_ID_CLIENT_ID` と **同じ値** |

2 つのどちらかが無い・`FFPF_ID_ISSUER` が `https://` でない（`localhost`・`127.0.0.1` を除く）ときは、ログイン画面に「FFPF IDでログイン」を出しません。

### Web が実行時に使う DB と秘密

Web は実行時に、次の値を使います。Web の Vercel プロジェクトの Production に入れます。

| 名前                        | 内容                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Neon の接続文字列。実行時の読み取りに使う。pooled の URL か **確かめる**（下の注を参照）                                                                                            |
| `API_JWT_SECRET`            | Go API と **同じ値**（32 バイト以上。足りないと、Web はトークンをすべて無効として扱い、全員が未ログインになる）                                                                     |
| `AUTH_ALLOWED_GITHUB_IDS`   | 管理者にする GitHub ユーザーの数字の ID（カンマ区切り。Go API と同じ値。空なら管理者は誰も通らない）                                                                                |
| `DEMO_LOGIN_ID`             | デモアカウントのログイン ID（Go API の `DEMO_LOGIN_ID` と同じ）。Web ではデモのリセット（`/api/cron/demo-reset`）が使い、空ならそのルートは `404`。デモを使わないなら入れなくてよい |
| `OPENAI_API_KEY`            | 単語帳の「AI で下書き」に使う OpenAI の API キー。Go API と同じ値でよい。無いと下書きは「今は使えません」になる                                                                     |
| `OPENAI_LEARNING_MODEL`     | 単語帳の下書きと LINE の添削・翻訳のモデル（任意。無ければ `gpt-5-mini`。Go に入れていれば同じ値）                                                                                  |
| `LINE_CHANNEL_SECRET`       | LINE の Messaging API のチャネルシークレット。以前 Go に入れていたのと **同じチャネルの値**。**Production だけ**（下の注を参照）                                                    |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE の長期のチャネルアクセストークン。以前 Go に入れていたのと **同じチャネルの値**。**Production だけ**                                                                           |
| `CRON_SECRET`               | `/api/cron/line-drain` と `/api/cron/demo-reset` の認証用の秘密。**Production だけ**。Vercel が Cron の呼び出しに `Authorization: Bearer <値>` を付ける                             |
| `LINE_API_BASE_URL`         | テスト専用。LINE の API の接続先の差し替え（ループバックの URL だけ。本番には設定しない）                                                                                           |
| `OPENAI_CHAT_MODEL`         | クイック質問と ChatGPT と話すのモデル（任意。無ければ `gpt-6.1-sol`）                                                                                                               |

注意:

- 値は、Go API のプロジェクトに入れているものと同じにします。Web だけ値が違うと、Go が出したトークンを Web が確かめられず、管理者やデモの判定もずれます。
- `DATABASE_URL` が pooled か、マージの前に確かめます（ホスト名に `-pooler` が付くのが pooled です）。マイグレーション（`prisma migrate deploy`）は direct の URL を使うのが本来の形です。今の Production の値が **direct** のときは、実行時用に pooled の値を別の変数で足します。ただし、今の Web のコード（`src/infrastructure/prisma/prisma-client.ts`）が読むのは `DATABASE_URL` だけです。その場合は、実行時用の変数を読むコードの変更を先に入れてから、値を設定します。
- 単語帳（一覧・保存・削除）は、Web が Prisma で DB を読み書きします。「AI で下書き」も Web が OpenAI を直接呼び、使った量を、操作している人の `AiUsage` に記録します。コードの上では、Go API に `/v1/vocabulary*` のルートはもうありません（本番の Go は、下の手順で再デプロイするまで古いままです）。そのため、**マージの前に** Web の Production に `OPENAI_API_KEY` を入れます（Go API と同じ値でよい）。Go API には `OPENAI_API_KEY` は要りません（段階 10b で Go から OpenAI を外しました）。
- `OPENAI_API_BASE_URL` はテスト専用です。`127.0.0.1` などのループバックの URL だけを受け付けます。**Production と Preview には設定しません。**
- LINE の `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`CRON_SECRET` は、**Production だけ** に入れ、Preview には入れません。入れると、プレビューのデプロイが本物の LINE のチャネルに返事をしてしまうためです（Webhook は本番の URL にだけ届きますが、プレビューから push を送れてしまいます）。LINE を使うには、LINE の 2 つと `OPENAI_API_KEY` がそろっている必要があります。LINE の 2 つのどちらか、または `OPENAI_API_KEY` が無い（`LINE_API_BASE_URL` がループバックでないときも同じ）Web は、`POST /api/line/webhook` と `GET /api/cron/line-drain` が `404`、`/account/line` が「LINE 連携は今は使えません。」になります（Go のように起動時には止まりません）。`CRON_SECRET` だけが無いときは、拾い直しとデモのリセットが常に `401` です。LINE の 2 つは、LINE Developers の値です。`CRON_SECRET` は `openssl rand -hex 32` で作ります。
- `LINE_API_BASE_URL` はテスト専用です。`OPENAI_API_BASE_URL` と同じく、**Production と Preview には設定しません。**
- 秘密の値は、このリポジトリのファイルやログに書きません。
- 4 つ（`API_JWT_SECRET`（Go API と 1 バイトも違わない値）、`AUTH_ALLOWED_GITHUB_IDS`（数字の ID。Go API と同じ値）、`DEMO_LOGIN_ID`、`DATABASE_URL`）は、**マージ（本番のデプロイ）の前に** Web の Production に入れておきます。Vercel の環境変数は、変えたあとに再デプロイしないと効きません。
- 足りない・値が違うときの症状：`API_JWT_SECRET` が無い・違う・短いと、全員が未ログイン扱いになり、ログインしても `/signin` に戻ります。`DATABASE_URL` が無いと、会員向けのページがエラーになります。
- Web に Auth.js の時代の `AUTH_ALLOWED_GITHUB_IDS` が残っていないか確かめます（下の「段階3のマージの前に行うこと」で残すとしている値です）。数字でない項目（ログイン名など）は捨てられ、管理者が権限を失います。数字の ID に直します。

#### 段階1のマージの前と後

単語帳を Web に移した変更（段階1）を本番に出す順番です。

マージの前:

- Web の Production に `OPENAI_API_KEY` を入れます（Go API と同じ値でよい）。
- Go に `OPENAI_LEARNING_MODEL` を入れている場合は、Web にも同じ値を入れます。今の Go には入っておらず、既定の `gpt-5-mini` なので、Web も入れなくて同じになります。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/vocabulary*` のルートが本番から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go を再デプロイしたあとで Web だけを戻すと、単語帳が壊れます（古い Web が `/v1/vocabulary*` を呼び、`404` になります）。Web と Go を **いっしょに** 戻します。

#### 段階2のマージの前と後

学習ノート（一覧・検索・カレンダー・日ごとの表示・ゴミ箱・共有）を Web に移した変更（段階2）を本番に出す順番です。

マージの前:

- この段階で新しい環境変数はありません。Web の Production に `DATABASE_URL` などが入っていれば足ります（段階1のとおり）。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/entries`（一覧・詳細・編集・削除）、`/v1/batches`、`/v1/trash*`、`/v1/entries/{id}/share`、`/v1/log-dates*` が本番の Go から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- 逆に、Go を再デプロイしたあとで Web だけを戻すと、古い Web が呼ぶルートが新しい Go にないため、学習ノートの画面が `404` で壊れます。Web を戻すなら Go も戻します（Go を再デプロイする前なら Web だけで足ります）。
- いっしょに戻すのがいちばん安全です。

#### 段階3（CSV の取り込み）のマージの前と後

学習ノートの CSV の取り込みを Web に移した変更（段階3）を本番に出す順番です。Web が CSV を自分で検証・解析し、1 つのトランザクションで DB に保存します。Go の `POST /v1/imports/csv` はなくなりました（LINE とデモのリセットが使う書き込みは Go に残ります）。下の「段階3のマージの前に行うこと」（Go API を入れたときの段階）とは別のものです。

マージの前:

- この段階で新しい環境変数はありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/imports/csv` が本番の Go から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/imports/csv` を呼んで `404` になり、CSV の取り込みが一般的な文言で失敗します。Web を戻すなら Go も戻します（Go を再デプロイする前なら Web だけで足ります）。
- いっしょに戻すのがいちばん安全です。

#### 段階4（復習）のマージの前と後

復習（今日の復習の一覧・件数・回答、ノートを復習に入れる・出す）を Web に移した変更（段階4）を本番に出す順番です。Web が `ReviewItem` と `ReviewLog` を Prisma で直接読み書きし、FSRS も Web（`src/domain/review/fsrs.ts`）で計算します。Go の `/v1/reviews*` と `/v1/entries/{id}/review` はなくなりました。Go に残るのは、LINE の復習のお知らせの件数とデモのリセットです（練習の間違いを列に入れる処理は段階5で Web に移りました）。

マージの前:

- この段階で新しい環境変数も、マイグレーションもありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/reviews/*` と `/v1/entries/{id}/review` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ列に答えを書いても問題ありません。FSRS の計算は同じで（`tests/fixtures/fsrs-golden.json` で Go と Web の結果が同じことを確かめています）、行のロック（`FOR UPDATE`・`FOR SHARE`）も同じです。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/reviews/*` を呼んで `404` になります。今日の復習は失敗の表示になり、ホームの復習のカードとバッジは消え、答えると「この問題は復習の一覧にありません。」になります。ノートのページの「復習に入れる」と、ホームのノートごとのボタンも使えなくなります（`/v1/entries/{id}/review` の呼び出しが `404` になるためです）。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

#### 段階5（練習の記録）のマージの前と後

介詞と補語の練習の記録（保存・一覧・1 件の表示）と、間違えた問題を復習の列に入れる処理を Web に移した変更（段階5）を本番に出す順番です。Web が問題の中身を確かめ、記録の保存と復習の列への登録を 1 つのトランザクションで Prisma に書きます。Go の `/v1/complement-records*` と `/v1/preposition-records*` はなくなりました。Go に残るのは、デモのリセットが使う型と挿入と、Go の学習ログと LINE の通知がこれらのテーブルを今も読む処理です。

マージの前:

- この段階で新しい環境変数も、マイグレーションもありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/preposition-records*` と `/v1/complement-records*` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ表に記録を書き、同じ列に間違いを入れても問題ありません。行の形（問題の JSON）と、列に入れる文（`ON CONFLICT … WHERE "due" > EXCLUDED."due"`）が同じだからです。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/*-records` を呼んで `404` になります。練習を終えると「処理できませんでした。時間をおいてもう一度お試しください。」と出て、記録も復習も残りません。`/practice` のカードから前回の記録が消え、記録の一覧のページはエラーの表示、1 件のページは `404` になります。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

#### 段階6（質問）のマージの前と後

クイック質問（OpenAI の答えを NDJSON でブラウザへ流す）と質問ノート（保存した質問の一覧・保存）を Web に移した変更（段階6）を本番に出す順番です。Web の Route Handler が OpenAI を直接呼んで答えを流し、使った量を `quick_question` として操作している人の `AiUsage` に記録し、質問ノートを Prisma で読み書きします。ブラウザが止めると、Web は OpenAI への要求も中断します。Go の `/v1/questions*` と `/v1/quick-question` はなくなりました。Go に残るのは、LINE、フォローとタイムライン、学習ログ、管理、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。
- `OPENAI_CHAT_MODEL` は任意です。Go の Production には入っていないので、Web も入れなければ、どちらも既定の `gpt-6.1-sol` になります。
- クイック質問のルートは `maxDuration = 90` を出しています。Web のプロジェクトで 90 秒が許されること（Fluid compute か、上限が 90 秒以上のプラン）を確かめます。許されないとビルドが失敗します。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/quick-question` と `/v1/questions*` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `QuickQuestion` の表に書いても問題ありません。行の形と、「同じ id は同じ内容のときだけ成功」の決まりが同じだからです。利用量も同じ `feature`（`quick_question`）で同じ表に入ります。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/quick-question` と `/v1/questions*` を呼んで `404` になります。質問すると「見つかりません。」と出て、質問ノートのページはエラーの表示になり、`/quick-question` は「クイック質問を利用できません」になります。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

#### 段階7（チャット）のマージの前と後

ChatGPT と話す（OpenAI の答えを NDJSON でブラウザへ流す）と会話ノート（保存した会話の一覧・読み・削除）を Web に移した変更（段階7）を本番に出す順番です。Web の Route Handler が OpenAI を直接呼んで答えを流し、使った量を `chat` として操作している人の `AiUsage` に記録し、会話ノートを Prisma で読み書きします。ブラウザが止めると、Web は OpenAI への要求も中断します。Go の `/v1/chat` と `/v1/conversations*` はなくなりました。Go に残るのは、LINE、フォローとタイムライン、学習ログ、管理、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。`ChatConversation` の表はすでにあります。Web の `OPENAI_API_KEY` は段階 1 から入っています。`OPENAI_CHAT_MODEL` は任意で、どちらにも入っていないので、既定の `gpt-6.1-sol` になります。
- `/api/chat` も `maxDuration = 90` を出しています。段階6で Web のプロジェクトに 90 秒が通っているので、そのままでかまいません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/chat` と `/v1/conversations*` が本番の Go から実際に消えます。
4. Go の `OPENAI_API_KEY` は LINE が使うので、残します（当時。段階 10b で Go から LINE が消えたので、今は消してよい値です）。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `ChatConversation` の表に書いても問題ありません。行の形と、「ほかの人の id は書き換えない」決まりが同じだからです。開いたままの画面も、同じ `/api/chat` を呼びます。利用量も同じ `feature`（`chat`）で同じ表に入ります。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/chat` と `/v1/conversations*` を呼んで `404` になります。話すと「見つかりません。」と出ます。`/chat` は「ChatGPT が設定されていません」、`/conversations` は設定されていない表示になり、日付のページは `404`、削除は一般的な文言になります。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

#### 段階8（学習ログ・AI の利用量）のマージの前と後

学習ログ（日本時間の日ごとの、復習・練習・ノート・単語の数）と、管理者の AI の利用量（日本時間の月ごとの集計）を Web に移した変更（段階8）を本番に出す順番です。どちらも読むだけで、Web が Prisma で Go と同じ SQL を流します。Go の `/v1/study-log` と `/v1/admin/ai-usage` はなくなりました。Go に残るのは、LINE（LINE の分の `AiUsage` の記録を含む）、フォローとタイムライン、会員の管理、パスワード変更、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。表はすべてすでにあります。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS` で決めています。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/study-log` と `/v1/admin/ai-usage` が本番の Go から実際に消えます。
4. 本番で、学習ログ（会員）と「AI 利用量」（管理者）を 1 回ずつ開いて、数が出ることを確かめます。

切り替えのあいだ:

- どちらも読むだけなので、古い Go と新しい Web が同時に動いても、DB は変わりません。LINE の利用量は、今までどおり Go が同じ表に書き、Web の集計に出ます（当時。段階 10b で Go から消えました。今は Web が書きます）。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/study-log` と `/v1/admin/ai-usage` を呼んで `404` になります。学習ログは「処理できませんでした。時間をおいてもう一度お試しください。」、AI 利用量は「利用量を読めませんでした。Go API が最新かを確認してください。」と出ます。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

#### 段階9a（フォロー・タイムライン・会員の一覧）のマージの前と後

フォロー（する・外す）、フォロー中の人の共有ノートのタイムライン、会員の一覧を Web に移した変更（段階9a）を本番に出す順番です。Web が Prisma で Go と同じ SQL を流し、フォローは「相手の会員がいるときだけ行を足す」1 つの SQL にしました。Go の `/v1/members`・`/v1/follows/{ownerId}`・`/v1/timeline` はなくなりました。Go に残るのは、LINE、会員の管理、パスワード変更、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。表はすべてすでにあります。会員の一覧の照合順序 `ja-x-icu` も、Go のときに確かめた同じ DB です。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/members`・`/v1/follows/{ownerId}`・`/v1/timeline` が本番の Go から実際に消えます。
4. 本番で `/follow` を開き、会員の一覧と共有ノートが出ること、1 人をフォローして外せることを確かめます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `Follow` 表を同じ形で読み書きするので、どちらで書いた行も、もう一方に出ます。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になります。`/follow` はエラーの画面になり、フォローのボタンは「見つかりませんでした。画面を更新してください。」と出ます。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

#### 段階9b（会員の管理・パスワード変更）のマージの前と後

会員の作成・一覧・パスワードの再設定（管理者）と、自分のパスワードの変更を Web に移した変更（段階9b）を本番に出す順番です。Web が scrypt で Go と同じ形のハッシュを書き（`tests/fixtures/scrypt-golden.json` で Go と同じことを確かめています）、ハッシュと `sessionVersion` を 1 つの `UPDATE` で変えます。Go の `/v1/admin/accounts`・`/v1/admin/accounts/{id}/password`・`/v1/account/password` はなくなりました。Go に残るのは、LINE、ログイン（ハッシュの確かめと `sessionVersion` の確かめを含む）、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。`PasswordAccount` と `SignInThrottle` はすでにあります。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS`、デモを `DEMO_LOGIN_ID` で決めています。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/admin/accounts`・`/v1/admin/accounts/{id}/password`・`/v1/account/password` が本番の Go から実際に消えます。
4. 本番で、管理者が試しの会員を 1 人作ります。その会員でログインできること（Go のログインが Web のハッシュを受け付けること）と、パスワードを再設定すると前のログインが切れることを確かめます。確かめたあと、試しの会員は DB から手で消します（Web に削除の画面はありません）。

切り替えのあいだ:

- 古い Go と新しい Web は同じ形のハッシュを書き、同じ `sessionVersion` と同じ試行回数の鍵を使います。どちらで変えても、もう一方のログインとセッションの確かめに効きます。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になります。管理画面の一覧はエラーの画面に、パスワードの変更は「処理できませんでした。時間をおいてもう一度お試しください。」になります。
- Web を戻すなら Go も戻します。Web が書いたハッシュは、古い Go でも確かめられます。

#### 段階10（LINE とデモのリセットの cron）のマージの前と後

LINE の webhook・連携・拾い直しと、デモのリセットの cron を Web に移す段階（段階10）を本番に出す順番です。1 つの PR には大きいので、3 つの PR（10a・10b・10c）に分けました。

- **10a**：LINE の webhook（`POST /api/line/webhook`）、「LINE 連携」の画面と Server Actions、拾い直しと朝のお知らせ（`GET /api/cron/line-drain`）を Web に足します。Cron はまだ登録しません。Go は変えません。
- **10b**：Go から LINE のルートと 2 つの Cron（`services/api/vercel.json`）を消し、デモのリセットを Web（`/api/cron/demo-reset`）に足します。
- **10c**：Web の `vercel.json` に `crons` を足して、2 つの Cron を Web で動かします。

順番は 4 つの手順で、LINE の返信と OpenAI の呼び出しが二重にならないように切り替えます。LINE の Webhook URL は同時に 1 か所にしか向けられないので、「Go が答える」か「Web が答える」かのどちらか一方になります。この途中で、拾い直しが 1 回（1 晩）飛ぶことと、Webhook URL を変える数分のあいだに届いた LINE の文に返事が無いことがあります。この 2 つは、わかったうえで受け入れています。

##### 手順 1（10a のマージの前と後）

この PR（10a）が行うのは、Web に LINE の受け口を足すところまでです。LINE の Webhook URL は変えません。マージしても、LINE の文は Go に届き続けます。

マージの前:

- Web の Vercel プロジェクトの **Production** に、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`（どちらも Go のプロジェクトと同じ値）と `CRON_SECRET`（Go と同じ値にするか、`openssl rand -hex 32` で新しく作る）を入れます。Preview には入れません。`OPENAI_API_KEY` は段階 1 から入っています。
- Go に `OPENAI_LEARNING_MODEL` を入れている場合は、Web にも同じ値を入れます（今の Go には入っておらず、どちらも既定の `gpt-5-mini` です）。
- マイグレーションはありません（`LineLink`・`LineLinkCode`・`LineMessage` は本番にあります）。
- Vercel の環境変数は、変えたあとに再デプロイしないと効きません。入れてから、マージのデプロイを出します。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. 次の `curl` で、Webhook が Web で答えていることを確かめます。署名の無い呼び出しは、`401` と次の JSON を返します。

   ```bash
   curl -s -X POST https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook
   # {"error":{"code":"unauthorized","message":"認証が必要です。"}}
   ```

   - `404` のときは、LINE の値（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`）が Production に入っていません。入れて再デプロイします。
   - `{"error":"認証が必要です。"}`（`code` と `message` の入れ子が無い形）のときは、まだ古い Web のデプロイが答えています（`vercel promote` が済んでいません）。

4. `/account/line` を開き、「LINE 連携は今は使えません。」が出ないことを確かめます。Preview のデプロイでは、この文が出るのが正しい動きです（LINE の値は Production だけに入れるため）。
5. **Go は、まだ再デプロイしません。** Go の LINE のコードは、この PR では消えません（段階 10b で消します）。

次の `curl` は、**まだ叩きません**。

```bash
curl -s -o /dev/null -w '%{http_code}' https://ffpf-zhuelog.sparklingstadt.com/api/cron/line-drain -H "Authorization: Bearer $CRON_SECRET"
```

叩くと `204` が返ります。Go の Cron と時間をずらして順に呼ぶ分には、結果は同じで困りません（Go と Web は同じ表を同じ意味で使い、1 回の試しは 1 つの文に 1 回だけ取られるため）。困るのは次の 2 つです。Go の Cron と **同時に** 走ると、同じ文の生成を両方が行い、OpenAI の呼び出しが二重になりえます。また、OpenAI の失敗が続いているあいだに呼ぶと、試す回数（1 つの文に 2 回まで）を使い切って失敗にされる文が出ます。そのため、段階 10c までは叩きません。Web の Cron は、段階 10c まで登録しません。

この時点では、LINE の文はまだ Go に届き、拾い直しの Cron も Go が動かします。Web の画面で出した連携コードは、Go の Webhook でも使えます（同じ表を同じ意味で使うため）。Web で切り替えた復習のお知らせの設定は、Go の Cron がそのまま送ります。Go のコードは出し直しません。

運用の注意：1 つのイベントの処理は、最悪の場合、route の `maxDuration`（60 秒）を超えます（OpenAI に 20 秒、利用量の記録に 5 秒、学習ノートを保存するトランザクション、そのあと reply に 10 秒）。超えると reply は届きませんが、行は `done` か `pending` のまま残るので、データは壊れません（`pending` の行は拾い直しが処理します）。Go にも同じ種類の危険がありました。

##### 手順 2（利用者が行う）

マージと確認が済んでから、LINE の Webhook URL を Web に変えます。

1. LINE Developers のコンソールで、Messaging API のチャネルの **Webhook URL** を、Go の `https://ffpf-zhuelog-api.vercel.app/v1/line/webhook` から、Web の `https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook` に変えます。
2. 「**検証**」を押し、成功（`200`）になることを確かめます。「Webhook の利用」はオンのまま、「応答メッセージ」はオフのままにします。
3. 自分の LINE で、添削・翻訳・コードでの連携を 1 回ずつ試します。結果が Web の学習ノートに入ること、`AiUsage` に機能名 `line` の行が増えること（管理者の `/admin/ai-usage`）を確かめます。
4. 変えてから数分のあいだに届いた文は、返事が無いことがあります（許容します）。

##### 手順 3（10b のマージの前と後）

手順 2 が済んでから、10b をマージします。この PR（10b）は、Go から LINE のルートと 2 つの Cron とデモのリセットを消し、デモのリセットを Web の `GET`/`POST /api/cron/demo-reset` として足します。

マージの前:

- 10a が本番にあり、手順 2（LINE の Webhook URL の変更）が済んでいること。自分の LINE で、Web が返事をすることを確かめてあること。**手順 2 より先にマージしない**（Go の LINE のルートが消えるので、Webhook が Go に向いたままだと、LINE の文は `404` で失われます）。
- Web の Production に `CRON_SECRET` と `DEMO_LOGIN_ID`（Go と同じ値）があること。
- マイグレーションはありません。

マージのあと:

1. Web の Production のデプロイが Ready になるのを待ちます。
2. `vercel promote` で、そのデプロイを本番に切り替えます。
3. 次のコマンドが `204` を返し、「デモで試す」で例のデータが出ることを確かめます（Go のログインは、Web が作ったアカウントを使います）。`<CRON_SECRET>` は Web の Production の値です。

   ```sh
   curl -i -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset \
     -H "Authorization: Bearer <CRON_SECRET>"
   ```

4. main から Go を再デプロイします（実行の前に、使う人に確かめます）。これで、Go の LINE のルート・`/v1/cron/demo-reset`・Go の 2 つの Cron が消えます。
5. 次の 2 つを確かめます。`curl -i -X POST https://ffpf-zhuelog-api.vercel.app/v1/line/webhook` が `404` を返すこと。Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いこと。
6. Go の Vercel プロジェクトから、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`OPENAI_LEARNING_MODEL`・`CRON_SECRET`・`OPENAI_API_BASE_URL`・`LINE_API_BASE_URL` を消してよくなります（`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` は、入れていた場合だけです）。`DEMO_LOGIN_ID` は残します（Go のログインが使います）。Go が読む値は、`PORT`・`DATABASE_URL`・`API_JWT_SECRET`・`GITHUB_MOBILE_*`・`GITHUB_WEB_*`・`API_WEB_PROXY_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` で、`FFPF_ID_*` と `DEMO_LOGIN_ID` は任意です。

10c を出すまで、拾い直し（`/api/cron/line-drain`）とデモのリセットは、定期には動きません。拾い直しが 1 晩飛ぶのは、設計どおりです。デモのリセットが要るときは、上の手順 3 の `curl` で手でできます（10c のマージのあとは Cron が呼びます）。

戻すとき（10b）:

- 10c を出したあとは、**先に** 手順 4 の「戻すとき（10c）」に従って、Web の Cron を消します。Web の Cron が登録されたまま Go だけを戻し、Go に 7 つの値が残っていると、拾い直しが Go と Web の両方で動きます（OpenAI の呼び出しが二重になりえます）。
- Go だけを戻すと、Go の LINE のルートと Cron が戻ります。ただし、手順 3 の 6 で上の 7 つの値を Vercel から消したあとは、戻した Go はそれらの値を読めず、LINE も Cron も動きません（消した値は Vercel から読み戻せないので、動かすなら入れ直します）。動くとすれば、値を残している間だけです。ただし、Webhook の URL は Web を向いているので、Go の Webhook は使われません。Web に Cron が無いうちは、Go の拾い直しの Cron が動いても害はありません。
- Web だけを戻すと、デモのリセットのルートが無くなり、Go にも無いので、リセットは手でもできなくなります（デモのデータは、そのときのまま残ります）。Web を戻すなら、Go も戻します。
- 症状の見分け方：LINE の文に返事が無く、LINE Developers の Webhook の確認が `404` なら、Webhook が Go に向いたままです（手順 2 をやり直します）。「デモで試す」が「デモは今は利用できません。」になるなら、デモのアカウントが無いので、手順 3 の `curl` でリセットします。リセットの `curl` が `404` なら、Web の `DEMO_LOGIN_ID` がありません。`401` なら、`CRON_SECRET` が違います。リセットの `curl` が `204` を返すのに「デモで試す」が「デモは今は利用できません。」になるなら、Web と Go の `DEMO_LOGIN_ID` が違います（Web がリセットしたのとは別の loginId を、Go のログインが探しています）。2 つが同じ値か確かめます。

##### 手順 4（10c のマージの前と後）

手順 3 で Go を出し直したあとで、10c をマージします。この PR（10c）は、Web の `vercel.json` に `crons` を足すだけです（アプリのコードは、コメントのほかは変えません。テストを 1 つ足しました）。これで段階 10 の 4 つの手順はすべて終わり、Go に残るのはログインだけになります。

Cron は Production のデプロイで登録されます。時刻は UTC で、`/api/cron/line-drain` は `0 21 * * *`（06:00 JST）、`/api/cron/demo-reset` は `0 19 * * *`（04:00 JST）です。Hobby の Cron は時刻が 1 時間単位で、指定の時刻から最大 59 分遅れることがあります（[Vercel の説明](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing)）。

マージの前:

- 手順 3 が済んでいること。Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いこと（Go と Web の両方で同じ拾い直しが動くと、OpenAI の呼び出しが二重になりえます）。
- Web の Production に `CRON_SECRET` があること。Vercel が Cron の呼び出しに `Authorization: Bearer <CRON_SECRET>` を自動で付けるので、ほかに設定は要りません。
- Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までで、時刻は最大 59 分遅れることがあります。この 2 つ（どちらも 1 日 1 回）は収まります。マイグレーションはありません。

マージのあと:

1. Web の Production のデプロイが Ready になるのを待ちます。
2. `vercel promote` で、そのデプロイを本番に切り替えます（Cron は Production のデプロイで登録されます）。
3. Web の Vercel プロジェクトの **Settings → Cron Jobs** に、ちょうど 2 つ、`/api/cron/line-drain`（`0 21 * * *`）と `/api/cron/demo-reset`（`0 19 * * *`）が出ることを確かめます。
4. 待たずに確かめるなら、同じ画面から、それぞれの Cron を 1 回だけ実行できます（任意）。ただし、実行には副作用があります。`line-drain` を実行すると、本物の復習のお知らせを送り、LINE の送信数の枠を使い、その日（JST）の実行として数えられます。`demo-reset` を昼間に実行すると、今デモを試している人のデータが元に戻ります。成功すると、Web のログ（Vercel の **Logs**）に、リクエストの結果として `204` が出ます。`demo-reset` は `DEMO_RESET_DONE`、`line-drain` は `LINE_REVIEW_NOTIFY_SENT`（お知らせを送ったとき）が出ます。`401` なら `CRON_SECRET` が無いか違い、`404` なら、`demo-reset` では Web の `DEMO_LOGIN_ID` が、`line-drain` では LINE の値（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`）がありません。
5. 次の朝（04:00 JST ごろと 06:00 JST ごろ。遅れても 1 時間以内）に、Web のログで、2 つの実行があったことを確かめます。

戻すとき（10c）:

- この PR だけを戻す（Web を戻す）と、Web の Cron が消えるだけで、ほかは動きます。拾い直しとデモのリセットが定期には動かなくなります（手で `curl` すれば呼べます）。Go に Cron は無いので、二重には動きません。
- Go の Cron を戻したいときは、先にこの PR を戻し、戻した Web を promote して、Web の **Settings → Cron Jobs** の一覧が空になったことを確かめてから、Go を 10b の前に戻します（2 つの Cron を並べない）。

##### 戻すとき（10a）

- 手順 2 の前なら、Web だけを戻せば足ります。LINE の Webhook は Go に向いたままで、Go がまだ連携のルートも持っているからです。戻した Web の `/account/line` は、前の Web のとおり Go を呼びます。
- 手順 2 のあとで Web だけを戻す場合は、**先に** LINE Developers の Webhook URL を Go（`https://ffpf-zhuelog-api.vercel.app/v1/line/webhook`）に戻します。戻さずに Web を戻すと、古い Web には Webhook のルートが無いので、LINE の文は `404` で失われます。
- Go は、10a では何も変えていないので、戻す必要はありません。
- ただし、10b を出したあとの Go には Webhook のルートがありません。Webhook URL を Go に戻す前に、Go も 10a の状態に戻します。

#### 段階11（ログイン）のマージの前と後

ログインを Go から Web に移す段階（段階11）を本番に出す順番です。2 つの PR（11a・11b）に分けました。

- **11a**：ログインのセッションを置く `Session` の表と、Web がログインを行うための部品（セッションの保存、パスワード・ゲスト・デモ・GitHub・FFPF ID のログインのユースケース、GitHub と FFPF ID のクライアント）を足します。どこからも呼ばないので、ログインは Go のままです。
- **11b**：ログインの画面とルートを、この部品につなぎます（Go から Web への切り替え）。
- 11a の PR では、動きは何も変わりません。

##### 11a のマージの前と後

マージの前:

- 行うことは無いです。
- `Session` の表を足すマイグレーション（`20261117090000_add_session`）は、表と索引を作るだけで、今の Go と両立します。

マージのあと:

1. Web の本番のビルドが、`prisma migrate deploy` で `Session` の表を足します（「4. 本番の DB の確認」）。
2. `migrate status` で「Database schema is up to date!」を確かめます。
3. **Preview の Neon ブランチ**には、手で `prisma migrate deploy` を当てます（プレビューのビルドは当てません。「Web のプレビュー（Preview）」の手順です）。`DATABASE_URL=<そのブランチの direct の URL> pnpm exec prisma migrate deploy` です。当てるまでは、Preview でパスワードの変更と管理者による再設定が `500` で失敗します。この 2 つは、同じトランザクションで `Session` から消す（その人のセッションを失効させる）ためです。
4. ログインの動きは変わりません。ログインは Go のままで、`Session` の表は空のままです。

11b の前に、Web の Production に次の 2 つを入れておいてよいです（11a のコードは読みません）。

- `GITHUB_WEB_CLIENT_SECRET`：Go の同じ名前の値です。Vercel から読み戻せないときは、GitHub の OAuth App の画面で **Generate a new client secret** を押して作ります。古い Secret は、11b のあと Go を出し直すまで消しません。
- `FFPF_ID_CLIENT_SECRET`：Go と同じ値です。

Preview には入れません。プレビューの URL は、GitHub と FFPF ID に登録したコールバックの URL と合わないためです。

11b の準備として、11a で決めたセッションの性質を書いておきます。

- セッションは固定の長さです。会員と管理者は 30 日、ゲストは 24 時間で、使っても延びません。Go の refresh のように、使うたびに延びることはありません。そのため、11b のあとは、30 日ごとにログインし直してもらうことになります。
- 期限の切れたセッションは、ログインのたびに、最大 100 行まで消します。消すための別のジョブが要らないからです。

戻すとき（11a）:

- Go だけを戻しても害はありません（11a は Go を変えません）。
- Web を戻すと、空の `Session` の表が残ります。何も読まないので、そのままで害はありません。

##### 11b のマージの前と後

11b の計画の Task 5 で書く。

### Web のプレビュー（Preview）

PR ごとの Web のプレビューも、ログインとデータの読み書きを Go API で行います。そのため、Web の Vercel プロジェクトの **Preview** の環境変数にも、次の 4 つ（と、下の注の DB と秘密）を入れます。

| 名前                   | Preview に入れる値                                                               |
| ---------------------- | -------------------------------------------------------------------------------- |
| `GO_API_URL`           | **Preview の Go API** の URL（`https://`）。本番の Go API は指しません           |
| `API_WEB_PROXY_SECRET` | その Preview の Go API の `API_WEB_PROXY_SECRET` と **同じ値**（本番とは別の値） |
| `AUTH_URL`             | プレビューの Web の origin（例: `https://<プレビューのホスト>`）                 |
| `AUTH_GITHUB_ID`       | その Preview の Go API の `GITHUB_WEB_CLIENT_ID` と同じ OAuth App の Client ID   |

注意:

- 4 つのどれかが無いと、プレビューの Web ではログインできません。ログインできないので、学習ノートも見られません。
- Web は実行時に DB を読むので、Preview にも `DATABASE_URL` と `API_JWT_SECRET` を入れます。**本番と別の Neon ブランチ**の `DATABASE_URL`（pooled）と、**本番とは別の** `API_JWT_SECRET` です。`DATABASE_URL` は、Preview の Go API の `DATABASE_URL` と **同じ Neon ブランチ** にします（トークンが指すアカウントがそこにあります）。`API_JWT_SECRET` も、Preview の Go API と同じ値にします。同じ DB や秘密を使うと、プレビューが本番のデータを書き換えたり、本番のトークンを受け付けたりしかねません。`AUTH_ALLOWED_GITHUB_IDS` と `DEMO_LOGIN_ID` も、Preview の Go API に合わせて入れます。
- プレビューのビルドはマイグレーションを当てません（`scripts/vercel-build.sh`）。そのため、Preview 用の Neon ブランチのスキーマは、手で合わせます。次のどちらかです。
  - 本番から Neon のブランチを作り直す（スキーマも本番と同じになる）。
  - そのブランチの direct の URL に向けて、手元で `DATABASE_URL=<そのブランチの direct の URL> pnpm exec prisma migrate deploy` を実行する。
- Preview の Go API は、上の「3. 環境変数」のとおり、本番とは別の DB と別の秘密を使います。プレビューの Web を本番の Go API につながないでください。
- プレビューの URL はデプロイごとに変わります。`AUTH_URL` と Go API の `GITHUB_WEB_REDIRECT_URI` が合わないときは、GitHub ログインは使えません。パスワードとゲストのログインは使えます。

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

### e2e

`pnpm run test:e2e` は、いつも Go API を使います（Go が必要です）。`services/api` をビルドして `127.0.0.1:3108` で起動し、e2e の DB をそのまま使います。FFPF ID は、`e2e/fixtures/ffpf-oidc-stub.ts` の小さな OIDC スタブ（`127.0.0.1:3110`）を issuer にして、Web と Go API に `FFPF_ID_*` を渡します。スタブは実行ごとに P-256 の鍵を作り、`/oauth/authorize` は画面を出さずにすぐ `redirect_uri?code=stub&state=…` へ戻し、`/oauth/token` は ES256 の ID トークンを、`/oauth/jwks` はその公開鍵を返します。本物の portal には接続しません。

## 7. LINE 連携

LINE に送った文を OpenAI で添削・翻訳し、送った人の学習ノートに追加する機能です。会員と管理者が、Web の「LINE 連携」画面（`/account/line`）で連携コードを出し、それを LINE に送ると、その LINE とアカウントが結びつきます。ゲストは使えません。仕様は `docs/superpowers/specs/2026-10-23-line-via-go-api-design.md` にあります。

段階 10a で、LINE の受け口と画面は Web に移りました（Go から Web への切り替えは、下の「段階10（LINE とデモのリセットの cron）のマージの前と後」の順番で行います）。Go の `/v1/line/*` の 7 つのルートと、Go の Cron は、段階 10b で消えました（LINE の Webhook URL を Web に変えたあとに出します）。連携の画面と Server Actions（コードを出す・解除する・お知らせの入り切り）は、Go を呼ばず、Web が Prisma で `LineLink`・`LineLinkCode`・`LineMessage` を読み書きします。

Web の次の 2 つの Route Handler で動きます。LINE の設定（上の「Web が実行時に使う DB と秘密」）が足りないときは、どちらも `404` です。

| メソッド | パス                   | 認証                                  | 内容                                                                                                   |
| -------- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| POST     | `/api/line/webhook`    | LINE の署名（`X-Line-Signature`）     | LINE からの通知を受け取り、添削・翻訳して返信する（`src/app/api/line/webhook/route.ts`）               |
| GET      | `/api/cron/line-drain` | `Authorization: Bearer <CRON_SECRET>` | 結果が出ないまま残ったメッセージの拾い直しと、復習のお知らせ（`src/app/api/cron/line-drain/route.ts`） |

- 送った文は、webhook のリクエストの中で処理します（保存 → OpenAI → 学習ノートに保存 → reply）。reply は無料です。添削・翻訳の結果は、バッチ名 `LINE` のノートとして保存します。1 回の通知の処理は、リクエストの開始から 45 秒までで、残りが 30 秒を切った文は、保存だけして OpenAI は呼ばず、「時間がかかっています」と返します（翌朝の拾い直しが処理します）。イベントは 55 秒を過ぎると新しく始めません。
- 拾い直しは、5 分以上 `pending` のまま残ったメッセージを 1 回だけ試し直し、できたら push で、できなければ失敗を push で知らせます。1 回の実行は 50 秒で止まり、残りが 30 秒を切ったら、新しい生成は始めず次の実行に回します（試す回数を使い切った行は、生成せずに失敗にします）。push は、LINE の無料プランでは月 200 通の枠を使います。同じ実行が、希望した人へ復習のお知らせも送ります（[LINE 連携のリファレンス](../docs-site/reference/line.md#put-v1-line-review-notify)）。お知らせは今月の残りから 30 通を拾い直しのために残し、その範囲だけ送ります。
- **Cron は Web の `vercel.json` に登録しています**：`/api/cron/line-drain` は `0 21 * * *`（UTC。06:00 JST）です。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶので、Web の Production に `CRON_SECRET` が要ります。Hobby の Cron は時刻が 1 時間単位で、06:00 から最大 59 分遅れることがあります。Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までなので、この拾い直しとデモのリセットの 2 つ（どちらも 1 日 1 回）は収まります。手で呼ぶときは、`Authorization: Bearer $CRON_SECRET` を付けて `GET` します。
- `maxDuration` は、route の中で決めています（拾い直しは 60 秒、デモのリセットは 30 秒）。Web のプロジェクトにはすでに 90 秒の route（クイック質問・チャット）があるので、プロジェクトの設定を変える必要はありません。
- ログには、イベント ID・メッセージの ID・コードだけを出し、本文・生成結果・鍵・LINE のユーザー ID・連携コード・reply token は出しません。
- 使う表は `LineLink`・`LineLinkCode`・`LineMessage` の 3 つで、Prisma のマイグレーション `20261023090000_add_line_link` で作ります（本番にはすでにあります）。
- OpenAI の利用量は、操作している人ではなく LINE を結びつけた人の `AiUsage` に、機能名 `line` で記録します。
- e2e は、偽の LINE API（`e2e/line-stub.ts`）に `LINE_API_BASE_URL` を向けて確かめます。

### 切り替えの手順

LINE の Webhook を Go から Web に切り替える順番は、下の「段階10（LINE とデモのリセットの cron）のマージの前と後」にあります。LINE Developers で変えるのは、**Webhook URL** を `https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook` にすることと、「Webhook の利用」をオンのまま、「**応答メッセージ**」をオフのままにすることです（オンだと、LINE の自動応答とこちらの返信が二重に届きます）。

LINE の連携を最初から作り直すとき（以前のチャネルが無いとき）は、LINE Developers で Messaging API のチャネルを用意し、Web の Production に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`CRON_SECRET` と、任意で `LINE_ADD_FRIEND_URL` を入れてデプロイしてから、Webhook URL を設定して「検証」を押します（成功は `200`）。

## 8. ChatGPT と話す（会話ノート）

会員と管理者が Web の `/chat` で ChatGPT と中国語で話し、会話を会話ノート（`/conversations`）で見返すための設定です。Web の `POST /api/chat`（Route Handler が OpenAI を直接呼ぶ）で動き、会話ノートは Web が Prisma で読み書きします。Go API は関わりません。

- Web の Production に `OPENAI_API_KEY` があれば話せます。無いときは Web の `/chat` に「ChatGPT が設定されていません」と出ます（会話ノートは読めて、消せます）。
- モデルは Web の `OPENAI_CHAT_MODEL`（無ければ `gpt-6.1-sol`）です。クイック質問と同じ変数です。
- 使えるのは会員と管理者です。デモは会話ノートを読む・消すことはできますが、チャットで新しく聞くことはできません。ゲストには入口が出ません。
- 履歴：テーブル `ChatConversation` のマイグレーション `20261024090000_add_chat_conversations` は、Go で動かしていた段階で本番に当てたものです。いまは新しい手順は要りません。切り替えの手順は「段階7（チャット）のマージの前と後」にあります。

## 9. FFPF ID でのログイン

FFPF ID（ffpf-portal が提供する OpenID Connect のプロバイダー）のアカウントで、会員（`member`）としてログインする機能です。ログイン画面の「FFPF IDでログイン」から使います。仕様は ffpf-portal の `docs/superpowers/specs/2026-10-27-ffpf-id-design.md` の「4. zhuelog」にあります。

- 流れ：Web が PKCE・`state`・`nonce` を作って `zl_oauth` Cookie に入れ、portal の `/oauth/authorize` へ送ります。戻り先 `/api/auth/callback/ffpf` で `state` を確かめてから、Go API の `POST /v1/auth/ffpf` に `{code, codeVerifier, redirectUri, nonce}` を渡します。Go API は portal の `/oauth/token` で `code` を交換し（client_secret_basic、10 秒、リダイレクトには従いません）、ID トークンを `/oauth/jwks`（10 分キャッシュ）で検証します（ES256・`iss`・`aud`・`exp`・`nonce`・`email_verified`）。discovery は使わず、エンドポイントは `FFPF_ID_ISSUER` から組み立てます。
- 持ち主の ID は `ffpf:<sub>` です。`FfpfAccount` にメールアドレスと表示名を保存し、ログインのたびに最新の値で更新します。メールアドレスは表示用で、認可には使いません。許可リストは無く、メールアドレスを確認済みの FFPF ID なら誰でも会員になれます。
- FFPF ID の会員は、パスワード会員と同じく学習ノート・共有・フォロー・タイムライン・LINE 連携を使えます。メンバー一覧にも出ます。パスワードはこのサービスに無いので、`/account/password` には portal のマイページ（`<FFPF_ID_ISSUER>/id`）へのリンクだけを出します（パスワードを変えるフォームは出しません）。
- 誤りの扱い：入力・交換・ID トークンの検証の失敗は `401 unauthorized`、portal に届かない・5xx・JWKS が取れないときは `502 ffpf_unavailable`、設定が無いときは `503 unavailable` です。Web はどれも「認証サービスからの結果を確認できませんでした。」と出してログイン画面に戻します。
- 使う表は `FfpfAccount` で、Prisma のマイグレーション `20261027120000_add_ffpf_accounts` で作ります。

### 切り替えの手順

1. ffpf-portal で `pnpm run oidc:client zhuelog` を実行し、シークレット（`secret=…`）とクライアントの JSON を作ります。JSON の `redirectUris` に `https://<Web のホスト>/api/auth/callback/ffpf` を入れて portal の `FFPF_OIDC_CLIENTS` に足し、portal を再デプロイします（詳しくは ffpf-portal の README）。
2. マイグレーション `20261027120000_add_ffpf_accounts`（`FfpfAccount` の追加）は、main へのマージで Web の本番ビルドが自動で当てます（「4. 本番の DB の確認」）。Go API をデプロイする前に `migrate status` で適用済みを確かめ、当たっていなければ手で当てます。表を足すだけなので、今の Go API とも両立します。
3. Go API の Vercel プロジェクトの Production に `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET`・`FFPF_ID_REDIRECT_URI` を入れます。`FFPF_ID_REDIRECT_URI` は、portal に登録した redirect URI と、`<AUTH_URL の origin>/api/auth/callback/ffpf` の両方に **1 文字も違わず** 合わせます。
4. Web の Vercel プロジェクトに `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID` を入れます。
5. マージの後に、Go API のプロジェクトへ main を手でデプロイします（Git の自動デプロイは切っています）。Web は main への push で自動でデプロイされます。
6. `curl -i -X POST https://ffpf-zhuelog-api.vercel.app/v1/auth/ffpf -H 'content-type: application/json' -d '{"code":"x","codeVerifier":"x","redirectUri":"x","nonce":"x"}'` が `401`（`503` ではない）を返すことを確かめてから、本番の Web で FFPF ID のログイン・ログアウトを試します。

## 10. デモアカウント

採用担当など、アカウントを持たない人が会員向けの画面（学習ノート・今日の復習・単語帳・会話ノート・練習の記録）を試せるようにする機能です。ログイン画面の「デモで試す」から入ります。

- アカウント：`DEMO_LOGIN_ID` の ID の、普通のパスワード会員です。パスワードのハッシュは使えない値なので、ID とパスワードではログインできません。アカウントは下のリセットが作ります（手で作る必要はありません）。
- データ：デモを試す全員で 1 つのアカウントを共有します。毎晩 04:00（日本時間）ごろに、Web の `vercel.json` の Cron（`0 19 * * *`、UTC）が `GET /api/cron/demo-reset` を呼び、1 つのトランザクションで、デモの持ち物（学習ノートとヒント、CSV の取り込みの記録、復習の項目と記録、単語帳、会話ノート、クイック質問、練習の記録（介詞・補語）、フォロー（デモがしたものと、デモをフォローしているもの）、LINE の連携・連携コード・受け取った文）を消してから、`src/domain/demo/demo-fixture.json` の内容を、Web の FSRS で復習の項目にして入れ直します（例のデータは、Go が最後に作った内容と同じであることを `tests/fixtures/demo-seed-golden.json` で確かめています）。消さないものは、AI の利用量（`AiUsage`。管理者が費用を見る記録）とログインのセッション（`ApiRefreshToken` と、段階 11a で足した `Session`）です。日付は「リセットの何日前か」で書いてあるので、いつ見ても直近 7 日の記録に見えます。ログイン中のセッションは消しません。
- 使えないもの：OpenAI を呼ぶルート（Web の `POST /api/chat` と `POST /api/quick-question`）は、デモには `403`（「デモでは使えません。」）です。Web の LINE 連携の画面（`/account/line`）は `/` に戻します。パスワードの変更も、デモには使えません。断るのは Web です（Go のルートはもうありません）。フォロー・会員の一覧・タイムライン・共有（ほかの会員に届くため）は、Web が断ります（`/follow` は `/` に戻し、フォローや共有を直接送ると画面には「ログインし直してください。」と出ます）。管理者がデモとして操作しているときや、ほかの会員には当てはまりません。Web の AI のルート（単語帳の下書き・クイック質問・ChatGPT と話す）は、Web が自分でデモかどうかを確かめて断ります。Web は、自分の DB の確認（`passwordHash` が使えない値で、ログイン ID が `DEMO_LOGIN_ID` と同じ）でデモかどうかを決め、すべてのページに「デモアカウントです。…」を出し、メニューから使えない機能を外します。
- リセットは Web が行います（段階 10b で Go から移しました。`DEMO_LOGIN_ID` が空なら、Web のルートは `404` です）。Hobby の Cron は時刻が 1 時間単位なので、04:00 から最大 59 分遅れることがあります。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶので、Web の Production に `CRON_SECRET` が要ります。`maxDuration` は route に 30 秒と書いてあります。すぐ戻したいときは、下の `curl` で手でリセットします。
- 手でリセットする：`curl -i -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset -H "Authorization: Bearer $CRON_SECRET"` が `204` を返します（`GET` でも同じです）。`CRON_SECRET` を知っている人だけが呼べます。`$CRON_SECRET` は Web の Production の値です。
- マイグレーションは要りません（既存の表だけを使います）。Vercel Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までなので、LINE の拾い直しとこのリセットの 2 つ（どちらも 1 日 1 回）は収まります（どちらも Web の `vercel.json` にあります。Go の `services/api/vercel.json` に Cron は無くなりました）。

### 切り替えの手順

1. Web と Go API の両方の Vercel プロジェクトの Production に、同じ `DEMO_LOGIN_ID`（例: `demo`）を入れます。Web には `CRON_SECRET` も入れます。
2. 両方を main からデプロイします（Git の自動デプロイは切っています）。Go は、ログインの「デモで試す」のために要ります。
3. 上の `curl` でリセットを 1 回呼び、デモアカウントとデータを作ります（呼ぶまではアカウントが無く、「デモで試す」を押すと「デモは今は利用できません。」になります）。
4. 本番の Web の `/signin` に「デモで試す」が出ること、押すと学習ノートと「デモアカウントです。」が出ることを確かめます。

やめるときは、Web と Go API の両方から `DEMO_LOGIN_ID` を消して再デプロイします。ボタンが消え、Go の `POST /v1/auth/demo` は `404` になり、Web のリセットのルートも `404` になります。リセットが作ったアカウントは使えないパスワードのハッシュで見分けるので、残っているデモのセッションも同じ制限のままです。アカウントとデータは残ります。

## 運用上の注意

### `API_JWT_SECRET` のローテーション

ローテーションすると、**発行済みのアクセストークンはすべて無効になります**（署名が合わなくなるため）。リフレッシュトークンは DB のハッシュで検証するので影響を受けず、アプリは `POST /v1/auth/refresh` で新しいアクセストークンを取り直せます。新しい値を環境変数に設定し、再デプロイすると反映されます。入れ替えの途中は、古いインスタンスと新しいインスタンスが短い時間並んで動くため、古い鍵と新しい鍵のトークンが一時的に混在します。

### レート制限とクライアントの IP

`/v1/auth/*` には 2 種類の制限があります。

- **IP ごとのレート制限**: DB の `SignInThrottle` テーブルで数えるので、インスタンスが増えても合計で数えます。1 分に 10 回までです（`/v1/auth/*` の 6 つで同じ枠を共有）。Web のパスワード変更も同じ鍵（`route:auth:<IP>`）を `SignInThrottle` で数えるので、同じ枠に入ります。`POST /v1/auth/refresh` だけは別の枠で、1 分に 60 回までです。Web は開いているタブごとにリフレッシュするので、ログインと同じ枠だとリフレッシュがログインを締め出してしまうためです。メモリ上で数えるのは、DB で数える設定が無いとき（ローカルのテスト）だけです。
- **パスワードログインの試行回数**: DB の `SignInThrottle` テーブルで数えます。Web からのログインも Go API を通るので、Web とアプリの試行は合わせて数えます。15 分の枠で、1 つのクライアントからのパスワードログインは 20 回まで、同じクライアントから同じ loginId へは 5 回まで（成功すると 0 に戻ります）。超えると `429`（`rate_limited`）を返します。

どちらも、クライアントのアドレスには、次の順で決まる値を使います。

1. `X-Zhuelog-Proxy-Secret` ヘッダーが `API_WEB_PROXY_SECRET` と一致し（定数時間で比べます）、`X-Zhuelog-Client-IP` が空でなければ、その値。Web（Next.js）から Go API を呼ぶと、Go API から見た送信元は Vercel の関数になり、全員が 1 つの IP として数えられてしまいます。そこで Web が利用者の IP を `X-Zhuelog-Client-IP` で渡します。秘密が一致しないとき、`API_WEB_PROXY_SECRET` が未設定のときは、このヘッダーを常に無視します。
2. そうでなければ、`X-Forwarded-For` の **最後の値**（無ければ接続元のアドレス）。Vercel はこのヘッダーをクライアントの IP で上書きし、クライアントが送った値は渡さないので、偽装されません。**Vercel の前に別のプロキシ（CDN など）を置かないでください。** 置くと、すべてのクライアントがそのプロキシの 1 つのアドレスとして数えられます。

### リフレッシュの猶予（30 秒）

ブラウザは同時に複数の要求を出すので、同じリフレッシュトークンで `POST /v1/auth/refresh` が同時に起こることがあります。2 本目を「使用済みのトークン」として扱うと、ファミリー全体が失効して利用者がログアウトされてしまいます。そこで、ローテーションから **30 秒以内** に、同じファミリーに有効なトークンが残っているときは、古いトークンが来てもファミリーを失効させず、同じファミリーで新しいトークン一式を出します。30 秒を過ぎた古いトークン、またはファミリーが失効済み（ログアウト・再利用の検知）のときは、今までどおり盗用とみなして `401` です。

残るリスク：盗まれたトークンが、本人のリフレッシュと同じ 30 秒のうちに使われたときは、再利用として検知できません。猶予の長さは固定です（設定で変えられません）。

もう 1 つ、受け入れている残るリスクがあります。ログアウトの直前に並行した要求がリフレッシュしていると、そのアクセストークンの Cookie が最長 15 分のあいだ有効なまま残ることがあります（リフレッシュトークン自体はログアウトで失効しています）。

### ゲストのセッション

`POST /v1/auth/guest` は認証なしで、ゲストのトークン一式を返します（`role: "guest"`、`ownerId: "guest"`）。`API_WEB_PROXY_SECRET` を設定したときは、`X-Zhuelog-Proxy-Secret` が一致する呼び出し（Web のサーバー）だけを受け付け（定数時間で比べます）、一致しない・無いときは `403`（`forbidden`）です。未設定のとき（ローカルの開発）は誰でも呼べます。ログイン情報なしで呼べるので、DB の行を増やされにくいよう、ゲストのリフレッシュトークンの寿命は **24 時間** です。期限切れの行は、ゲストがログインするたびに削除します。ゲストのトークンは `GET /v1/me` 以外の認証つきルートでは `403` です。

### デモのセッション

`POST /v1/auth/demo` は、パスワードなしでデモアカウント（`DEMO_LOGIN_ID`）の会員のトークン一式を返します。ゲストと同じく、`API_WEB_PROXY_SECRET` を設定したときは Web のサーバーからの呼び出しだけを受け付けます。`/v1/auth/*` のレート制限に加えて、`SignInThrottle` で 1 つのクライアントから 15 分に 20 回まで（キーは `demo:<IP>`）です。デモが無い・アカウントがまだ無いときは `404` です。`GET /v1/auth/demo` は、デモが設定されていれば `204`、無ければ `404` を返します（ログイン画面が「デモで試す」を出すかどうかに使います）。

### DB の接続数とパスワードの計算

Go API は 1 つのインスタンスあたり最大 3 本の DB 接続を持ちます。Vercel がインスタンスを増やすと接続数も増えるので、Neon の pooled 接続文字列を使ってください。

パスワードの検証（scrypt、N=2^15・r=8）は 1 回ごとに 32 MiB を使うため、インスタンスごとに同時に 4 件までしか計算しません（5 件目以降は空くまで待ちます）。パスワードのハッシュ（作成・再設定・変更）と検証は、Web でも `crypto.scrypt` で計算します（1 回ごとに 32 MiB を使います）。専用の上限は付けていませんが、Node の threadpool（既定は 4 本）が上限になり、同時に動くのは 4 件まで、残りは待ちます。この threadpool はファイルや DNS の処理と共有です。

### 公開範囲

エンドポイントはインターネットに公開します。アプリから直接呼ぶ API で、認証はアプリ層（アクセス JWT）で行うためです。CORS は設定していません（ブラウザから直接は呼びません）。
