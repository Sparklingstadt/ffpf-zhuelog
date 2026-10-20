# ネイティブアプリ向け Go API 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ネイティブアプリが GitHub またはパスワードでログインし、自分の学習エントリーを読み書きできる Go API を `services/api/` に作り、Cloud Run にデプロイできるようにする。

**Architecture:** 標準 `net/http` のサーバー。`store`（pgx で Prisma 管理のテーブルを読み書き）、`auth`（ログイン・JWT・リフレッシュ・失効確認）、`httpapi`（ルーティング・検証・エラー応答）の 3 パッケージに分け、`httpapi` はインターフェース越しに残り 2 つを使う。スキーマ追加は Prisma マイグレーションで行う。

**Tech Stack:** Go 1.27、`github.com/jackc/pgx/v5`、`github.com/golang-jwt/jwt/v5`、`golang.org/x/crypto/scrypt`、Prisma 7、Postgres 17（`compose.yaml`）、GitHub Actions、Cloud Run。

**Spec:** `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md`

## Global Constraints

- Go モジュールは `services/api/`、モジュールパスは `github.com/Sparklingstadt/ffpf-zhuelog/services/api`、`go 1.27.0`。
- 外部依存は `pgx/v5`・`golang-jwt/jwt/v5`・`golang.org/x/crypto` のみ。ルーター・フレームワーク不可。
- スキーマ変更は Prisma マイグレーションだけで行う。Go から DDL を実行しない。
- Prisma の列は `TIMESTAMP(3)`（タイムゾーンなし・UTC）。Go から渡す時刻は必ず `.UTC().Truncate(time.Millisecond)` する。
- Go が作る行の ID は `c` + 小文字英数字 24 文字（Prisma の cuid と同じ見た目。Web の `^[a-z0-9]{20,32}$` に合う）。
- ownerId は admin が GitHub の数値 ID（`^\d+$`）、会員が `password:<PasswordAccount.id>`。
- アクセス JWT: HS256、15 分、`iss` = `ffpf-zhuelog-api`、`aud` = `ffpf-zhuelog-mobile`。リフレッシュ: ランダム 32 バイト base64url、SHA-256 hex で保存、30 日。
- ロックアウト: 5 回失敗で 15 分。パスワード 1〜128 文字。loginId は trim + 小文字化して `^[a-z0-9._-]{3,32}$`。
- scrypt ハッシュ `scrypt:N:r:p:salt:key`（base64url、key 64 バイト）。N は 2 のべき乗かつ 2 ≤ N ≤ 32768、1 ≤ r ≤ 8、1 ≤ p ≤ 4。新規生成時は N=32768, r=8, p=1, salt 16 バイト。
- 文字数の上限は rune 数で数える（中国語・日本語のため）。
- 本文 1 MiB、一括作成 1〜500 件、本文 3 項目は trim 後に空不可で 2,000 文字以内、ヒント 20 件まで・各 500 文字以内で空不可、`kind` は `correction`/`translation`（作成時の省略は `correction`）、一覧の `limit` は既定 50・最大 100。
- エラー応答は `{"error":{"code":"…","message":"…"}}`。全応答に `Cache-Control: no-store`。
- トークン・認可コード・パスワード・エントリー本文をログに出さない。
- DB を使うテストは `API_TEST_DATABASE_URL` から接続し、無ければ `t.Skip`。`DATABASE_URL` は読まない。テスト間の干渉を避けるため、各テストは固有の ownerId（例: `password:` + 新しい ID）や loginId を使い、TRUNCATE しない。
- コミットは pre-commit フックが `pnpm` の lint/typecheck を走らせる。`DATABASE_URL` が無い環境では `DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public"` を付けてコミットする。

## Review Focus

- 同じリフレッシュトークンで 2 つのリクエストが同時に来たとき、新しい組が 2 つ出ないこと（ちょうど 1 つだけ成功し、もう一方は再利用として扱われる）→ Task 4 の `TestRotateRefreshTokenConcurrent`。
- 中国語 2,000 文字ちょうどは通り、2,001 文字は 400 になること（バイト数で数えない）→ Task 9 の `TestValidateDraftRuneLimits`。
- 一括作成で同じ `createdAt` のエントリーが並んでも、ページングで抜けも重複も起きないこと → Task 3 の `TestListEntriesPaginatesTies`。
- 改ざんされたカーソルや不正な `limit`（`0`・`101`・`abc`）が 500 ではなく 400 になること → Task 9 の `TestListEntriesBadQuery`。
- Web（Node）が作った scrypt ハッシュでログインできること、`"  Alice "` のような loginId が正規化されること → Task 5 の `TestVerifyNodeHash`、Task 7 の `TestLoginPasswordNormalizesLoginID`。

---

## ファイル構成

```
prisma/schema.prisma                                   # ApiRefreshToken を追加
prisma/migrations/20261020120000_add_api_refresh_tokens/migration.sql
services/api/go.mod, go.sum
services/api/main.go                                   # 配線・graceful shutdown
services/api/config.go, config_test.go                 # 環境変数
services/api/Dockerfile, .dockerignore
services/api/store/store.go                            # Open/Ping/Close、ErrNotFound、newID
services/api/store/testdb_test.go                      # API_TEST_DATABASE_URL のヘルパー
services/api/store/entries.go, entries_test.go
services/api/store/accounts.go, accounts_test.go
services/api/store/refresh_tokens.go, refresh_tokens_test.go
services/api/auth/token.go, token_test.go              # Signer、Principal、TTL 定数
services/api/auth/password.go, password_test.go        # scrypt 検証・ダミー
services/api/auth/allowlist.go, allowlist_test.go
services/api/auth/github.go, github_test.go
services/api/auth/service.go, service_test.go          # ログイン・リフレッシュ・失効確認
services/api/httpapi/respond.go                        # JSON・エラー応答
services/api/httpapi/middleware.go, middleware_test.go # recover・ログ・本文制限・レート制限・Bearer
services/api/httpapi/router.go
services/api/httpapi/auth_handlers.go, auth_handlers_test.go
services/api/httpapi/validate.go, validate_test.go
services/api/httpapi/entry_handlers.go, entry_handlers_test.go
scripts/test-unit.mjs                                  # Go の vet/test を追加
.github/workflows/ci.yml                               # Go ジョブを追加
.github/workflows/api-deploy.yml
docs/api-deployment.md
.env.example                                           # API 用の変数（コメント）
```

