# Web のデータの読み書きを Go API に移す（段階3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web のデータの読み書きをすべて Go API 経由にし、Web から Prisma の読み書きと Auth.js を外す。

**Architecture:** `src/infrastructure/go-api/` に Go API を呼ぶアダプタを置き、composition の container がそれを使う。controller と画面はそのまま、Go と重なるユースケースは消す。最後に Auth.js と Prisma の Web の部分を消し、e2e と CI を Go 版だけにする。

**Tech Stack:** Next.js 16（App Router、Server Actions、`src/proxy.ts`）、node:test、Playwright、Go（`services/api`）。

**Spec:** `docs/superpowers/specs/2026-10-22-web-data-via-go-api-design.md`

## Global Constraints

- スキーマ・マイグレーションは変えない。
- Next.js のコードを書く前に `node_modules/next/dist/docs/` の該当ガイドを読む（学習データと違う版）。
- Go API の呼び出しは `src/infrastructure/go-api/client.ts` の `goApi` を通す（すべての失敗は `GoApiError`）。アクセストークンは `zl_access` から読む。
- 一覧は `limit=100` の 1 回だけ。`?user=` は管理者が他の人を見るときの 5 つの読み取りだけ。
- エラー：Go の `message` を出すのは `400`（`invalid_request`・`invalid_csv`・`password_mismatch`・`invalid_current_password`）・`409 login_id_taken`・`413 too_large`。`401` は `/signin` へ。`403` は今の権限なしの扱い。`429`・`5xx`・`status 0` は今の一般的な文言。
- 新しい日本語の文言を Web に足さない（Go の文言か、今ある文言を使う）。
- CSV の時間切れは 4 分 30 秒、項目名は `csvFile`。
- ログ・エラーにトークン・パスワード・秘密を出さない。`--no-verify` を使わない。
- 各タスクの終わりに `pnpm run test:unit`・`pnpm run typecheck`・`pnpm run lint` が通ること（Go を触ったら `go test ./...`・`go vet ./...`）。

## Review Focus

1. 管理者が他の人のノートを見る（`?user=`）とき、5 つの読み取りすべてで正しい持ち主が出る。会員が `?user=` を付けても自分のノートだけ（今と同じリダイレクト）。
2. 読み取りの途中でアクセストークンが切れていた（Go が `401`）→ `/signin` に送られ、500 にならない。
3. CSV：4 MiB を超えるファイル・`.csv` 以外・壊れた行 → Go の文言が画面に出る。
4. 会員の作成で loginId が重複 → 「使われています」系の Go の文言が出る（今と同じ見え方）。
5. Auth.js の Cookie だけを持っている人（切り替え前のセッション）→ ログインしていない扱いで `/signin` へ。

---

### Task 1: Go — 一覧に `total` を足す

**Files:** `services/api/httpapi/entry_handlers.go`、`trash_handlers.go`、`services/api/store/`（件数を数える関数）、`httpapi/router.go` の `Entries` interface、テスト、`docs-site/reference/entries.md`・`trash.md`。

- `GET /v1/entries` は `{entries, nextCursor, total}`。`total` は持ち主（`?user=` を含む）のゴミ箱に無いノートの数。
- `GET /v1/trash` は `{entries, nextCursor, total}`。`total` はゴミ箱のノートの数。
- テスト：件数がページの大きさと関係なく全体の数になる（`limit=1` で 3 件あれば `total: 3`）。
- Commit：`feat(api): 一覧の応答に total を足す`

### Task 2: Web — Go API のクライアントを広げる

**Files:** `src/infrastructure/go-api/client.ts`、新しい `src/infrastructure/go-api/authed.ts`、テスト。

- `GoApiError` に `message: string`（Go の `error.message`。無ければ空）を足す。`Error.message` には入れない（ログに出るため）。
- `authed.ts`：`goApiAuthed<T>(path, init)` — `zl_access` を読み、無い・Go が `401` なら `redirect("/signin")`。ほかは `goApi` と同じ。`clientIp` が要る呼び出し（パスワード変更）のために `clientAddress(await headers())` を渡せるようにする。
- `goUpload<T>(path, form: FormData, init)` — `multipart/form-data`（`content-type` は fetch に任せる）、時間切れ 270 秒、Bearer、`redirect: "error"`。失敗はすべて `GoApiError`。
- Go の JSON をドメインの型に直す関数：`toLearningEntry(json)`（日時を `Date` に、hints を含む）。`src/domain/learning/entities` の型に合わせる。
- テスト：message の取り出し、multipart の送り方（content-type を手で付けない）、`toLearningEntry`。
- Commit：`feat(web): Go API のクライアントに認証つきの呼び出しとアップロードを足す`

### Task 3: Web — ノートの読み取り（ホーム・カレンダー・日ごと・1 件）

**Files:** 新しい `src/infrastructure/go-api/learning-gateway.ts`、`src/composition/learning-container.ts`、`src/app/page.tsx`、`src/app/logs/page.tsx`、`src/app/logs/[year]/[month]/[day]/page.tsx`、`.../[number]/page.tsx`、関係するユースケースとテスト。

- `listRecent(owner, 100)` → `GET /v1/entries?limit=100[&user=]`、`{entries, total}`。
- カレンダー → `GET /v1/log-dates[?user=]`（Go が JST で日付ごとにまとめたもの）。Web の `ListLogDates` のまとめる処理は消す。
- 日ごと → `GET /v1/log-dates/{date}/entries[?user=]`。1 件 → `.../{number}`、`404` は `null`（今の `notFound()`）。
- `?user=` は `owner.kind === "other"` のときだけ。
- Commit：`feat(web): ノートの読み取りを Go API で行う`

