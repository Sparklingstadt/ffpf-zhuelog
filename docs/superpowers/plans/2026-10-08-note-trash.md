# 学習ノートと会話ノートのゴミ箱 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学習ノートと会話ノートを詳細画面からゴミ箱に入れ、ゴミ箱画面で元に戻す・完全に削除・空にするができるようにする。

**Architecture:** `LearningEntry` と `ChatConversation` に `deletedAt DateTime?` を足し、2つの Prisma リポジトリの既存クエリはすべて `deletedAt: null` で絞る。書き込みは core の薄いユースケース → `note-trash-controller.ts`（依存を引数で受ける）→ `note-trash-actions.ts`（Server Action：再検証とリダイレクト）。画面は共通のクライアント部品 `NoteActionForm` で送信・確認・エラー表示をする。

**Tech Stack:** Next.js 16.3.8（Server Actions、`useActionState`）、Prisma 7 + PostgreSQL、zod 4、node:test + tsx、Playwright。

**Spec:** ../specs/2026-10-08-note-trash-design.md

## Global Constraints

- 持ち主IDは常に `user.githubId`（`getCurrentMemberUser()`）。フォームから持ち主IDは受け取らない。
- ID検証：学習ノート `/^[a-z0-9]{1,64}$/`、会話 `z.uuid()`。不正なIDは「見つからない」と同じ扱い。
- 文言（そのまま使う）：
  - 権限なし：「ログインし直してください。」
  - 対象なし：「このノートは見つかりませんでした。画面を更新してください。」
  - DB失敗：「処理できませんでした。時間をおいてもう一度お試しください。」
  - 移動後の通知：「ゴミ箱に入れました。ゴミ箱から元に戻せます。」
  - 完全に削除の確認：「このノートを完全に削除します。元に戻せません。よろしいですか？」
  - 空にする確認：「ゴミ箱の N 件を完全に削除します。元に戻せません。よろしいですか？」
  - 表示上限超え：「古い N 件は表示していません。ゴミ箱を空にすると、表示していないものも含めて全部消えます。」
  - 0件：「ゴミ箱は空です」
- ゴミ箱一覧の上限：100 件（`TRASH_LIST_LIMIT`）。
- ログには固定コード `NOTE_TRASH_FAILED` だけを出す。本文・タイトルは出さない。
- 依存パッケージは追加しない。本番DBへの適用とマージはこの作業では行わない。

## Review Focus

1. **他人のノートIDを直接 POST する**（Server Action は UI 外から呼べる）→ リポジトリの `where` に本人の `ownerId` が入るので何も変わらず「見つからない」（Task 3 のテスト：持ち主IDはフォームの `ownerId`/`user` を無視して `githubId` から来る）。
2. **ゴミ箱に入れたあと、同じ日の番号URLを開く**（例 `/logs/…/3` が `/2` にずれる）→ 残ったノートで振り直され、範囲外は 404（Task 1・2 のリポジトリ、Task 6 の E2E）。
3. **ゴミ箱にない（またはすでに完全に削除した）ノートを「完全に削除」する**（2つのタブで二重送信）→ 物理削除せず「見つからない」（Task 1 の `purge` の `where`、Task 3 のテスト）。
4. **ゴミ箱の会話をチャット画面から保存し直す** → 復元され、会話ノートに戻る（Task 2 の `save`、Task 6 の E2E）。
5. **リダイレクト先の日付が改ざんされている**（`year=../x`）→ 日付一覧（`/logs`・`/conversations`）へ送る。オープンリダイレクトにならない（Task 3 の `trashedRedirectPath` のテスト）。

---

### Task 1: スキーマ・マイグレーションと学習ノートのゴミ箱（データ層）

**Files:**