---

### Task 1: Go モジュール・設定・CI

**Files:**

- Create: `services/api/go.mod`, `services/api/config.go`, `services/api/config_test.go`, `services/api/main.go`（この時点では `func main()` で設定を読んで終了するだけ）
- Modify: `scripts/test-unit.mjs`, `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `type Config struct { Port string; DatabaseURL string; JWTSecret []byte; GitHubClientID, GitHubClientSecret, GitHubRedirectURI string; AllowedGitHubLogins string }` と `func LoadConfig(getenv func(string) string) (Config, error)`（package `main`）。

- [ ] **Step 1: 失敗するテストを書く** — `config_test.go`
  - `TestLoadConfigDefaults`: 必須 6 変数（`DATABASE_URL`, `API_JWT_SECRET`（32 文字）, `GITHUB_MOBILE_CLIENT_ID`, `GITHUB_MOBILE_CLIENT_SECRET`, `GITHUB_MOBILE_REDIRECT_URI`, `AUTH_ALLOWED_GITHUB_LOGINS`）だけを与えると `Port == "8080"`。
  - `TestLoadConfigMissing`: 6 つのうち 1 つずつ空にすると、毎回エラーで、メッセージに変数名を含む。
  - `TestLoadConfigShortSecret`: `API_JWT_SECRET` が 31 バイトでエラー。
- [ ] **Step 2: 失敗を確認** — `cd services/api && go test ./...` → `LoadConfig` 未定義で FAIL。
- [ ] **Step 3: 実装** — `go mod init github.com/Sparklingstadt/ffpf-zhuelog/services/api`、`go 1.27.0`。`LoadConfig` は値を `strings.TrimSpace` して検証する。秘密の値はエラーメッセージに入れない。
- [ ] **Step 4: 成功を確認** — `go vet ./... && go test -race ./...` → PASS。
- [ ] **Step 5: テストスクリプトと CI に追加**
  - `scripts/test-unit.mjs`: Node のテストと並行して、`cwd` を `services/api/` にした `go vet ./...` と `go test -race ./...` を走らせ、どれかが失敗したら終了コード 1。
  - `ci.yml` に `go` ジョブを追加する。`services: postgres`（`postgres:17-alpine`、ユーザー・パスワード・DB は `zhuelog_api_test`、`5432` を公開、`pg_isready` のヘルスチェック）。手順は checkout → `pnpm/action-setup` → `setup-node`（24）→ `pnpm install --frozen-lockfile` → `DATABASE_URL=<そのDB> pnpm exec prisma migrate deploy` → `actions/setup-go`（`go-version-file: services/api/go.mod`）→ `go vet ./...` → `API_TEST_DATABASE_URL=<そのDB> go test -race ./...`（`working-directory: services/api`）。
  - 既存の `verify` ジョブは `pnpm run test:unit` で Go も走るので、そこに `actions/setup-go` を追加する（`API_TEST_DATABASE_URL` は付けないので DB テストは skip）。
- [ ] **Step 6: 確認** — リポジトリ直下で `pnpm run test:unit` → Node と Go の両方が PASS。
- [ ] **Step 7: コミット** — `git add services/api scripts/test-unit.mjs .github/workflows/ci.yml && git commit -m "feat(api): scaffold Go API module with config and CI"`

---

### Task 2: マイグレーションと store の土台

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261020120000_add_api_refresh_tokens/migration.sql`, `services/api/store/store.go`, `services/api/store/testdb_test.go`, `services/api/store/store_test.go`

**Interfaces:**

- Produces（package `store`）:
  - `type Store struct{ pool *pgxpool.Pool }`
  - `func Open(ctx context.Context, url string) (*Store, error)`（`MaxConns = 5`）、`func (s *Store) Ping(ctx context.Context) error`、`func (s *Store) Close()`
  - `var ErrNotFound = errors.New("store: not found")`
  - `func newID() string`（Global Constraints の形式、`crypto/rand`）
  - テスト用: `func testStore(t *testing.T) *Store`（`API_TEST_DATABASE_URL` が無ければ `t.Skip`、`t.Cleanup` で Close）

- [ ] **Step 1: スキーマを追加** — 仕様書の `ApiRefreshToken` モデルをそのまま `schema.prisma` に追加する。
- [ ] **Step 2: マイグレーションを作る** — ローカル DB（`docker compose up -d --wait`）に対して `pnpm exec prisma migrate dev --name add_api_refresh_tokens --create-only` を実行し、生成されたディレクトリ名を `20261020120000_add_api_refresh_tokens` に変える。SQL は `CREATE TABLE "ApiRefreshToken"`、`tokenHash` の UNIQUE INDEX、`familyId`・`ownerId` の INDEX だけであることを確認する。続けて `pnpm exec prisma migrate deploy` と `pnpm run db:generate`。
- [ ] **Step 3: 失敗するテストを書く** — `store_test.go`
  - `TestNewIDFormat`: 1,000 回生成し、すべて `^c[a-z0-9]{24}$` に一致し、重複がない。
  - `TestOpenAndPing`（DB 使用）: `testStore(t).Ping(ctx)` が nil。
