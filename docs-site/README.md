---
home: true
title: 概要
heroText: Zhuelog API
tagline: 学习録（Zhuelog）のネイティブアプリ向け Go API
actions:
  - text: 認証の仕組み
    link: /guide/auth.md
    type: primary
  - text: エンドポイント
    link: /reference/
    type: secondary
features:
  - title: Web も同じ API を使う
    details: Web（Next.js）も、ログインと学習ノートの読み書きをこの API で行います。DB を読み書きするのは API だけです。
  - title: アプリ向けのトークン
    details: GitHub（PKCE）とパスワードでログインし、15 分のアクセストークンと 30 日のリフレッシュトークンで呼び出します。
  - title: 依存の少ない Go
    details: 標準の net/http と pgx・golang-jwt・x/crypto だけで書かれ、Vercel（Go の Framework Preset）で動きます。
---

## 何のための API か

学习録は、中国語の作文を添削・翻訳した結果（学習ノート）を記録する Web アプリです。この Go API（`services/api/`）は、iOS などのネイティブアプリから自分の学習ノートを読み書きするためのものです。

- 利用できるのは、GitHub でログインする **admin**（許可リスト `AUTH_ALLOWED_GITHUB_IDS` に GitHub の数値のユーザー ID が載っている人）と、パスワードでログインする **会員**（`PasswordAccount`）です。ゲスト（`POST /v1/auth/guest`）も入れますが、ゲストのトークンで呼べるのは `GET /v1/me` だけです。
- 学習ノートの一覧・詳細・作成・編集、ゴミ箱、共有、フォローとタイムライン、日付ごとの記録（カレンダー）、admin による会員の管理、CSV のインポートまで、Web にある機能を一通り扱えます。
- ブラウザから呼ぶことは想定していません（CORS は無効です）。
- 添削・翻訳の実行（LLM の呼び出し）は、LINE 連携（`/v1/line/*`）の中だけにあります。会員が自分の LINE を結びつけ、LINE に送った文を OpenAI で添削・翻訳して、学習ノートに保存します（[LINE 連携](./reference/line.md)）。ほかのルートからは呼べません。

## 構成

`services/api/` は独立した Go モジュールで、Web のコードには依存しません。

```text
services/api/
├── main.go        # 起動・設定の読み込み・graceful shutdown
├── config.go      # 環境変数の読み込みと検証
├── httpapi/       # ルーター、ハンドラ、ミドルウェア、入力の検証
├── auth/          # GitHub のコード交換、パスワードの検証、JWT、リフレッシュのローテーション、失効の確認
├── store/         # pgx による SQL（ノート・バッチ・ヒント・ゴミ箱・フォロー・アカウント・リフレッシュトークン・LINE の連携とメッセージ）
├── line/          # LINE の署名の検証、webhook の読み取り、返信・push、返信文の整形、添削と翻訳の振り分け
├── linebot/       # LINE の連携コード、メッセージの処理、拾い直し
├── learning/      # OpenAI の Responses API の呼び出しと、返事の形の確認
├── csvimport/     # CSV の解析（Web の CsvParseLearningParser と同じ結果になるように移植したもの）
├── jsstr/         # JavaScript の文字列操作（trim・length・toLowerCase など）の再現
└── Dockerfile        # 任意（コンテナで動かすとき用。Vercel では使わない）
```

| パッケージ  | 役割                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `httpapi`   | 標準の `net/http` のパターンルーティング（`GET /v1/entries/{id}` の形）。`auth` と `store` をインターフェース経由で受け取り、テストではフェイクに差し替えます                   |
| `auth`      | ログイン、アクセストークン（HS256 の JWT）の発行と検証、リフレッシュトークンのローテーションと再利用の検知、毎リクエストの失効の確認、scrypt によるパスワードの検証とハッシュ化 |
| `store`     | Prisma が作ったテーブルを SQL で読み書きします。所有者（`ownerId`）での絞り込みはすべてここで行います                                                                           |
| `csvimport` | `csv-parse` の動作を移植した CSV の読み取りと、Web と同じ文言の検証エラー                                                                                                       |
| `line`      | LINE の署名の検証、webhook の本文の読み取り、reply・push の呼び出し、返信文の整形、文を添削と翻訳に振り分ける規則                                                               |
| `linebot`   | LINE の連携コードの発行と使用、届いたメッセージの保存と処理、`pending` のメッセージの拾い直し                                                                                   |
| `learning`  | OpenAI の Responses API（`gpt-5-mini`、`store: false`）の呼び出しと、返事の形・長さの確認                                                                                       |
| `jsstr`     | JavaScript の文字列操作（`trim`・`length`（UTF-16 の単位）・`slice`・`toLowerCase`）を再現し、入力を Web（zod）と同じように判定するためのパッケージ                             |