- Modify: `prisma/schema.prisma`（`LearningEntry`・`ChatConversation` に `deletedAt DateTime?` と `@@index([ownerId, deletedAt])`）
- Create: `prisma/migrations/20261008120000_add_note_trash/migration.sql`（`git show HEAD:prisma/schema.prisma` を古いスキーマとして `prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script` で作る）
- Modify: `packages/core/src/domain/learning/repositories/learning-entry-repository.ts`
- Create: `packages/core/src/application/learning/use-cases/{trash-learning-entry,restore-learning-entry,purge-learning-entry,empty-learning-trash,list-trashed-entries}.ts`
- Modify: `src/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository.ts`
- Modify: `src/composition/learning-container.ts`
- Test: `packages/core/tests/learning-trash.test.ts`、`packages/core/tests/learning-owner.test.ts`（偽リポジトリにメソッドを足す）

**Interfaces:**

- Produces:
  - `type TrashedLearningEntry = LearningEntry & { deletedAt: Date }`、`type TrashedLearningEntries = { entries: TrashedLearningEntry[]; total: number }`
  - `LearningEntryRepository` に `trash(ownerId, id): Promise<boolean>`、`restore(ownerId, id): Promise<boolean>`、`purge(ownerId, id): Promise<boolean>`、`emptyTrash(ownerId): Promise<number>`、`listTrashed(ownerId, limit): Promise<TrashedLearningEntries>`
  - ユースケース `TrashLearningEntry`・`RestoreLearningEntry`・`PurgeLearningEntry`：`execute(ownerId, id): Promise<boolean>`。`EmptyLearningTrash.execute(ownerId): Promise<number>`。`ListTrashedEntries.execute(ownerId, limit = TRASH_LIST_LIMIT)`
  - `TRASH_LIST_LIMIT = 100`（`list-trashed-entries.ts` から export）
  - `learningUseCases.trashLearningEntry` / `restoreLearningEntry` / `purgeLearningEntry` / `emptyLearningTrash` / `listTrashedEntries`

- [ ] **Step 1: 失敗するテストを書く** `learning-trash.test.ts`：各ユースケースが `(ownerId, id)` をそのまま渡し、結果をそのまま返すこと。`ListTrashedEntries` は limit 省略時に `100` を渡すこと。
- [ ] **Step 2: 失敗を確認する** `node --import tsx --test packages/core/tests/learning-trash.test.ts` → FAIL
- [ ] **Step 3: 実装する**。Prisma 側：既存4メソッドの `where` に `deletedAt: null`。`trash` は `updateMany({ where: { id, ownerId, deletedAt: null }, data: { deletedAt: new Date() } })`、`restore` は `deletedAt: { not: null }` → `null`、`purge` は `deleteMany({ where: { id, ownerId, deletedAt: { not: null } } })`、`emptyTrash` は `deleteMany({ where: { ownerId, deletedAt: { not: null } } })`。いずれも `count === 1`（`emptyTrash` は `count`）を返す。`listTrashed` は `orderBy: [{ deletedAt: "desc" }, { id: "asc" }]`。マッパーは既存の `toLearningEntry` に `deletedAt` を足して返す。
- [ ] **Step 4: 確認する** `pnpm run test:unit` と `pnpm run typecheck` が PASS
- [ ] **Step 5: コミットする** `feat: 学習ノートをゴミ箱に入れられるようにする（データ層）`

### Task 2: 会話ノートのゴミ箱（データ層）

**Files:**

- Modify: `packages/core/src/domain/chat/repositories/conversation-note-repository.ts`
- Create: `packages/core/src/application/chat/use-cases/{trash-conversation,restore-conversation,purge-conversation,empty-conversation-trash,list-trashed-conversations}.ts`
- Modify: `src/infrastructure/persistence/prisma/repositories/prisma-conversation-repository.ts`
- Modify: `src/composition/conversation-container.ts`
- Test: `packages/core/tests/conversation-trash.test.ts`

**Interfaces:**

