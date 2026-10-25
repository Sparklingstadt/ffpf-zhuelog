# Go API ゴミ箱・共有・フォロー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go API（`services/api/`）に、ゴミ箱（一覧・復元・完全削除・空にする）、共有の切り替え、フォロー（会員一覧・フォロー・解除・タイムライン）のエンドポイントを、Web と同じルールで足す。

**Architecture:** `store` に Web の Prisma と同じ条件の SQL を足し、`httpapi` にハンドラと役割の判定を足す。スキーマは変えない。一覧は既存の `GET /v1/entries` と同じカーソル方式。

**Tech Stack:** Go 1.27、pgx/v5、`golang.org/x/text/collate`、既存の `httpapi`/`store` のヘルパー。

**Spec:** `docs/superpowers/specs/2026-10-21-go-api-trash-share-follow-design.md`

## Global Constraints

- スキーマ変更なし。テーブル `"LearningEntry"`（`deletedAt`・`sharedAt`・`ownerId`）、`"Hint"`、`"Follow"`（`followerId`・`followeeId`・`createdAt`、主キー `(followerId, followeeId)`）、`"PasswordAccount"`（`id`・`loginId`・`displayName`）を使う。
- すべての操作はトークンの ownerId で絞る。他人・存在しない・状態が違う（ゴミ箱にない／ゴミ箱の中）エントリーは `store.ErrNotFound` → 404 `not_found`。
- 共有は `role == member` だけ。admin は 403 `forbidden`、メッセージ「共有できるのは会員だけです。」。
- フォローの相手 ID は `^password:[a-z0-9]{1,64}$` だけを受け付ける（合わなければ 404）。自分は 400 `self_follow`「自分はフォローできません。」。存在しない会員は 404。
- 一覧: `limit` 既定 50・最大 100、`cursor` は既存の `encodeCursor`/`decodeCursor`（`(時刻, id)`）。ゴミ箱は `(deletedAt DESC, id DESC)`、タイムラインは `(createdAt DESC, id DESC)`。不正な値は 400。store には `limit+1` を渡して `nextCursor` を判定する（既存の `listEntries` と同じ）。
- 共有済みの再共有は最初の `sharedAt` を保つ。ゴミ箱に入れても `sharedAt` は消さない。
- 時刻は `dbTime`、ID は既存の `validID` で検査する。DB を使うテストは `API_TEST_DATABASE_URL` で、無ければ skip。固有の ownerId を使い TRUNCATE しない。
- 新しい直接依存は `golang.org/x/text` だけ。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。`DATABASE_URL` が未設定なら `DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public"` を付けてコミットする。

## Review Focus

- ゴミ箱とタイムラインで同じ時刻の行が並んでもページングで抜け・重複が出ないこと → Task 1 `TestListTrashedPaginatesTies`、Task 2 `TestTimelinePaginatesTies`。
- 退会した会員（`PasswordAccount` が無い）のエントリーがタイムラインに出ず、1 ページの件数も欠けないこと → Task 2 `TestTimelineSkipsDeletedMembers`。
- 他人のエントリーをゴミ箱から復元・完全削除・共有できないこと → Task 1 `TestTrashOpsAreOwnerScoped`。
- admin のトークンで共有すると 403、ゲストはそもそもトークンが無いこと → Task 3 `TestShareRequiresMember`。
- `{ownerId}` に `password:` 以外（GitHub の数値 ID、空、長すぎ）が来ても 500 にならないこと → Task 4 `TestFollowRejectsBadOwnerID`。

---

### Task 1: store — ゴミ箱と共有

**Files:** Create `services/api/store/trash.go`, `trash_test.go`

**Interfaces — Produces:**

```go
type TrashedEntry struct { Entry; DeletedAt time.Time }
func (s *Store) ListTrashed(ctx context.Context, ownerID string, after *Cursor, limit int) ([]TrashedEntry, error)
func (s *Store) RestoreEntry(ctx context.Context, ownerID, id string) (Entry, error)       // ゴミ箱にないなら ErrNotFound
func (s *Store) PurgeEntry(ctx context.Context, ownerID, id string) error                 // ゴミ箱にないなら ErrNotFound
func (s *Store) EmptyTrash(ctx context.Context, ownerID string) (int, error)
func (s *Store) SetShared(ctx context.Context, ownerID, id string, shared bool, now time.Time) (Entry, error) // ゴミ箱の中は ErrNotFound
```

`Cursor.CreatedAt` はゴミ箱の一覧では `deletedAt` の位置として使う。