- [ ] **Step 4: 失敗を確認** — `go test ./store/...` → 未定義で FAIL。
- [ ] **Step 5: 実装** — `go get github.com/jackc/pgx/v5`。`Open` は `pgxpool.ParseConfig` → `MaxConns = 5` → `NewWithConfig` → `Ping`。
- [ ] **Step 6: 成功を確認** — `API_TEST_DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public" go test -race ./store/...` → PASS。変数なしでは `TestOpenAndPing` が SKIP。
- [ ] **Step 7: コミット** — `git add prisma services/api && git commit -m "feat(api): add ApiRefreshToken table and store foundation"`

---

### Task 3: store — エントリー

**Files:**

- Create: `services/api/store/entries.go`, `services/api/store/entries_test.go`

**Interfaces:**

- Consumes: Task 2 の `Store`・`ErrNotFound`・`newID`・`testStore`。
- Produces:

  ```go
  type Hint struct { ID string; Content string; Position int }
  type Entry struct {
      ID, Kind, OriginalText, CorrectedText, Pinyin string
      Hints     []Hint      // position 昇順
      CreatedAt time.Time
      SharedAt  *time.Time
  }
  type EntryDraft struct { Kind, OriginalText, CorrectedText, Pinyin string; Hints []string } // 検証済みの値
  type EntryPatch struct { Kind, OriginalText, CorrectedText, Pinyin *string; Hints *[]string }
  type Cursor struct { CreatedAt time.Time; ID string }
  type Batch struct { ID string; ImportedAt time.Time }

  func (s *Store) ListEntries(ctx context.Context, ownerID string, after *Cursor, limit int) ([]Entry, error)
  func (s *Store) GetEntry(ctx context.Context, ownerID, id string) (Entry, error)
  func (s *Store) CreateBatch(ctx context.Context, ownerID string, drafts []EntryDraft, now time.Time) (Batch, []Entry, error)
  func (s *Store) UpdateEntry(ctx context.Context, ownerID, id string, p EntryPatch) (Entry, error)
  func (s *Store) TrashEntry(ctx context.Context, ownerID, id string, now time.Time) error
  ```

- [ ] **Step 1: 失敗するテストを書く**（すべて DB 使用。ownerId はテストごとに `"password:" + newID()`）
  - `TestCreateBatchAndGet`: 2 件を作ると、`Batch.ID` が返り、`ImportBatch` の `fileName` が `mobile:` + `now` の RFC 3339（UTC・ミリ秒）、`rowCount == 2`。`GetEntry` で `Kind`・本文・ヒントの内容と `Position` 0,1,… が一致し、`CreatedAt == now`。
  - `TestCreateBatchRollsBack`: 2 件目の `OriginalText` に NUL 文字（`"a\x00b"`）を入れる。Postgres の text は NUL を受け付けないので、`CreateBatch` はエラーを返す。そのあと、その owner のエントリーも、`now` に対応する `fileName` の `ImportBatch` も残っていないことを確認する。
  - `TestListEntriesOrderAndOwner`: 別 owner のエントリーと、`TrashEntry` 済みのエントリーが一覧に出ない。`createdAt` 降順。
  - `TestListEntriesPaginatesTies`: 1 回の `CreateBatch` で 5 件（同じ `createdAt`）を作り、`limit=2` でカーソルをたどると 5 件がちょうど 1 回ずつ出る。順序は `(createdAt DESC, id DESC)`。
  - `TestGetEntryNotFound`: 他人のもの・存在しない ID・ゴミ箱の中は `ErrNotFound`。
  - `TestUpdateEntryPartial`: `Pinyin` だけ渡すと他の項目とヒントは変わらない。`Hints` に `&[]string{"x"}` を渡すと既存のヒントは消えて 1 件（position 0）になる。`&[]string{}` ならヒント 0 件。他人の ID・ゴミ箱の中は `ErrNotFound`。
  - `TestTrashEntry`: 1 回目は nil で `deletedAt` が設定される（直接 SQL で確認）。2 回目と他人の ID は `ErrNotFound`。
  - `TestReadsWebCreatedEntry`: SQL で Prisma と同じ形の行（cuid の ID、`kind` 省略で既定値、ヒント 2 件）を直接 INSERT し、`GetEntry` で読める。
- [ ] **Step 2: 失敗を確認** — `go test ./store/ -run Entr` → FAIL。
- [ ] **Step 3: 実装** — 一覧は `WHERE "ownerId"=$1 AND "deletedAt" IS NULL AND ($2::timestamp IS NULL OR ("createdAt","id") < ($2,$3)) ORDER BY "createdAt" DESC, "id" DESC LIMIT $4`。ヒントは取得したエントリーの ID を `= ANY($1)` で 1 回のクエリにまとめて読む。作成と更新は `pgx.BeginFunc` の中で行い、`CreatedAt` には `now` を明示的に入れる（バッチ内で同じ値になる）。`UpdateEntry` は `UPDATE … WHERE id=$ AND "ownerId"=$ AND "deletedAt" IS NULL` の影響行数が 0 なら `ErrNotFound`。
- [ ] **Step 4: 成功を確認** — `API_TEST_DATABASE_URL=… go test -race ./store/` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): store learning entries with owner scoping and trash"`

---

### Task 4: store — パスワードアカウントとリフレッシュトークン

**Files:**

- Create: `services/api/store/accounts.go`, `accounts_test.go`, `refresh_tokens.go`, `refresh_tokens_test.go`

**Interfaces:**

