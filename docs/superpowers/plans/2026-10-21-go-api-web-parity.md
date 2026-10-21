# Go API Web の残り機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go API（`services/api/`）に、日付ごとの記録とカレンダー、admin による会員のノートの閲覧（`?user=`）、自分のパスワードの変更、admin による会員の管理、CSV のインポートを、Web と同じルールで足す。

**Architecture:** 既存の `store`（SQL）・`auth`（パスワードとセッション）・`httpapi`（ハンドラ）にそれぞれ足す。CSV の解析だけは新しいパッケージ `csvimport` に置く。スキーマは変えない。

**Tech Stack:** Go 1.27、pgx/v5、`encoding/csv`、`mime/multipart`、既存の scrypt。

**Spec:** `docs/superpowers/specs/2026-10-21-go-api-web-parity-design.md`

## Global Constraints

- スキーマ変更なし。Web の条件（`deletedAt IS NULL`、所有者、`PasswordAccount` の列）に合わせる。
- 日本時間は UTC+9 固定。日付の SQL は `("createdAt" + interval '9 hours')::date`、日の範囲は `[日付 00:00 JST, 翌日 00:00 JST)` を UTC にしたもの。
- 日付ごとの並びは `(createdAt ASC, id ASC)`、カレンダーは新しい日付から。
- `?user=` は `^\d+$` か `^password:[a-z0-9]{20,32}$` だけ。他人を見られるのは admin だけ（会員は 403「他の人の記録は管理者だけが見られます。」）。
- パスワード: 12〜128 文字（空白は除かない）。ログイン ID: trim + 小文字化で `^[a-z0-9._-]{3,32}$`。表示名: trim で 1〜50 文字。生成パスワードは 15 バイトの base64url。ハッシュは `scrypt:32768:8:1:<salt16 base64url>:<key64 base64url>`。
- `SetPassword` は 1 文の UPDATE で `passwordHash`・`sessionVersion + 1`・`failedAttempts = 0`・`lockedUntil = NULL`・`updatedAt` を更新する。
- 文言は仕様書のとおり（Web と同じ）。新しいエラーコード: `password_mismatch`、`invalid_current_password`、`login_id_taken`（409）、`invalid_csv`。
- CSV: 1 セル 1 万文字、ヒント 100 列、データ行 1000 行、1 レコード 10 万文字、ファイル 5 MiB、このルートだけ本文の上限 6 MiB。
- パスワードと CSV の本文はログに出さない。
- DB のテストは `API_TEST_DATABASE_URL`、無ければ skip。固有の ID を使い TRUNCATE しない。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。`DATABASE_URL` が未設定なら付けてコミットする。

## Review Focus

- 日本時間の日付の境目（UTC 14:59:59.999 と 15:00:00.000）で日付と番号が Web と一致すること → Task 1 `TestLogDatesJSTBoundary`。
- 会員が `?user=` に他人を入れて読めないこと、admin の `?user=` で書き込みが起きないこと → Task 2 `TestUserParamRequiresAdmin`。
- パスワード変更のどの失敗でも scrypt がちょうど 1 回で、成功で既存のトークンが無効になること → Task 3 `TestChangePasswordUniformFailures`、`TestChangePasswordRevokesSessions`。
- 生成パスワードがログにもエラーにも出ないこと → Task 4 `TestAdminAccountsLogsOmitPasswords`。
- Web と同じ CSV で同じ結果になること（BOM、見出し、引用符の中の改行、空のヒント、各エラーの行番号）→ Task 5 `TestParseMatchesWebFixtures`。

---

### Task 1: store — カレンダーと日付ごとのノート

**Files:** Create `services/api/store/daily.go`, `daily_test.go`

**Produces:**

```go
type LogDate struct { Year, Month, Day int }            // JST の日付
type LogDateCount struct { Date LogDate; Count int }
func (s *Store) ListLogDates(ctx context.Context, ownerID string) ([]LogDateCount, error)          // 新しい日付から
func (s *Store) ListDailyEntries(ctx context.Context, ownerID string, d LogDate) ([]Entry, error)  // 古い順
func (s *Store) GetDailyEntry(ctx context.Context, ownerID string, d LogDate, number int) (Entry, int, error) // (entry, total)。範囲外は ErrNotFound
```