- [ ] **Step 1: 失敗するテスト**（DB 使用）
  - `TestListTrashed`: ゴミ箱の中だけが `deletedAt DESC` で出て、`DeletedAt` とヒントが入る。ゴミ箱にないものと他人のものは出ない。
  - `TestListTrashedPaginatesTies`: 同じ `deletedAt` の 5 件を `limit=2` でたどると、ちょうど 1 回ずつ出る。
  - `TestRestoreEntry`: 復元すると `GetEntry` で読め、`sharedAt` は元のまま。2 回目は `ErrNotFound`。
  - `TestPurgeEntry`: 行とヒントが消える。ゴミ箱にないエントリーは `ErrNotFound` で、消えない。
  - `TestEmptyTrash`: 自分のゴミ箱の件数を返し、ゴミ箱にないものと他人のものは残る。
  - `TestSetShared`: 共有すると `sharedAt == now`。もう一度共有しても最初の値のまま。解除で nil。ゴミ箱の中は `ErrNotFound`。
  - `TestTrashOpsAreOwnerScoped`: 他人の ID で Restore・Purge・SetShared はすべて `ErrNotFound`、相手の行は変わらない。
- [ ] **Step 2:** `go test ./store/ -run 'Trash|Restore|Purge|Shared'` → コンパイルエラーで FAIL。
- [ ] **Step 3: 実装** — 条件は Web と同じ: 復元 `WHERE id AND ownerId AND deletedAt IS NOT NULL`、完全削除は同じ条件の DELETE、共有は `UPDATE … SET sharedAt = $now WHERE id AND ownerId AND deletedAt IS NULL AND sharedAt IS NULL`、0 行なら同じ条件から `sharedAt IS NULL` を外した存在確認で `ErrNotFound` かを決める。エントリーの読み出しは既存の `getEntry`/`scanEntries`/`attachHints` を使う。
- [ ] **Step 4:** `API_TEST_DATABASE_URL=… go test -race ./store/` → PASS。
- [ ] **Step 5:** `git commit -m "feat(api): store trash and sharing operations"`

---

### Task 2: store — フォロー・会員一覧・タイムライン

**Files:** Create `services/api/store/follows.go`, `follows_test.go`

**Interfaces — Produces:**

```go
type Member struct { OwnerID, DisplayName, LoginID string; Following, FollowsMe bool }
type MemberDirectory struct { Members []Member; FollowingCount, FollowerCount int } // Members は未ソートでよい
type TimelineItem struct { Entry Entry; OwnerID, OwnerName string }
func (s *Store) ListMembers(ctx context.Context, viewerID string) (MemberDirectory, error)
func (s *Store) MemberExists(ctx context.Context, ownerID string) (bool, error)          // "password:<id>" を受け取る
func (s *Store) Follow(ctx context.Context, followerID, followeeID string, now time.Time) error // 二重は何もしない
func (s *Store) Unfollow(ctx context.Context, followerID, followeeID string) error
func (s *Store) ListTimeline(ctx context.Context, viewerID string, after *Cursor, limit int) ([]TimelineItem, error)
```

- [ ] **Step 1: 失敗するテスト**（DB 使用。会員は SQL で INSERT）
  - `TestListMembers`: 自分以外の全会員が `ownerId = "password:"+id` で返り、`Following`/`FollowsMe` が正しい。`FollowingCount` は存在する会員だけ（存在しない相手へのフォロー行は数えない）、`FollowerCount` は自分をフォローしている行の数。
  - `TestFollowUnfollow`: 二重のフォローでエラーにならず行は 1 つ。解除後は行が無い。フォローしていない相手の解除もエラーにならない。
  - `TestMemberExists`: 存在する会員は true、存在しない ID・`password:` で始まらない ID は false。
  - `TestTimeline`: フォローしている相手の、共有中でゴミ箱にないエントリーだけが `createdAt DESC` で出る。`OwnerName` は `displayName`。フォローしていない相手・共有していない・ゴミ箱の中は出ない。フォローが無ければ空。
  - `TestTimelinePaginatesTies`: 同じ `createdAt` の 5 件を `limit=2` でたどると、ちょうど 1 回ずつ出る。
  - `TestTimelineSkipsDeletedMembers`: フォロー行と共有エントリーがあっても `PasswordAccount` が無い相手は出ず、`limit=2` のページが 2 件そろう。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3: 実装** — タイムラインは `"LearningEntry" e JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = $viewer JOIN "PasswordAccount" a ON e."ownerId" = 'password:' || a.id WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL` にカーソル条件、`ORDER BY e."createdAt" DESC, e.id DESC LIMIT`。ヒントは `attachHints`。`Follow` の INSERT は `ON CONFLICT DO NOTHING`、`createdAt` に `dbTime(now)`。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** `git commit -m "feat(api): store follows, member directory and timeline"`