- Produces:

  ```go
  type PasswordAccount struct { ID, LoginID, PasswordHash string; SessionVersion int }
  func (s *Store) FindPasswordAccountByLoginID(ctx context.Context, loginID string) (PasswordAccount, error) // ErrNotFound
  func (s *Store) SessionVersion(ctx context.Context, accountID string) (int, error)                      // ErrNotFound
  func (s *Store) ReserveAttempt(ctx context.Context, accountID string, now time.Time) (bool, error)
  func (s *Store) ClearFailures(ctx context.Context, accountID string) error

  type RefreshToken struct {
      ID, OwnerID, Role string
      SessionVersion    *int
      FamilyID          string
      ExpiresAt         time.Time
      RevokedAt         *time.Time
  }
  func (s *Store) InsertRefreshToken(ctx context.Context, t RefreshToken, tokenHash string) error
  func (s *Store) FindRefreshToken(ctx context.Context, tokenHash string) (RefreshToken, error) // ErrNotFound
  // old を失効させ next を挿入する。old がすでに失効していれば何もせず false。
  func (s *Store) RotateRefreshToken(ctx context.Context, oldID string, next RefreshToken, nextHash string, now time.Time) (bool, error)
  func (s *Store) RevokeFamily(ctx context.Context, familyID string, now time.Time) error
  // ownerID の行のうち、期限切れか失効済みのものを削除する。
  func (s *Store) PruneRefreshTokens(ctx context.Context, ownerID string, now time.Time) error
  ```

- [ ] **Step 1: 失敗するテストを書く**（DB 使用。アカウントは SQL で直接 INSERT し、`loginId` はテストごとに一意）
  - `TestReserveAttemptLocksOnFifth`: 4 回目まで true でロックなし、5 回目も true で `lockedUntil == now+15分`、6 回目（同じ now）は false で `failedAttempts` は 5 のまま。
  - `TestReserveAttemptAfterExpiredLock`: `lockedUntil` を過去にした状態で呼ぶと true、`failedAttempts == 1`、`lockedUntil` は NULL。
  - `TestClearFailures`: 3 回予約してから呼ぶと `failedAttempts == 0`、`lockedUntil` は NULL。
  - `TestFindPasswordAccountAndSessionVersion`: 見つかる場合は各項目が一致し、無い場合は `ErrNotFound`。
  - `TestRefreshTokenRoundTrip`: Insert → Find で全項目が一致する（`SessionVersion` が nil の場合と値がある場合の両方）。
  - `TestRotateRefreshToken`: 1 回目は true で、old に `RevokedAt` が入り、next が Find できる。同じ old での 2 回目は false で、行は増えない。
  - `TestRotateRefreshTokenConcurrent`: 同じ old に対して 10 ゴルーチンで同時に Rotate すると、true はちょうど 1 回。
  - `TestRevokeFamilyAndPrune`: 同じファミリーの 2 行が両方失効する。Prune で、期限切れの行と失効済みの行は消え、有効な行と別 owner の行は残る。
- [ ] **Step 2: 失敗を確認** — FAIL。
- [ ] **Step 3: 実装** — `ReserveAttempt` は `src/infrastructure/persistence/prisma/repositories/prisma-password-account-repository.ts` の `reserveAttempt` と同じ UPDATE 文（`MAX_FAILED_ATTEMPTS = 5`、`LOCK_DURATION = 15*time.Minute`、`updatedAt` も更新）を使う。`RotateRefreshToken` は 1 トランザクションで `UPDATE … SET "revokedAt"=$now WHERE id=$old AND "revokedAt" IS NULL`。影響行数が 0 なら false を返してコミットし、1 なら INSERT する。
- [ ] **Step 4: 成功を確認** — `API_TEST_DATABASE_URL=… go test -race ./store/` → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): store password attempts and refresh token rotation"`

---

### Task 5: auth — JWT・scrypt・許可リスト

**Files:**

- Create: `services/api/auth/token.go`, `token_test.go`, `password.go`, `password_test.go`, `allowlist.go`, `allowlist_test.go`, `services/api/auth/testdata/node_scrypt_hash.txt`

**Interfaces:**

- Produces（package `auth`）:

  ```go
  const (AccessTTL = 15*time.Minute; RefreshTTL = 30*24*time.Hour; Issuer = "ffpf-zhuelog-api"; Audience = "ffpf-zhuelog-mobile")
  const (RoleAdmin = "admin"; RoleMember = "member")
  type Principal struct { OwnerID, Role, Login string; SessionVersion int } // Login は admin、SessionVersion は member
  type Signer struct { /* secret, now */ }
  func NewSigner(secret []byte, now func() time.Time) *Signer
  func (s *Signer) Issue(p Principal) (string, error)
  func (s *Signer) Verify(token string) (Principal, error) // 失敗はすべて ErrUnauthorized
  var ErrUnauthorized = errors.New("auth: unauthorized")
  var ErrForbidden    = errors.New("auth: forbidden")

  type PasswordVerifier struct { /* dummy hash は sync.Once で 1 回だけ作る */ }
  func (v *PasswordVerifier) Verify(password, hash string) bool
  func (v *PasswordVerifier) Simulate(password string) // ダミーハッシュに対して Verify と同じ計算をする

  type Allowlist map[string]struct{}
  func ParseAllowlist(csv string) Allowlist
  func (a Allowlist) Allows(login string) bool
  ```

- [ ] **Step 1: Node でテスト用のハッシュを作る**
  ```bash
  cd /Users/liyur_qie/ffpf-zhuelog && node -e 'const c=require("node:crypto");const s=c.randomBytes(16);const k=c.scryptSync("correct horse battery",s,64,{N:32768,r:8,p:1,maxmem:67108864});process.stdout.write(["scrypt",32768,8,1,s.toString("base64url"),k.toString("base64url")].join(":"))' > services/api/auth/testdata/node_scrypt_hash.txt
  ```
