# ネイティブアプリ向け Go API（認証つき学習データの読み書き）

## 目的と承認済みの要件

ネイティブアプリ（iOS など）から、自分の学習データ（`LearningEntry`・`Hint`）を読み書きできる API を Go で新設する。Web（Next.js）とは別プロセスとして AWS ECS Express Mode（`ap-northeast-1`）で常駐させ、DB は本番と同じ Neon を共有する。

- 利用者は GitHub の admin（`AUTH_ALLOWED_GITHUB_LOGINS`）とパスワード会員（`PasswordAccount`）。ゲストはログインできない。
- アプリはログイン後、Go API が発行するアクセス JWT とリフレッシュトークンで API を呼ぶ。
- v1 の範囲は自分のエントリーの一覧・詳細・作成・編集・ゴミ箱への移動。ゴミ箱の一覧・復元・完全削除、共有、フォローは Web で扱い、API には含めない。
- ブラウザからの利用は想定しない（CORS は無効）。

## 構成

`services/api/` に独立した Go モジュールを置く。Web のコードには依存しない。

```
services/api/
├── go.mod
├── main.go        # 起動・設定読み込み・graceful shutdown
├── config.go      # 環境変数の読み込みと検証
├── httpapi/       # 標準 net/http のパターンルーティング、ハンドラ、ミドルウェア
├── auth/          # GitHub コード交換、パスワード検証、JWT、リフレッシュのローテーション、失効確認
├── store/         # pgx による SQL（エントリー・バッチ・ヒント・アカウント・リフレッシュトークン）
└── Dockerfile
```

- `httpapi` は `auth` と `store` をインターフェース経由で受け取り、テストではモックに差し替える。
- `auth` の GitHub 通信は HTTP クライアントを注入し、テストでは `httptest.Server` に置き換える。
- 依存は `github.com/jackc/pgx/v5`、`github.com/golang-jwt/jwt/v5`、`golang.org/x/crypto`（scrypt）に限る。ルーターやフレームワークは使わない。
- ログは `log/slog` の JSON 形式。トークン・認可コード・パスワード・エントリー本文はログに出さない。

### 環境変数