### Task 4: Web — ゴミ箱と共有

**Files:** `learning-gateway.ts`（続き）、`src/app/logs/trash/page.tsx`、`src/presentation/actions/note-trash-actions.ts`、`follow-actions.ts`（共有）、controller のつなぎ、テスト。

- ゴミ箱へ → `DELETE /v1/entries/{id}`（`404` は今の「見つからない」）。戻す → `POST /v1/trash/{id}/restore`。完全に消す → `DELETE /v1/trash/{id}`。空にする → `DELETE /v1/trash`（`{deleted}`）。一覧 → `GET /v1/trash?limit=100`（`{entries, total}`）。
- 共有 → `PUT`/`DELETE /v1/entries/{id}/share`。
- Commit：`feat(web): ゴミ箱と共有を Go API で行う`

### Task 5: Web — CSV の取り込み

**Files:** `src/presentation/actions/import-learning-csv-action.ts`、`src/presentation/controllers/learning-csv-import-controller.ts`、`learning-gateway.ts`、テスト。消す：`csv-parse-learning-parser.ts`、`ImportLearningCsv`、CSV の parser の port、`csv-parse` の依存、Web 側の CSV の解析のテスト。

- `File` をそのまま `goUpload("/v1/imports/csv", form)`（項目 `csvFile`）。成功は今の「N 件取り込みました」の表示に `count` を使う。`400 invalid_csv`・`413 too_large` は Go の文言。
- Commit：`feat(web): CSV の取り込みを Go API で行う`

### Task 6: Web — フォロー・会員一覧・タイムライン

**Files:** 新しい `src/infrastructure/go-api/social-gateway.ts`、`src/composition/social-container.ts`、`src/app/follow/page.tsx`、`follow-actions.ts`、テスト。消す：`ListFollowDirectory`・`ListFollowTimeline`・`FollowMember`・`UnfollowMember`、`prisma-follow-repository.ts`、関係するテスト。

- 一覧 → `GET /v1/members`。タイムライン → `GET /v1/timeline?limit=100`（`{entry, ownerId, ownerName}`）。フォロー → `PUT /v1/follows/{ownerId}`（`404` は「見つからない」、`400 self_follow` は「自分」）。解除 → `DELETE`。
- 画面のコンポーネントが受け取る形は今のまま（変換はアダプタで）。
- Commit：`feat(web): フォローとタイムラインを Go API で行う`

### Task 7: Web — 会員の管理と自分のパスワード変更

**Files:** 新しい `src/infrastructure/go-api/account-gateway.ts`、`src/composition/identity-container.ts`、`src/composition/record-owner-options.ts`、`src/app/admin/accounts/page.tsx`、`src/presentation/actions/password-account-actions.ts`、`account-action-errors.ts`、テスト。消す：`CreatePasswordAccount`・`ResetPasswordAccountPassword`・`ChangeOwnPassword`・`ListPasswordAccounts`、関係するテスト。

- 一覧 → `GET /v1/admin/accounts`。作成 → `POST /v1/admin/accounts`（`{account, password, generated}`。今の「作成しました・仮パスワード」の表示）。再設定 → `POST /v1/admin/accounts/{id}/password`。
- 自分のパスワード → `POST /v1/account/password`（`clientIp` を渡す）、成功後は `signOutViaGo("/signin?notice=password-changed")` 相当。
- エラーの表示は Global Constraints どおり（Go の文言をフォームの全体のエラーとして出す。項目ごとの赤字が今あるなら、Go の `code` で出せる範囲で出し、出せないものは全体のエラーにする）。
- Commit：`feat(web): 会員の管理とパスワード変更を Go API で行う`

### Task 8: Web — Auth.js と Prisma の Web の部分を外す

**Files:** 消す：`src/auth.ts`、`src/app/api/auth/[...nextauth]/`、`src/infrastructure/auth/` の Auth.js・Prisma 向けのファイル（`client-address.ts` は残す）、`src/types/next-auth.d.ts`、`src/presentation/http/password-sign-in-failure.ts`、`AuthenticatePasswordAccount`、`src/infrastructure/persistence/prisma/`、使われなくなった port・ユースケース・テスト、`next-auth` の依存。直す：`src/proxy.ts`（常に Go 版）、`identity-container.ts`（分岐をなくす）、`environment.ts`（`isGoAuthEnabled` をなくし、`isAuthConfigured` は Go の設定がそろっているか）、`signin/page.tsx`、`auth-actions.ts`。移す：`ScryptPasswordHasher` を `scripts/lib/` へ（e2e・シード・そのテストの import も）。

- `tests/architecture.test.ts` が通ること。`pnpm run build` が通ること（`DATABASE_URL` が無くても Web のビルドが通るなら、それも確かめて記録する）。
- Commit：`refactor(web): Auth.js と Prisma の読み書きを外す`

### Task 9: e2e・CI・ドキュメントを Go 版だけにする

**Files:** `e2e/environment.ts`・`fixtures.ts`・`server.ts`・`*.spec.ts`、`.github/workflows/ci.yml`、`README.md`、`.env.example`、`docs/api-deployment.md`、`docs-site/`。

- `ZHUELOG_E2E_AUTH` をなくし、常に Go API を起動する。Auth.js 向けの分岐・テストを消す。
- CI の e2e の matrix をなくし、Go を入れる 1 つのジョブにする。
- ドキュメントは Go 版だけの構成に。「段階3のマージの前に、Go API のプロジェクトを作り、Web を切り替えておく」ことを明記する。
- `pnpm run test:e2e` が全部通る（終わったら `pnpm run test:e2e:stop`）。
- Commit：`test(e2e): e2e と CI を Go API だけにする` と `docs: Go API だけの構成に直す`