- [ ] **Step 2: 失敗するテストを書く**
  - `TestSignerRoundTrip`: admin（`Login` あり）と member（`SessionVersion` = 3）を Issue → Verify すると元と一致する。`exp - iat == 15分`。
  - `TestSignerRejects`: 期限切れ（`now` を 16 分進める）、別の鍵で署名、`aud` が違う、`iss` が違う、`alg` が `none`、`HS512` で署名、ゴミ文字列。すべて `ErrUnauthorized`。
  - `TestVerifyNodeHash`: testdata のハッシュが `"correct horse battery"` で true、`"wrong"` で false。
  - `TestVerifyRejectsBadHashes`: 部品の数が違う、先頭が `bcrypt`、N=65536、N=3、r=9、p=5、key が 32 バイト、salt が空、base64url として正規でない（末尾に `=`）。すべて false で、panic しない。
  - `TestSimulateDoesNotPanic`: `Simulate("x")` を 2 回呼んでも panic しない。
  - `TestAllowlist`: `ParseAllowlist(" Alice, bob ,,")` で、`Allows("alice")`・`Allows(" BOB ")` は true、`Allows("")`・`Allows("carol")` は false。
- [ ] **Step 3: 失敗を確認** — `go test ./auth/` → FAIL。
- [ ] **Step 4: 実装** — `go get github.com/golang-jwt/jwt/v5 golang.org/x/crypto`。Verify には `jwt.WithValidMethods([]string{"HS256"})`、`jwt.WithIssuer`、`jwt.WithAudience`、`jwt.WithTimeFunc(now)` を使う。クレームは `sub`、`role`、`login`、`sv`。`role` が admin でも member でもなければ ErrUnauthorized。scrypt の比較は `subtle.ConstantTimeCompare` で行う。
- [ ] **Step 5: 成功を確認** — `go test -race ./auth/` → PASS。
- [ ] **Step 6: コミット** — `git commit -m "feat(api): add JWT signer, scrypt verifier and allowlist"`

---

### Task 6: auth — GitHub のコード交換

**Files:**

- Create: `services/api/auth/github.go`, `github_test.go`

**Interfaces:**

- Produces:

  ```go
  type GitHubUser struct { ID int64; Login string }
  type GitHubClient struct {
      HTTP         *http.Client // Timeout 10s を main で設定
      ClientID, ClientSecret, RedirectURI string
      TokenURL     string // 既定 https://github.com/login/oauth/access_token
      APIURL       string // 既定 https://api.github.com
  }
  func (g *GitHubClient) Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error)
  var ErrGitHubUnavailable = errors.New("auth: github unavailable")
  ```

  不一致の `redirectURI`、GitHub が `error`（例: `bad_verification_code`）を返す、`/user` が 401 を返す場合は `ErrUnauthorized`。通信エラー、5xx、JSON 不正、タイムアウトは `ErrGitHubUnavailable`。

- [ ] **Step 1: 失敗するテストを書く**（`httptest.Server` で GitHub を偽装する）
  - `TestExchangeSuccess`: トークンエンドポイントが受け取るフォームに `client_id`・`client_secret`・`code`・`code_verifier`・`redirect_uri` があり、`Accept: application/json` で要求している。`/user` には `Authorization: Bearer <token>` が付いている。結果は `{ID: 123, Login: "Alice"}`。
  - `TestExchangeRedirectMismatch`: 偽装サーバーを呼ばずに `ErrUnauthorized`。
  - `TestExchangeBadCode`: `{"error":"bad_verification_code"}` が返ると `ErrUnauthorized`。
  - `TestExchangeUnavailable`: 500 が返る場合、閉じたサーバー、`/user` が壊れた JSON を返す場合は `ErrGitHubUnavailable`。
  - `TestExchangeErrorsOmitSecrets`: どのエラーの文字列にも、コード・secret・GitHub のトークンが含まれない。
- [ ] **Step 2: 失敗を確認** → FAIL。
- [ ] **Step 3: 実装** — 2 つのリクエストとも `http.NewRequestWithContext` を使う。レスポンスは `io.LimitReader(…, 1<<20)` で読む。
- [ ] **Step 4: 成功を確認** → PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): exchange GitHub OAuth code with PKCE"`

---

### Task 7: auth — Service（ログイン・リフレッシュ・ログアウト・失効確認）

**Files:**

- Create: `services/api/auth/service.go`, `service_test.go`

**Interfaces:**

- Consumes: Task 4 の store メソッド（下の `Store` インターフェース）、Task 5・6 の型。
- Produces:

  ```go
  type Store interface {
      FindPasswordAccountByLoginID(ctx context.Context, loginID string) (store.PasswordAccount, error)
      SessionVersion(ctx context.Context, accountID string) (int, error)
      ReserveAttempt(ctx context.Context, accountID string, now time.Time) (bool, error)
      ClearFailures(ctx context.Context, accountID string) error
      InsertRefreshToken(ctx context.Context, t store.RefreshToken, tokenHash string) error
      FindRefreshToken(ctx context.Context, tokenHash string) (store.RefreshToken, error)
      RotateRefreshToken(ctx context.Context, oldID string, next store.RefreshToken, nextHash string, now time.Time) (bool, error)
      RevokeFamily(ctx context.Context, familyID string, now time.Time) error
      PruneRefreshTokens(ctx context.Context, ownerID string, now time.Time) error
  }
  type GitHub interface { Exchange(ctx context.Context, code, verifier, redirectURI string) (GitHubUser, error) }
  type TokenPair struct { AccessToken, RefreshToken string; ExpiresIn int } // ExpiresIn = 900
  type Hasher interface { Verify(password, hash string) bool; Simulate(password string) } // *PasswordVerifier が満たす
  type Service struct { Store Store; Signer *Signer; GitHub GitHub; Allowlist Allowlist; Passwords Hasher; Now func() time.Time }
  func (s *Service) LoginGitHub(ctx context.Context, code, verifier, redirectURI string) (TokenPair, error)
  func (s *Service) LoginPassword(ctx context.Context, loginID, password string) (TokenPair, error)
  func (s *Service) Refresh(ctx context.Context, refreshToken string) (TokenPair, error)
  func (s *Service) Logout(ctx context.Context, refreshToken string) error
  func (s *Service) Authenticate(ctx context.Context, accessToken string) (Principal, error)
  ```

  会員の `PasswordAccount.ID` は ownerId の `password:` を除いた部分。