---

### Task 3: httpapi — ゴミ箱と共有のエンドポイント

**Files:** Create `services/api/httpapi/trash_handlers.go`, `trash_handlers_test.go`; Modify `httpapi/router.go`（`Entries` に Task 1 のメソッドを足し、ルートを追加）、`httpapi/respond.go`（メッセージ定数）

**Interfaces — Consumes:** Task 1 のメソッド、既存の `parseListQuery`・`entryID`・`toEntryJSON`・`writeServiceError`・`principalFrom`・`requireAuth`。

- [ ] **Step 1: 失敗するテスト**（フェイク）
  - `TestListTrashHandler`: 200 `{entries, nextCursor}`、各エントリーに `deletedAt`（既存と同じ時刻形式）。`limit` 省略で store に 51。`limit+1` 件なら `nextCursor` が最後の要素の `(deletedAt, id)`。
  - `TestListTrashBadQuery`: `limit=0`・`101`・`abc`・`cursor=!!!` は 400。
  - `TestRestoreHandler`（200 とエントリー／`ErrNotFound` → 404）、`TestPurgeHandler`（204／404）、`TestEmptyTrashHandler`（200 `{"deleted": n}`）。
  - `TestShareHandler`: PUT で `shared=true`、DELETE で `false` が store に渡り、200 でエントリー。`ErrNotFound` → 404。
  - `TestShareRequiresMember`: admin の Principal では PUT・DELETE とも 403 `forbidden` でメッセージ「共有できるのは会員だけです。」、store は呼ばれない。
  - すべてのルートで、トークンが無ければ 401、不正な `{id}` は store を呼ばずに 404。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3: 実装** — ルート: `GET /v1/trash`、`DELETE /v1/trash`、`POST /v1/trash/{id}/restore`、`DELETE /v1/trash/{id}`、`PUT /v1/entries/{id}/share`、`DELETE /v1/entries/{id}/share`。すべて `requireAuth`。
- [ ] **Step 4:** `go test -race ./httpapi/` → PASS。
- [ ] **Step 5:** `git commit -m "feat(api): add trash and sharing endpoints"`

---

### Task 4: httpapi — フォローのエンドポイントと配線

**Files:** Create `services/api/httpapi/follow_handlers.go`, `follow_handlers_test.go`; Modify `httpapi/router.go`（`Deps` に `Follows` インターフェースを追加しルートを登録）、`services/api/main.go`（`Follows: db`）、`services/api/main_test.go`（e2e に 1 往復を足す）

**Interfaces — Produces:**

```go
type Follows interface {
    ListMembers(ctx context.Context, viewerID string) (store.MemberDirectory, error)
    MemberExists(ctx context.Context, ownerID string) (bool, error)
    Follow(ctx context.Context, followerID, followeeID string, now time.Time) error
    Unfollow(ctx context.Context, followerID, followeeID string) error
    ListTimeline(ctx context.Context, viewerID string, after *store.Cursor, limit int) ([]store.TimelineItem, error)
}
```

- [ ] **Step 1: 失敗するテスト**
  - `TestMembersHandler`: 200 `{members, followingCount, followerCount}`。`members` は `displayName` の日本語の照合順（`collate.New(language.Japanese)`）。例: `["さくら", "あおい", "Bob"]` → 照合順に並ぶことを、`collate` で並べた期待値と比べる。
  - `TestFollowHandler`: PUT は存在すれば 204 で `Follow` を呼ぶ。存在しなければ 404。自分は 400 `self_follow`「自分はフォローできません。」。
  - `TestUnfollowHandler`: DELETE は常に 204。
  - `TestFollowRejectsBadOwnerID`: `12345`・`password:`・`password:ABC`・65 文字の ID は 404 で store を呼ばない。
  - `TestTimelineHandler`: 200 `{items:[{entry, ownerId, ownerName}], nextCursor}`。ページングと不正なクエリの 400 は Task 3 と同じ。
  - トークンが無ければ 401（admin・会員はどちらも可）。
  - `TestRunEndToEnd`（`main_test.go`）に、会員 2 人を作って フォロー → 共有 → タイムラインに 1 件、を足す。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3: 実装** — `go get golang.org/x/text`。ルート: `GET /v1/members`、`PUT /v1/follows/{ownerId}`、`DELETE /v1/follows/{ownerId}`、`GET /v1/timeline`。`ownerId` の検査は正規表現 `^password:[a-z0-9]{1,64}$`。
- [ ] **Step 4:** `go vet ./... && API_TEST_DATABASE_URL=… go test -race ./...` → PASS。
- [ ] **Step 5:** `git commit -m "feat(api): add follow, member and timeline endpoints"`