- [ ] **Step 1: 失敗するテスト**（DB）: `TestListLogDates`（ゴミ箱と他人を除き、件数と順序が正しい）、`TestLogDatesJSTBoundary`（UTC 14:59:59.999 は前日、15:00:00.000 は当日）、`TestListDailyEntries`（古い順、同時刻は id 昇順）、`TestGetDailyEntry`（1 件目・最後・0 と total+1 は ErrNotFound、total が正しい、前のノートをゴミ箱に入れると番号が繰り上がる）。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3: 実装** — 日の範囲は Go で `time.Date(y, m, d, 0, 0, 0, 0, jst)` から UTC に変換して SQL に渡す（`jst = time.FixedZone("JST", 9*3600)`）。N 件目は `ORDER BY "createdAt", id OFFSET $n-1 LIMIT 1` と同じ条件の `count(*)`。
- [ ] **Step 4:** PASS（`-race`、DB あり・なし）。
- [ ] **Step 5:** `git commit -m "feat(api): store log dates and daily entries in JST"`

---

### Task 2: httpapi — `?user=` とカレンダーのエンドポイント

**Files:** Create `services/api/httpapi/owner.go`, `owner_test.go`, `daily_handlers.go`, `daily_handlers_test.go`; Modify `router.go`（`Entries` に Task 1 のメソッド、ルート）、`entry_handlers.go`（`listEntries`・`getEntry` が `readOwner` を使う）、`respond.go`（文言）

**Produces:** `func readOwner(w http.ResponseWriter, r *http.Request) (string, bool)` — `?user=` を検査して読み取りに使う ownerId を返す。失敗時はエラーを書いて false。

- [ ] **Step 1: 失敗するテスト**
  - `TestReadOwner`: 無し・自分 → 自分。admin + 有効な他人 → 他人。会員 + 他人 → 403 と文言。形式違い（`abc`、`password:short`、2 つの `user`）→ 400。
  - `TestUserParamRequiresAdmin`: 会員の `GET /v1/entries?user=<他人>` は 403 で store を呼ばない。admin の `PATCH /v1/entries/{id}?user=<他人>` は store に admin 自身の ownerId が渡る（`?user=` は書き込みで使われない）。
  - `TestLogDatesHandler`: `{dates:[{date:"2026-04-10",count}]}`（`YYYY-MM-DD`、ゼロ埋め）。
  - `TestDailyEntriesHandler`: `{date, entries}` で各エントリーに `number`。
  - `TestDailyEntryHandler`: `{entry, number, total}`。ErrNotFound → 404。
  - `TestDailyBadParams`: `2026-02-30`・`1999-01-01`・`2026-1-5`・`abc` → 400。番号 `0`・`-1`・`x`・`2147483648` → 400。
  - 全ルートで 401（トークン無し）。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3: 実装** — ルート: `GET /v1/log-dates`、`GET /v1/log-dates/{date}/entries`、`GET /v1/log-dates/{date}/entries/{number}`。日付は `time.Parse("2006-01-02", s)` で解析し、再フォーマットして元の文字列と一致することを確かめる（ゼロ埋めを要求）。
- [ ] **Step 4:** PASS。
- [ ] **Step 5:** `git commit -m "feat(api): add calendar endpoints and admin read-only ?user="`

---

### Task 3: 自分のパスワードの変更

**Files:** Modify `services/api/store/accounts.go`（`SetPassword`、`FindPasswordAccountByID`）、`store/accounts_test.go`、`services/api/auth/password.go`（`Hash`）、`auth/password_test.go`、`auth/service.go`（`ChangePassword`）、`auth/service_test.go`；Create `services/api/httpapi/account_handlers.go`, `account_handlers_test.go`；Modify `httpapi/router.go`, `respond.go`

**Produces:**

```go
// store
func (s *Store) FindPasswordAccountByID(ctx context.Context, id string) (PasswordAccount, error) // ErrNotFound
func (s *Store) SetPassword(ctx context.Context, id, hash string, now time.Time) error        // ErrNotFound
// auth
func (v *PasswordVerifier) Hash(ctx context.Context, password string) (string, error)   // セマフォを使う
var ErrPasswordMismatch, ErrInvalidCurrentPassword, ErrInvalidNewPassword error
func (s *Service) ChangePassword(ctx context.Context, p Principal, current, next, confirm string) error
```

`Hasher` インターフェースに `Hash` を足し、フェイクも更新する。

- [ ] **Step 1: 失敗するテスト**
  - store `TestSetPassword`: ハッシュが変わり、`sessionVersion` が 1 増え、失敗回数とロックが消える。存在しない ID は ErrNotFound。
  - auth `TestHashVerifiesAndMatchesFormat`: `Hash` の結果が `Verify` で true、形式が `scrypt:32768:8:1:` で始まり、Node の検証ルールにも通る（既存の `parseScryptHash`）。
  - auth `TestChangePasswordOrder`: 新しいパスワードが 11 文字 → ErrInvalidNewPassword（試行を数えない）、不一致 → ErrPasswordMismatch（数えない）、admin → ErrForbidden。
  - auth `TestChangePasswordUniformFailures`: アカウント無し・現在のパスワードが空や 129 文字・ロック中・違うパスワード → すべて ErrInvalidCurrentPassword で、scrypt の計算はちょうど 1 回。違うパスワードでは `SetPassword` を呼ばない。
  - auth `TestChangePasswordRevokesSessions`: 成功後、変更前のアクセストークンで `Authenticate` が ErrUnauthorized。
  - httpapi: 204、各エラーのステータスとコードと文言、レート制限（11 回目は 429、`/v1/auth/*` と枠を共有）。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3: 実装** — 順番は仕様書の「3.」のとおり。ルート `POST /v1/account/password`。