- [ ] **Step 1: 失敗するテストを書く**（store はメモリ上のフェイク。GitHub はフェイク。`Now` は固定）
  - `TestLoginGitHubAllowed`: `{ID:42, Login:"Alice"}` で allowlist が `alice` のとき、アクセストークンを Verify すると `OwnerID "42"`・`Role admin`・`Login "Alice"`。リフレッシュトークンの行の `Role` が admin、`ExpiresAt == now+30日`。Prune が呼ばれている。
  - `TestLoginGitHubForbidden`: 許可リストに無いと `ErrForbidden` で、トークンの行は作られない。
  - `TestLoginPasswordSuccess`: ReserveAttempt → Verify → ClearFailures の順に呼ばれ、`OwnerID "password:<id>"`、`SessionVersion` が DB の値と同じ。
  - `TestLoginPasswordNormalizesLoginID`: `"  Alice "` は `alice` で検索される。
  - `TestLoginPasswordFailuresAreUniform`: 形式不正（`"a"`、129 文字のパスワード）、存在しない ID、ロック中（ReserveAttempt が false）、パスワード違い。すべて `ErrUnauthorized` で、どの場合もフェイクの hasher の「計算回数」がちょうど 1（Verify か Simulate のどちらか）。パスワード違いでは ClearFailures が呼ばれない。
  - `TestRefreshRotates`: 新しい組が返り、古いトークンでもう一度呼ぶと `ErrUnauthorized` になり、ファミリー全体が失効する。
  - `TestRefreshExpired`: 期限切れは `ErrUnauthorized`。
  - `TestRefreshRevokedMember`: DB の sessionVersion が行の値と違うと `ErrUnauthorized` で、ファミリーが失効する。
  - `TestRefreshRemovedAdmin`: 許可リストから外れていると `ErrForbidden` で、ファミリーが失効する。
  - `TestRefreshLostRace`: Rotate が false を返すと `ErrUnauthorized` で、ファミリーが失効する。
  - `TestLogout`: 既知のトークンならファミリーが失効し、未知のトークンでも nil。
  - `TestAuthenticate`: admin が許可リストに載っていれば Principal を返し、外れていれば `ErrForbidden`。member は sessionVersion が一致すれば成功し、不一致や `ErrNotFound` なら `ErrUnauthorized`。
- [ ] **Step 2: 失敗を確認** → FAIL。
- [ ] **Step 3: 実装** — テストでは `Hasher` のフェイクで計算回数を数える。リフレッシュトークンは `crypto/rand` の 32 バイトを `base64.RawURLEncoding` にし、ハッシュは `sha256` の hex。
- [ ] **Step 4: 成功を確認** → `go test -race ./auth/` PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): add auth service with rotation and revocation checks"`

---

### Task 8: httpapi — 応答・ミドルウェア・認証ハンドラ

**Files:**

- Create: `services/api/httpapi/respond.go`, `middleware.go`, `middleware_test.go`, `router.go`, `auth_handlers.go`, `auth_handlers_test.go`

**Interfaces:**

- Consumes: Task 7 の `auth.Service` のメソッド群、`auth.Principal`、エラー値。
- Produces:

  ```go
  type Auth interface { /* auth.Service の 5 メソッドと同じシグネチャ */ }
  type Entries interface { /* Task 3 の 5 メソッドと同じシグネチャ */ }
  type Pinger interface { Ping(ctx context.Context) error }
  type Deps struct { Auth Auth; Entries Entries; DB Pinger; Logger *slog.Logger; Now func() time.Time }
  func NewRouter(d Deps) http.Handler
  func principalFrom(ctx context.Context) auth.Principal
  func writeJSON(w http.ResponseWriter, status int, v any)
  func writeError(w http.ResponseWriter, status int, code, message string)
  type RateLimiter struct{…}; func NewRateLimiter(limit int, window time.Duration, now func() time.Time) *RateLimiter
  func (r *RateLimiter) Allow(key string) bool
  ```

  ミドルウェアは外側から順に、recover → アクセスログ（メソッド・パス・ステータス・所要時間だけ）→ `Cache-Control: no-store` → `http.MaxBytesReader(1<<20)`。`/v1/auth/*` にはさらに RateLimiter（10 回/分、キーは `X-Forwarded-For` の末尾の値、無ければ `RemoteAddr` のホスト）をかける。`/v1/entries*` と `/v1/batches` には Bearer 認証をかける。

- [ ] **Step 1: 失敗するテストを書く**（`httptest`、Auth はフェイク）
  - `TestRecoverReturns500`: panic するハンドラは 500 で `{"error":{"code":"internal",…}}` を返し、ログに panic の値が出る。
  - `TestNoStoreHeader`: `/healthz` と 404 のどちらにも `Cache-Control: no-store` が付く。
  - `TestHealthz`: Ping が nil なら 200、エラーなら 503。
  - `TestRateLimiter`: 同じキーで 10 回は許可、11 回目は拒否、61 秒後は再び許可。別のキーは独立している。
  - `TestAuthRoutesRateLimited`: `/v1/auth/password` への 11 回目は 429 で `rate_limited`。
  - `TestBearer`: ヘッダが無い、`Basic …`、Authenticate が ErrUnauthorized → 401。ErrForbidden → 403。成功したときはハンドラに Principal が届く。
  - `TestLoginGitHubHandler`: 200 で `{accessToken, refreshToken, expiresIn}` を返す。本文に未知のフィールドがある・JSON 不正・`code` が空なら 400。ErrUnauthorized → 401、ErrForbidden → 403、ErrGitHubUnavailable → 502。
  - `TestLoginPasswordHandler`・`TestRefreshHandler`: 成功は 200、ErrUnauthorized は 401、本文の型違いは 400。
  - `TestLogoutHandler`: 204。
  - `TestBodyTooLarge`: 1 MiB + 1 バイトの本文は 413 で `too_large`。
  - `TestLogsOmitSecrets`: ログイン・リフレッシュのリクエスト後、ログのバッファに `code`・`password`・トークンの値が含まれない。