- Consumes: `TRASH_LIST_LIMIT`（Task 1）
- Produces:
  - `type TrashedConversationNote = ConversationNoteSummary & { deletedAt: string }`、`type TrashedConversationNotes = { conversations: TrashedConversationNote[]; total: number }`
  - `ConversationNoteRepository` に Task 1 と同じ5メソッド（`listTrashed` は `TrashedConversationNotes`）
  - `TrashConversation`・`RestoreConversation`・`PurgeConversation`・`EmptyConversationTrash`・`ListTrashedConversations`（形は Task 1 と同じ）
  - `conversationNoteUseCases.trashConversation` / `restoreConversation` / `purgeConversation` / `emptyConversationTrash` / `listTrashedConversations`

- [ ] **Step 1: 失敗するテストを書く** `conversation-trash.test.ts`：Task 1 と同じ観点。
- [ ] **Step 2: 失敗を確認する** → FAIL
- [ ] **Step 3: 実装する**。`list`・`get`・`listCreatedAt`・`createdWithin` に `deletedAt: null`。`get` は `findUnique` をやめて `findFirst({ where: { id, ownerId, deletedAt: null } })`。`save` の `update` に `deletedAt: null`。
- [ ] **Step 4: 確認する** `pnpm run test:unit` と `pnpm run typecheck` が PASS
- [ ] **Step 5: コミットする** `feat: 会話ノートをゴミ箱に入れられるようにする（データ層）`

### Task 3: controller・Server Action・`NoteActionForm`

**Files:**

- Create: `src/presentation/controllers/note-trash-controller.ts`
- Create: `src/presentation/presenters/note-trash-href.ts`
- Create: `src/presentation/actions/note-trash-actions.ts`
- Create: `src/presentation/components/records/note-action-form.tsx`
- Test: `tests/note-trash-controller.test.ts`

**Interfaces:**

- Consumes: Task 1・2 のユースケース
- Produces:
  - `type NoteActionState = { status: "idle" | "success" | "error"; message: string }`
  - `handleNoteAction(formData: FormData, deps: { getMember: () => Promise<{ githubId?: string } | null>; kind: "learning" | "conversation"; run: (ownerId: string, id: string) => Promise<boolean> }): Promise<NoteActionState>`
  - `handleEmptyTrash(deps: { getMember; run: (ownerId: string) => Promise<number> }): Promise<NoteActionState>`
  - `trashedRedirectPath(basePath: "/logs" | "/conversations", formData: FormData): string`（`year`・`month`・`day` を `parseLogDate` で検証。正しければ `${basePath}/${y}/${m}/${d}?trashed=1`、不正なら `basePath`）
  - Server Action（すべて `(previous: NoteActionState, formData: FormData) => Promise<NoteActionState>`）：`trashLearningEntryAction`・`restoreLearningEntryAction`・`purgeLearningEntryAction`・`emptyLearningTrashAction`・`trashConversationAction`・`restoreConversationAction`・`purgeConversationAction`・`emptyConversationTrashAction`
  - `NoteActionForm` props：`action`、`fields: Record<string, string>`（隠しフィールド）、`label: string`、`pendingLabel: string`、`icon?: ReactNode`、`variant?`（Button の variant）、`confirmMessage?: string`

- [ ] **Step 1: 失敗するテストを書く** `tests/note-trash-controller.test.ts`
  - `getMember` が `null` → `{ status: "error", message: "ログインし直してください。" }`、`run` は呼ばれない
  - `{}`（githubId なし）→ 同じ
  - 学習ノートで `id = "../x"`・会話で `id = "not-a-uuid"` → 対象なしの文言、`run` は呼ばれない
  - `run` が `false` → 対象なしの文言
  - `run` が throw → DB失敗の文言
  - 成功：フォームに `ownerId`・`user` があっても、`run` は `("219588180", id)` で呼ばれ `status: "success"`
  - `handleEmptyTrash`：成功で `run("219588180")`、権限なしで呼ばれない
  - `trashedRedirectPath("/logs", {year:"2026",month:"10",day:"8"})` → `/logs/2026/10/8?trashed=1`、`{year:"../x"}` → `/logs`