- [ ] **Step 4:** PASS。
- [ ] **Step 5:** `git commit -m "feat(api): let members change their own password"`

---

### Task 4: admin による会員の管理

**Files:** Modify `services/api/store/accounts.go`（`ListPasswordAccounts`、`CreatePasswordAccount`、`ErrLoginIDTaken`）、`store/accounts_test.go`、`auth/password.go`（`GeneratePassword`）；Create `services/api/httpapi/admin_handlers.go`, `admin_handlers_test.go`；Modify `router.go`（`Deps.Accounts` インターフェース）、`respond.go`、`services/api/main.go`

**Produces:**

```go
type AccountSummary struct { ID, LoginID, DisplayName string; CreatedAt time.Time; Locked bool }
func (s *Store) ListPasswordAccounts(ctx context.Context, now time.Time) ([]AccountSummary, error)
func (s *Store) CreatePasswordAccount(ctx context.Context, loginID, displayName, hash string, now time.Time) (AccountSummary, error) // 一意制約違反は ErrLoginIDTaken
var ErrLoginIDTaken = errors.New("store: login id taken")
func GeneratePassword() string // auth
```

- [ ] **Step 1: 失敗するテスト**
  - store: 一覧の順序と `Locked`、作成（ID は `newID()`、`sessionVersion` 0）、同じ loginId で ErrLoginIDTaken。
  - httpapi: admin 以外は 403。作成の 201 と `generated`（空・空白だけで生成、12 文字以上ならそのまま）、各項目の 400 文言、409。リセットの 200 と 404、リセット後にその会員の旧トークンが無効。`TestAdminAccountsLogsOmitPasswords`（ログのバッファに送ったパスワードと生成したパスワードが出ない）。
- [ ] **Step 2:** FAIL。
- [ ] **Step 3: 実装** — ルート `GET /v1/admin/accounts`、`POST /v1/admin/accounts`、`POST /v1/admin/accounts/{id}/password`。リセットは Task 3 の `SetPassword` を使う。
- [ ] **Step 4:** PASS。
- [ ] **Step 5:** `git commit -m "feat(api): add admin member management endpoints"`

---

### Task 5: CSV のインポート

**Files:** Create `services/api/csvimport/parse.go`, `parse_test.go`, `services/api/csvimport/testdata/*.csv`；Create `services/api/httpapi/import_handlers.go`, `import_handlers_test.go`；Modify `router.go`, `middleware.go`（このルートだけ本文の上限 6 MiB）, `respond.go`

**Produces:**

```go
type ValidationError struct{ Message string }       // csvimport
func Parse(r io.Reader) ([]store.EntryDraft, error) // 失敗は *ValidationError（文言は仕様書のとおり）
```

- [ ] **Step 1: Web と共通のテストデータを作る** — `testdata/` に正常（BOM あり・見出しあり・引用符の中の改行とカンマ・空のヒント・前後の空白）と各エラーの CSV を置く。期待値は Web のパーサー（`src/infrastructure/csv/csv-parse-learning-parser.ts`）を tsx で実行して得たものを `testdata/expected.json` に保存する（使ったコマンドをテストの先頭のコメントに書く）。
- [ ] **Step 2: 失敗するテスト**: `TestParseMatchesWebFixtures`（全テストデータで Web の結果と一致、エラーは文言まで一致）、`TestParseLimits`（1001 行、10001 文字のセル、104 列、データ行なし、3 列未満、必須の空）。httpapi: 201 `{batch, count}`、ファイル無し・空・拡張子違いは 400、5 MiB 超は 413、`invalid_csv` の文言、ファイル名は 255 文字に切る、`kind` は `correction`、admin と会員だけ。
- [ ] **Step 3:** FAIL。
- [ ] **Step 4: 実装** — `encoding/csv` の `Reader` に `FieldsPerRecord = -1`、`LazyQuotes = false`、BOM の除去、各セルの `strings.TrimSpace`、空行（全セルが空）の除去。1 レコード 10 万文字の上限は自前で確かめる。保存は既存の `CreateBatch`（ファイル名を受け取れるように引数を足す。既存の呼び出しは `mobile:<日時>` のまま）。
- [ ] **Step 5:** PASS。
- [ ] **Step 6:** `git commit -m "feat(api): import learning entries from CSV like the web"`