| 名前                                                      | 内容                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PORT`                                                    | 待ち受けポート（既定 8080。ECS ではコンテナポート 8080 を使う）                |
| `DATABASE_URL`                                            | Neon の接続文字列（pooled）                                                    |
| `API_JWT_SECRET`                                          | アクセス JWT の HS256 鍵。32 バイト以上。Auth.js の `AUTH_SECRET` とは別       |
| `GITHUB_MOBILE_CLIENT_ID` / `GITHUB_MOBILE_CLIENT_SECRET` | モバイル用に新規登録する GitHub OAuth App                                      |
| `GITHUB_MOBILE_REDIRECT_URI`                              | アプリのカスタム URL スキーム。リクエストの `redirectUri` と完全一致を要求する |
| `AUTH_ALLOWED_GITHUB_LOGINS`                              | Web と同じ admin の許可リスト（カンマ区切り）                                  |

必須の値が無い・不正なときは起動時に終了する。pgx のプールは最大 5 接続とする。

## スキーマ

スキーマの管理は Prisma に一本化する。Go は既存テーブルを SQL で読み書きするだけで、テーブル追加は Prisma マイグレーションで行う。

追加するテーブル:

```prisma
model ApiRefreshToken {
  id             String    @id @default(cuid())
  ownerId        String
  role           String    // "admin" | "member"
  sessionVersion Int?      // member のみ。発行時の PasswordAccount.sessionVersion
  login          String?   // admin のみ。GitHub のログイン名（リフレッシュ時に許可リストを再確認する）
  tokenHash      String    @unique // SHA-256 の hex
  familyId       String
  expiresAt      DateTime
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())

  @@index([familyId])
  @@index([ownerId])
}
```

Go 側で作る行の ID は Prisma と同じ cuid 形式で生成し、Web が作った行と区別がつかないようにする。本番 Neon へのマイグレーション適用はマージ前に行う。

## 認証

### GitHub ログイン（admin）

1. アプリが PKCE（S256）で GitHub の認可画面を開き、カスタム URL スキームで `code` を受け取る。
2. `POST /v1/auth/github` に `{code, codeVerifier, redirectUri}` を送る。
3. Go が `client_secret` と `code_verifier` を使って GitHub のトークンエンドポイントで交換し、`GET /user` で数値 ID とログイン名を得る。GitHub への通信はそれぞれ 10 秒でタイムアウトする。
4. ログイン名を前後の空白を除いて小文字にし、許可リストと照合する。含まれなければ 403。
5. `ownerId` を GitHub の数値 ID、`role` を `admin` としてトークンを発行する。GitHub のアクセストークンは保存しない。

### パスワードログイン（会員）

`POST /v1/auth/password` に `{loginId, password}` を送る。Web の `AuthenticatePasswordAccount` と同じ規則に従う。

- `loginId` は前後の空白を除いて小文字にし、`^[a-z0-9._-]{3,32}$` に一致すること。`password` は 1〜128 文字。
- 試行の予約は 1 つの UPDATE 文でアトミックに行う。ロック中なら何も変えずに失敗とし、前回のロックが切れていれば回数を 1 から数え直す。5 回目でロック期限を 15 分後に設定する。成功したら失敗回数とロックを消す。
- 形式不正・存在しない ID・ロック中・パスワード違いはすべて同じ 401 を返し、どの経路でも scrypt を 1 回計算する（存在しない ID などはプロセス内で 1 度だけ作るダミーハッシュで検証する）。
- ハッシュ形式は `scrypt:N:r:p:salt:key`（salt・key は base64url、key は 64 バイト）。Web と同じく N ≤ 2^15・r ≤ 8・p ≤ 4 を超えるものは拒否し、比較は定数時間で行う。
- 成功したら `ownerId` を `password:<PasswordAccount.id>`、`role` を `member` としてトークンを発行する。

### アクセストークン

HS256 の JWT。有効期限 15 分。クレームは `iss`・`aud`（固定値）、`sub`（ownerId）、`role`、`iat`、`exp`、admin は `login`、member は `sv`（sessionVersion）。

`Authorization: Bearer` を毎リクエスト検証し、署名・`iss`・`aud`・期限に加えて失効を確認する。

- admin: `login` が現在の許可リストに含まれること。外されたら期限前でも 403。
- member: `PasswordAccount` が存在し、その `sessionVersion` が `sv` と一致すること。一致しなければ 401（パスワードの変更・リセットで即時に失効する）。

### リフレッシュトークン

- ランダム 32 バイトの base64url。DB には SHA-256 のハッシュだけを保存する。有効期限 30 日。
- `POST /v1/auth/refresh` は `{refreshToken}` を受け取り、行を `revokedAt` で失効させて同じ `familyId` の新しい組を返す。失効と発行は 1 トランザクションで行う。
- 失効済みのトークンが提示されたら盗用とみなし、ファミリー全体を失効させて 401。
- リフレッシュ時もアクセストークンと同じ失効確認を行う。member は行の `sessionVersion` と DB の値を比べる。失効していればファミリーを失効させて 401（admin が許可リストから外れた場合は 403）。
- `POST /v1/auth/logout` は `{refreshToken}` のファミリーを失効させて 204。未知のトークンでも 204。
- ログイン成功時に、その `ownerId` の期限切れの行を削除する。失効済みの行は、同じファミリーに未失効かつ期限内の行が残っていない場合に限って削除する（生きているファミリーの失効済みトークンを残すことで、再ログイン後も再利用検知が効く）。cron は使わない。

## エンドポイント

本文と応答はすべて JSON。`/v1/auth/*` と `/health`・`/healthz` 以外はアクセストークンが必要。応答には `Cache-Control: no-store` を付ける。

| メソッド | パス                         | 内容                                                      |
| -------- | ---------------------------- | --------------------------------------------------------- |
| POST     | `/v1/auth/github`            | GitHub ログイン。`{accessToken, refreshToken, expiresIn}` |
| POST     | `/v1/auth/password`          | パスワードログイン。応答は同上                            |
| POST     | `/v1/auth/refresh`           | トークンのローテーション。応答は同上                      |
| POST     | `/v1/auth/logout`            | ファミリーを失効。204                                     |
| GET      | `/v1/entries?cursor=&limit=` | 自分の一覧                                                |
| GET      | `/v1/entries/{id}`           | 詳細                                                      |
| POST     | `/v1/batches`                | 一括作成。201                                             |
| PATCH    | `/v1/entries/{id}`           | 部分更新                                                  |
| DELETE   | `/v1/entries/{id}`           | ゴミ箱へ移動。204                                         |
| GET      | `/health`                    | DB に ping して 200。失敗時 503。ALB のヘルスチェック用   |
| GET      | `/healthz`                   | `/health` と同じ。ローカル用                              |
| GET      | `/ping`                      | DB にアクセスせず 200。ALB のヘルスチェック用             |

本番の手動の確認には `/health` を、ALB のヘルスチェックには DB にアクセスしない `/ping` を使い、`/healthz` はローカルでの確認用に残す（当初の候補だった Cloud Run が `/healthz` を予約していたため `/health` を正とした）。どちらもレート制限と認証の対象外。

### 所有者とゴミ箱

- すべての読み書きを `ownerId = <トークンの sub>` で絞り込む。他人のエントリーは存在しない場合と同じ 404 にする。
- 一覧・詳細・PATCH は `deletedAt IS NULL` のものだけを対象にする。
- DELETE は `deletedAt = now()` を設定する。すでにゴミ箱にあれば 404。復元・完全削除は Web で行う。
- `sharedAt` は応答に含めるが、API からは変更できない。

### 一覧

`createdAt` の降順、同時刻は `id` の降順。カーソルは最後の要素の `(createdAt, id)` を base64url にしたもので、`limit` は既定 50・最大 100。応答は `{entries: [...], nextCursor}`（続きが無ければ `null`）。各エントリーはヒントを `position` 順に含める。

エントリーの形:

```json
{
  "id": "…",
  "kind": "correction",
  "originalText": "…",
  "correctedText": "…",
  "pinyin": "…",
  "hints": [{ "id": "…", "content": "…", "position": 0 }],
  "createdAt": "2026-10-20T00:00:00Z",
  "sharedAt": null
}
```

### 一括作成

`POST /v1/batches` は `{entries: [{kind?, originalText, correctedText, pinyin, hints: ["…"]}]}` を受け取る。1 トランザクションで `ImportBatch` を 1 件（`fileName` は `mobile:<UTC の ISO 8601 日時>`、`rowCount` は件数）作り、各エントリーに `ownerId` を付けて入れる。応答は `{batch: {id, importedAt}, entries: [...]}`。

### 編集

`PATCH /v1/entries/{id}` は `kind`・`originalText`・`correctedText`・`pinyin`・`hints` のうち送られたものだけを更新する。`hints` があれば既存のヒントを消して配列の順に入れ直す。1 トランザクションで行い、更新後のエントリーを返す。空の本文は 400。

### 入力検証

- `originalText`・`correctedText`・`pinyin` は前後の空白を除いて空でなく、2,000 文字以内（CSV インポートと同じく 3 つとも必須）。
- `kind` は `correction` か `translation`。作成時に省略すると `correction`。
- ヒントは 1 エントリー 20 件まで、各 500 文字以内で空不可。`position` はサーバーが配列の順に 0 から振る。
- 一括作成は 1〜500 件。
- 本文は 1 MiB まで。未知のフィールドは 400。

## エラー処理

形式は `{"error": {"code": "…", "message": "…"}}` に統一する。

| HTTP | code                 | 状況                                     |
| ---- | -------------------- | ---------------------------------------- |
| 400  | `invalid_request`    | 検証エラー、JSON 不正                    |
| 401  | `unauthorized`       | トークンが無い・無効・失効、ログイン失敗 |
| 403  | `forbidden`          | 許可リストに含まれない admin             |
| 404  | `not_found`          | 対象が無い、他人のもの、ゴミ箱の中       |
| 413  | `too_large`          | 本文が 1 MiB を超える                    |
| 429  | `rate_limited`       | レート制限                               |
| 502  | `github_unavailable` | GitHub との通信失敗                      |
| 500  | `internal`           | その他。詳細はログにだけ出す             |

panic はミドルウェアで捕まえて 500 にする。`/v1/auth/*` には IP ごとにメモリ上で 1 分 10 回の制限をかける（インスタンスごとの制限で、パスワードの総当たりは DB のロックで防ぐ）。IP は ALB が付ける `X-Forwarded-For` の末尾の値を使う。

## テスト

- `auth`: JWT の発行と検証（期限切れ・署名違い・`aud` 違い）、許可リストの照合、`sessionVersion` による失効、リフレッシュのローテーションと再利用検知、Web が作った scrypt ハッシュの検証（Node で作ったハッシュをテストデータに含める）、GitHub のコード交換（`httptest.Server`）。
- `httpapi`: `httptest` で全エンドポイントの成功とエラーを確認する。store はモック。
- `store`: `compose.yaml` の Postgres に `prisma migrate deploy` を適用した DB で、所有者の絞り込み、ゴミ箱、トランザクション、Cascade、ログイン試行の予約とロックを確認する。本番 DB を誤って書き換えないよう、接続先は `DATABASE_URL` ではなく専用の `API_TEST_DATABASE_URL` から読み、無ければ skip する。
- `scripts/test-unit.mjs` に `services/api` の `go vet` と `go test -race` を加える。CI の `ci.yml` には Postgres のサービスコンテナつきの Go ジョブを追加する。

## デプロイ

- `services/api/Dockerfile`: `golang` イメージで `CGO_ENABLED=0` の静的バイナリを作り、`gcr.io/distroless/static` で動かす。非 root ユーザー。
- AWS ECS Express Mode（`ap-northeast-1`）で動かす。詳細は `docs/superpowers/specs/2026-10-20-go-api-aws-deploy-design.md`。
- `.github/workflows/api-deploy.yml`: main への push のうち `services/api/**` に変更があるときに、GitHub OIDC で AWS のロールを引き受け、ECR へ push して `aws-actions/amazon-ecs-deploy-express-service` でデプロイする。
- 秘密情報（`DATABASE_URL`・`GITHUB_MOBILE_CLIENT_SECRET`・`API_JWT_SECRET`）は Secrets Manager から注入する。
- タスクは最小 1、最大 2（Neon の接続数を抑える）。
- AWS 側の準備（ECR・IAM・Secrets Manager）と、モバイル用 GitHub OAuth App の登録はユーザーが行う。手順は `docs/api-deployment.md` に書く。

## 範囲外

- ゴミ箱の一覧・復元・完全削除、共有の切り替え、フォローと共有エントリーの閲覧
- 添削・翻訳の実行（LLM 呼び出し）
- ネイティブアプリ本体
- ゲストのログイン、第三者向けの OAuth 認可サーバー