- [ ] **Step 2: 失敗を確認する** `node --import tsx --test tests/note-trash-controller.test.ts` → FAIL
- [ ] **Step 3: 実装する**。Action は成功時に `revalidatePath("/")`・`("/logs","layout")`・`("/conversations","layout")`。trash 系だけ `redirect(trashedRedirectPath(...))`。DB失敗時は `console.error("NOTE_TRASH_FAILED")`。`NoteActionForm` は `useActionState`、`onSubmit` で `confirmMessage` があれば `window.confirm` が false のとき `preventDefault()`、エラーは `Alert variant="destructive"` で出す。
- [ ] **Step 4: 確認する** `pnpm run test:unit`・`pnpm run typecheck`・`pnpm run lint` が PASS
- [ ] **Step 5: コミットする** `feat: ノートのゴミ箱操作の Server Action を追加する`

### Task 4: 学習ノートの画面

**Files:**

- Modify: `src/presentation/components/learning/learning-entry-card.tsx`（`actions?: ReactNode` をフッター右に出す）
- Modify: `src/app/logs/[year]/[month]/[day]/[number]/page.tsx`（`self` のとき「ゴミ箱に入れる」）
- Modify: `src/app/logs/[year]/[month]/[day]/page.tsx`（`?trashed=1` の通知、「ゴミ箱」ボタン）
- Modify: `src/app/logs/page.tsx`（「ゴミ箱」ボタン）
- Create: `src/app/logs/trash/page.tsx`
- Create: `src/presentation/components/records/trash-notice.tsx`（通知とゴミ箱リンク。学習・会話で共用）

- [ ] **Step 1: 実装する**。ゴミ箱画面は `getRecordOwner(undefined)` で判定（未ログイン→`/signin`、guest→`/`、reauth→`ReauthNotice`）。カード：`LearningEntryCard` に `defaultOpen={false}`、`numberLabel` は作成日（`formatTokyoDateTime`）、`actions` に「ゴミ箱に入れた日時」「元に戻す」「完全に削除」。
- [ ] **Step 2: 確認する** `pnpm run typecheck`・`pnpm run lint`
- [ ] **Step 3: コミットする** `feat: 学習ノートのゴミ箱画面と削除ボタンを追加する`

### Task 5: 会話ノートの画面

**Files:**

- Modify: `src/app/conversations/[year]/[month]/[day]/[number]/page.tsx`（ダウンロードボタンの隣に「ゴミ箱に入れる」）
- Modify: `src/app/conversations/[year]/[month]/[day]/page.tsx`、`src/app/conversations/page.tsx`
- Create: `src/app/conversations/trash/page.tsx`

- [ ] **Step 1: 実装する**（Task 4 と同じ形。カードはタイトル・保存日時・件数・モデル名・ゴミ箱に入れた日時）
- [ ] **Step 2: 確認する** `pnpm run typecheck`・`pnpm run lint`
- [ ] **Step 3: コミットする** `feat: 会話ノートのゴミ箱画面と削除ボタンを追加する`

### Task 6: E2E と README

**Files:**

- Create: `e2e/trash.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: E2E を書く**：spec の「テスト」節の4シナリオ（学習ノートの一巡、会話ノートの一巡と再保存での復元、確認キャンセル、管理者で他人を表示中）。確認は `page.once("dialog", d => d.accept())` / `d.dismiss()`。
- [ ] **Step 2: 実行する** `pnpm run test:e2e -- e2e/trash.spec.ts` → PASS。あわせて既存の `e2e/learning.spec.ts`・`conversations.spec.ts`・`records.spec.ts`・`chat.spec.ts` も PASS
- [ ] **Step 3: README を追記する**（ゴミ箱の使い方と、マイグレーション `20261008120000_add_note_trash` の本番適用手順）
- [ ] **Step 4: コミットする** `test: ゴミ箱の E2E と README を追加する`