- [ ] **Step 2: 失敗を確認** → FAIL。
- [ ] **Step 3: 実装** — ルーティングは `http.NewServeMux` のパターン（`"POST /v1/auth/github"` など）。JSON は `json.Decoder` に `DisallowUnknownFields` を付けて読み、末尾に余計なデータがあれば 400。`*http.MaxBytesError` は 413 にする。エラーのメッセージは日本語の固定文言にする（例: `"認証が必要です。"`、Web の proxy と同じ）。
- [ ] **Step 4: 成功を確認** → `go test -race ./httpapi/` PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): add HTTP middleware and auth endpoints"`

---

### Task 9: httpapi — 入力検証とエントリーのハンドラ

**Files:**

- Create: `services/api/httpapi/validate.go`, `validate_test.go`, `entry_handlers.go`, `entry_handlers_test.go`
- Modify: `services/api/httpapi/router.go`（ルートを追加）

**Interfaces:**

- Consumes: Task 3 の `store` の型、Task 8 の `Deps`・`writeJSON`・`writeError`・`principalFrom`。
- Produces:

  ```go
  type entryInput struct { Kind *string `json:"kind"`; OriginalText, CorrectedText, Pinyin string; Hints []string }
  type patchInput struct { Kind, OriginalText, CorrectedText, Pinyin *string; Hints *[]string } // "hints": null は 400
  func validateDraft(in entryInput) (store.EntryDraft, error)
  func validatePatch(in patchInput) (store.EntryPatch, error) // 何も指定されていなければ 400
  func encodeCursor(c store.Cursor) string
  func decodeCursor(s string) (store.Cursor, error)
  ```

  JSON のキーは camelCase（`originalText` など）。応答のエントリーの形は仕様書の例どおり。時刻は RFC 3339（UTC・ミリ秒）。

- [ ] **Step 1: 失敗するテストを書く**
  - `TestValidateDraftRuneLimits`: `strings.Repeat("汉", 2000)` は通り、2001 文字は失敗する。ヒントは 500 文字で通り、501 文字で失敗する。
  - `TestValidateDraft`: 本文 3 項目が trim 後に空なら失敗、ヒントが 21 件・空文字なら失敗、`kind` が `"foo"` なら失敗、`kind` を省略すると `correction`。値は trim される。本文やヒントに NUL 文字（`\x00`）があれば失敗する（DB エラーの 500 ではなく 400 にするため）。`validatePatch` も同じ規則に従う。
  - `TestValidatePatch`: 空の `{}` は失敗、`"hints": null` は失敗、`"hints": []` は通る（空の配列）。
  - `TestCursorRoundTrip` と `TestDecodeCursorRejects`（base64 として不正、要素が足りない、時刻が不正）。
  - `TestListEntriesHandler`: owner は Principal の OwnerID がそのまま渡される。`limit` を省略すると 50。結果が `limit` 件なら `nextCursor` に最後の要素が入り、少なければ `null`（store には `limit+1` 件を要求して判定する）。
  - `TestListEntriesBadQuery`: `limit=0`・`101`・`abc`、`cursor=!!!` は 400 で `invalid_request`。
  - `TestGetEntryHandler`: ErrNotFound → 404。
  - `TestCreateBatchHandler`: 201 で `{batch, entries}` を返す。0 件・501 件・検証エラーは 400。store には検証済みの Draft が渡される。
  - `TestPatchEntryHandler`: 200 で更新後のエントリーを返す。ErrNotFound → 404。`sharedAt` を送ると 400（未知のフィールド）。
  - `TestDeleteEntryHandler`: 204。ErrNotFound → 404。
  - `TestEntryErrorsAreInternal`: store が想定外のエラーを返すと 500 で、応答にエラー文字列が含まれない。
- [ ] **Step 2: 失敗を確認** → FAIL。
- [ ] **Step 3: 実装** — カーソルは `createdAt` の UnixMilli と `id` を `|` でつなぎ、`base64.RawURLEncoding` にする。
- [ ] **Step 4: 成功を確認** → `go test -race ./httpapi/` PASS。
- [ ] **Step 5: コミット** — `git commit -m "feat(api): add learning entry endpoints with validation"`

---

### Task 10: main の配線・コンテナ・エンドツーエンドの確認

**Files:**

- Modify: `services/api/main.go`
- Create: `services/api/main_test.go`, `services/api/Dockerfile`, `services/api/.dockerignore`

**Interfaces:**

- Consumes: Task 1 の `LoadConfig`、Task 2 の `store.Open`、Task 5〜7 の auth、Task 8 の `httpapi.NewRouter`。
- Produces: `func run(ctx context.Context, cfg Config, logger *slog.Logger, ready chan<- string) error`。`ready` には待ち受けアドレスを送る（テスト用）。