依存は `github.com/jackc/pgx/v5`、`github.com/golang-jwt/jwt/v5`、`golang.org/x/crypto`（scrypt）だけで、ルーターやフレームワークは使いません。ログは `log/slog` の JSON 形式で、トークン・認可コード・パスワード・ノートの本文・CSV の中身はログに出しません。

## Web と API と DB

Web（Next.js）は DB に直接つながりません。ログインも学習ノートの読み書きも、この API を通して行います。DB は本番の Neon で、読み書きするのは API だけです。

- スキーマの管理は Prisma に一本化しています。Go は既存のテーブルを SQL で読み書きするだけで、テーブルの追加（API 用の `ApiRefreshToken` など）も Prisma のマイグレーションで行います。
- Go が作る行の ID は Prisma と同じ cuid 形式なので、以前 Web が作った行と区別がつきません。
- 日付の区切り（日本時間）、会員一覧の並び（ICU の日本語照合順）、CSV の解析、入力の検証の文言は、以前の Web と同じにしてあります。
- 会員のパスワードのハッシュ（`scrypt:N:r:p:salt:key`）は、以前 Web で作った会員と同じ形式です。そのまま API でログインできます。パスワードを変えると `sessionVersion` が上がり、既存のログインがすべて無効になります。
- パスワードログインの試行回数は `SignInThrottle` テーブルで数えます。Web からのログインも API を通るので、同じクライアントからの Web とアプリの試行は、合わせて数えられます。

### 環境変数

| 名前                                                                            | 内容                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                                          | 待ち受けポート（既定 8080）                                                                                                                                                                                        |
| `DATABASE_URL`                                                                  | Neon の接続文字列（pooled）                                                                                                                                                                                        |
| `API_JWT_SECRET`                                                                | アクセストークンの HS256 鍵。32 バイト以上                                                                                                                                                                         |
| `GITHUB_MOBILE_CLIENT_ID` / `GITHUB_MOBILE_CLIENT_SECRET`                       | モバイル用の GitHub OAuth App（Web 用とは別）                                                                                                                                                                      |
| `GITHUB_MOBILE_REDIRECT_URI`                                                    | アプリのカスタム URL スキーム。リクエストの `redirectUri` と完全一致を要求します                                                                                                                                   |
| `GITHUB_WEB_CLIENT_ID` / `GITHUB_WEB_CLIENT_SECRET` / `GITHUB_WEB_REDIRECT_URI` | Web 用の GitHub OAuth App（Web の GitHub ログインに必要）。3 つとも設定するか、すべて空。`redirectUri` が完全一致した方の OAuth App で交換します（Web の callback は `https://<Web>/api/auth/callback/github/go`） |
| `API_WEB_PROXY_SECRET`                                                          | 32 バイト以上。Web が `X-Zhuelog-Proxy-Secret` で渡す秘密（Web から使うときは必要）。一致したときだけ `X-Zhuelog-Client-IP` を利用者の IP として信頼します                                                         |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `OPENAI_API_KEY`          | LINE 連携（[LINE 連携](./reference/line.md)）に必要。3 つとも設定するか、すべて空（一部だけだと起動時に終了）。すべて空のときは `/v1/line/*` が `404` になります                                                   |
| `CRON_SECRET`                                                                   | `GET /v1/line/drain`（拾い直し）の `Authorization: Bearer` の秘密。空のときは、このルートは常に `401`                                                                                                              |
| `OPENAI_API_BASE_URL` / `LINE_API_BASE_URL`                                     | テスト専用の接続先の差し替え。ループバックの URL だけを受け付け、それ以外は起動時に終了します。本番には設定しません                                                                                                |
| `AUTH_ALLOWED_GITHUB_IDS`                                                       | admin の許可リスト。GitHub の数値のユーザー ID をカンマ区切りで並べる（前後の空白は除き、数字以外の値は無視）                                                                                                      |

`PORT`・`GITHUB_WEB_*`・`API_WEB_PROXY_SECRET`・LINE 連携の設定（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`CRON_SECRET`・`*_API_BASE_URL`）以外はすべて必須で、無い・不正なときは起動時に終了します。`GITHUB_WEB_*` と `API_WEB_PROXY_SECRET` は API の起動には要りませんが、Web から使うときは必要です。

## 関連する文書

このサイトは、リポジトリの次の文書とコードを元にしています。食い違いがあれば、コード（`services/api/`）が正です。

- `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md`（v1：認証とノートの読み書き）
- `docs/superpowers/specs/2026-10-21-go-api-trash-share-follow-design.md`（ゴミ箱・共有・フォロー）
- `docs/superpowers/specs/2026-10-21-go-api-web-parity-design.md`（カレンダー・会員の管理・CSV など）
- `docs/superpowers/specs/2026-10-23-line-via-go-api-design.md`（LINE の添削・翻訳）
- `docs/api-local.md`（ローカルで動かす）、`docs/api-deployment.md`（Vercel へのデプロイ）