- [ ] **Step 1: 失敗するテストを書く** — `main_test.go` の `TestRunEndToEnd`（DB 使用。`API_TEST_DATABASE_URL` が無ければ skip）。`PORT=0` で `run` を起動し、SQL で会員アカウント（Task 5 の testdata のハッシュ）を作る。その後、`POST /v1/auth/password` → `POST /v1/batches`（1 件）→ `GET /v1/entries` で 1 件 → `PATCH` → `DELETE` → `GET /v1/entries` で 0 件 → `POST /v1/auth/refresh` で新しい組が返る、の流れを確認する。最後に ctx を cancel すると、`run` が 10 秒以内に nil を返す。
- [ ] **Step 2: 失敗を確認** → FAIL。
- [ ] **Step 3: 実装** — `main` は `slog.New(slog.NewJSONHandler(os.Stdout, nil))`、`LoadConfig(os.Getenv)`、`signal.NotifyContext(SIGINT, SIGTERM)` を用意して `run` を呼ぶ。`run` は `http.Server{ReadHeaderTimeout: 10s, ReadTimeout: 30s, WriteTimeout: 30s, IdleTimeout: 60s}` を使い、ctx が終わったら `Shutdown`（10 秒）してから store を Close する。GitHub の `http.Client` は `Timeout: 10*time.Second`。
- [ ] **Step 4: Dockerfile を書く** — ビルドステージは `golang:1.27-bookworm`（`go mod download` を先に実行してキャッシュする）で、`CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api .`。実行ステージは `gcr.io/distroless/static-debian12:nonroot`、`USER nonroot`、`EXPOSE 8080`、`ENTRYPOINT ["/api"]`。`.dockerignore` には `**/*_test.go` と `testdata/` を書く。
- [ ] **Step 5: 確認** — `API_TEST_DATABASE_URL=… go test -race ./...` → PASS。`docker build -t zhuelog-api services/api` が成功する。必須の環境変数を付けた `docker run --rm -e … -p 8080:8080 zhuelog-api` に対して、別の端末で `curl -s localhost:8080/healthz` → 200。
- [ ] **Step 6: コミット** — `git commit -m "feat(api): wire server with graceful shutdown and container image"`

---

### Task 11: デプロイの workflow と手順書

**Files:**

- Create: `.github/workflows/api-deploy.yml`, `docs/api-deployment.md`
- Modify: `.env.example`（API 用の変数をコメント付きで追加。値は空かダミー）、`README.md`（`services/api` の 1 段落と手順書へのリンク）

**Interfaces:**

- Consumes: Task 10 の Dockerfile。GitHub の Actions 変数 `GCP_PROJECT_ID`・`GCP_REGION`・`GCP_WIF_PROVIDER`・`GCP_DEPLOY_SA`・`API_SERVICE_NAME`（Secrets ではなく Variables。秘密情報ではないため）。

- [ ] **Step 1: workflow を書く** — トリガーは `push: branches: [main], paths: ["services/api/**", ".github/workflows/api-deploy.yml"]` と `workflow_dispatch`。`permissions: contents: read, id-token: write`。`concurrency: api-deploy`。手順は次のとおり。
  1. checkout（`persist-credentials: false`）
  2. `google-github-actions/auth`（`workload_identity_provider`・`service_account`）
  3. `google-github-actions/setup-gcloud`
  4. `gcloud auth configure-docker ${REGION}-docker.pkg.dev`
  5. `docker build` と `docker push`（タグは `${{ github.sha }}`）
  6. `gcloud run deploy "$API_SERVICE_NAME" --image … --region … --min-instances 0 --max-instances 2 --set-secrets DATABASE_URL=api-database-url:latest,API_JWT_SECRET=api-jwt-secret:latest,GITHUB_MOBILE_CLIENT_SECRET=api-github-client-secret:latest --set-env-vars GITHUB_MOBILE_CLIENT_ID=…,GITHUB_MOBILE_REDIRECT_URI=…,AUTH_ALLOWED_GITHUB_LOGINS=… --allow-unauthenticated`

  （アプリから直接呼ぶ API で認証はアプリ層で行うため `--allow-unauthenticated`。非秘密の 3 変数も Actions Variables から渡す。）各アクションは、リポジトリの既存 workflow と同じくメジャーバージョンを指定する。

- [ ] **Step 2: workflow を確認** — `actionlint .github/workflows/api-deploy.yml`（無ければ `pnpm dlx @action-validator/cli`）→ エラーなし。
- [ ] **Step 3: 手順書を書く** — `docs/api-deployment.md` に次を書く。
  1. GitHub OAuth App の登録（Callback URL はアプリのカスタムスキーム）
  2. GCP: Artifact Registry のリポジトリ、デプロイ用と実行用のサービスアカウント、WIF プールとプロバイダ（`attribute.repository == "Sparklingstadt/ffpf-zhuelog"` に限定）、Secret Manager の 3 つのシークレットと実行用 SA への `secretAccessor` 付与
  3. Actions Variables の設定
  4. **マージ前に** 本番 Neon へマイグレーションを適用する手順（`vercel env pull` で `DATABASE_URL` を取得して `pnpm exec prisma migrate deploy`）
  5. デプロイ後の確認（`curl https://…/healthz`）
  6. `API_JWT_SECRET` の作り方（`openssl rand -base64 48`）とローテーションの影響（全員のアクセストークンが無効になるが、リフレッシュトークンで再取得できる）
- [ ] **Step 4: 確認** — `pnpm exec prettier --check docs/api-deployment.md .github/workflows/api-deploy.yml .env.example README.md` → OK。
- [ ] **Step 5: コミット** — `git commit -m "ci(api): deploy Go API to Cloud Run and document setup"`

---

## 最終確認

- [ ] `docker compose up -d --wait` → `pnpm exec prisma migrate deploy` → `API_TEST_DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public" go test -race ./...`（`services/api`）→ すべて PASS で、SKIP がない。
- [ ] `pnpm run test:unit && pnpm run typecheck && pnpm run lint && pnpm run build` → PASS（Prisma スキーマの変更で Web が壊れていないこと）。
- [ ] 仕様書の各セクション（構成、スキーマ、認証、エンドポイント、エラー処理、テスト、デプロイ）について、対応する Task を指せること。
