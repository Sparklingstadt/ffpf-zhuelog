# ユーザーごとの学習ノートと会話記録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学習ノートを持ち主ごとに分け、本人と管理者（閲覧のみ）だけが見られるようにする。会話記録も管理者が `?user=` で閲覧できるようにする。

**Architecture:** `LearningEntry.ownerId` を追加し、学習系のリポジトリとユースケースはすべて `ownerId` を受け取る。各ページは core の `ResolveRecordOwner` で表示対象（自分／他人・閲覧のみ／拒否／自分へ戻す）を決める。admin には切り替え欄を出し、`?user=` をリンクに引き継ぐ。LINE は `LINE_NOTE_OWNER_ID` の持ち主に保存する。

**Tech Stack:** Next.js 16.3.8、Auth.js v5、Prisma 7 + PostgreSQL、zod 4、node:test + tsx、Playwright。

**Spec:** ../specs/2026-10-08-per-user-records-design.md

## Global Constraints

- 持ち主IDの形式: `/^\d+$/` または `/^password:[a-z0-9]{20,32}$/`。GitHub は数字、メンバーは `password:<PasswordAccount.id>`。`AuthenticatedUser.githubId` がこの値を持つ。
- 既存の学習ノートの持ち主: `219588180`。
- 新しい環境変数: `LINE_NOTE_OWNER_ID`（Cloud Run のみ。LINE 有効時は必須）。失敗時のログの固定コードは `LINE_NOTE_OWNER_MISSING`。
- 書き込み（CSVインポート・会話保存）は常にログイン中の本人の `githubId` で行う。`?user` は書き込みに使わない。
- 他人の記録を表示中の文言: 「〇〇さんの記録を表示中（閲覧のみ）」。〇〇はメンバーなら表示名、それ以外は持ち主ID。
- ゲストのトップの文言: 「学習ノートは、ログインしたユーザーごとの記録です。ゲストは自分のAPIキーでの添削を利用できます。」
- 依存パッケージは追加しない。本番DBへの適用とマージはこの作業では行わない。

## Review Focus

1. **member が `?user=` に他人のIDを指定する** → 自分の記録の画面に戻り、他人の記録の有無は分からない（Task 1 のユニット、Task 7 の E2E）。
2. **admin が他人を表示中に CSV をインポートしようとする**（フォームは出ないが、Server Action を直接呼ぶ）→ 本人のノートに入る。他人のノートには入らない（Task 5 のテスト：Action は `user.githubId` だけを使う）。
3. **日付内の番号が持ち主をまたがない**：A と B が同じ日に記録すると、どちらも 1 番から始まる（Task 2 のリポジトリ、Task 7 の E2E）。
4. **`githubId` を持たない古い admin セッション** → 学習ノートで再ログインの案内が出る。例外にならない（Task 1 のユニット、Task 5）。
5. **`LINE_NOTE_OWNER_ID` が未設定のまま LINE が有効** → 記録を保存せず失敗の返信を送り、`LINE_NOTE_OWNER_MISSING` をログに出す。他のジョブは止まらない（Task 3 のユニット）。

---

### Task 1: 持ち主IDの形式と `ResolveRecordOwner`

**Files:**

- Create: `packages/core/src/domain/identity/owner-id.ts`
- Create: `packages/core/src/application/identity/use-cases/resolve-record-owner.ts`
- Modify: `src/infrastructure/auth/github-identity.ts`（`githubIdFromToken` が `isOwnerId` を使う）
- Test: `packages/core/tests/resolve-record-owner.test.ts`、`tests/github-identity.test.ts`（既存のテストが通り続けること）

**Interfaces:**

- Produces:
  - `isOwnerId(value: string): boolean`（owner-id.ts）
  - `type RecordOwner = { kind: "self"; ownerId: string } | { kind: "other"; ownerId: string } | { kind: "denied"; reason: "unauthenticated" | "guest" | "reauth" } | { kind: "redirect-self" }`
  - `resolveRecordOwner(user: AuthenticatedUser | null, requested: string | undefined): RecordOwner`（純粋関数。resolve-record-owner.ts）

- [ ] **Step 1: 失敗するテストを書く** `packages/core/tests/resolve-record-owner.test.ts`
  - 次の結果になることを確認する。
    - null → `denied/unauthenticated`
    - guest → `denied/guest`
    - revoked → `denied/unauthenticated`
    - `githubId` のない admin → `denied/reauth`
  - admin（`githubId:"219588180"`）の場合：
    - `undefined` / `""` / `"219588180"` → `self`
    - `"password:ckabcdefghijklmnopqrstuvw"` → `other`
    - `"42"` → `other`
    - `"../x"` / `"password:ABC"` → `redirect-self`
  - member（`githubId:"password:ckabcdefghijklmnopqrstuvw"`）の場合：
    - `undefined` → `self`
    - `"219588180"` → `redirect-self`
  - `isOwnerId`：`"219588180"`・`"password:ckabcdefghijklmnopqrstuvw"` は true。`"password:"`・`"219588180\n"`・`"abc"` は false。

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test packages/core/tests/resolve-record-owner.test.ts` → FAIL

- [ ] **Step 3: 実装する**。github-identity.ts の正規表現は `isOwnerId` に置き換える。既存の `tests/github-identity.test.ts` は変更しない。

- [ ] **Step 4: 確認する** 上記と `node --import tsx --test tests/github-identity.test.ts packages/core/tests/architecture.test.ts` が PASS

- [ ] **Step 5: コミットする** `feat: 記録の表示対象を決める ResolveRecordOwner を追加する`

---

### Task 2: `LearningEntry.ownerId` とリポジトリ・ユースケース

**Files:**

- Modify: `prisma/schema.prisma`。`LearningEntry` に `ownerId String` と `@@index([ownerId, createdAt])` を追加し、`@@index([createdAt])` を削除する。
- Create: `prisma/migrations/20261008090000_learning_entry_owner/migration.sql`。列の追加 → `UPDATE ... SET "ownerId" = '219588180'` → `SET NOT NULL` → インデックスの付け替え、の順に書く。DBに繋がずに `prisma migrate diff` で骨格を作り、UPDATE を手で足す。
- Modify: `packages/core/src/domain/learning/repositories/learning-entry-repository.ts`（すべてのメソッドの第1引数に `ownerId: string` を追加し、コメントも直す）
- Modify: `packages/core/src/application/learning/use-cases/{import-learning-csv,list-recent-entries,list-daily-entries,get-daily-entry}.ts`、`packages/core/src/application/calendar/use-cases/list-log-dates.ts`（`CreatedAtSource.listCreatedAt(ownerId)`）、`packages/core/src/application/integration/use-cases/{export-integration,preview-integration}.ts`。どれも `execute(ownerId, …既存の引数)`。
- Modify: `src/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository.ts`（すべての検索・件数を `where: { ownerId, … }` で絞り、作成時に `ownerId` を入れる）
- Test: 既存の core テストとアプリのテスト（呼び出し側を直す）。`packages/core/tests/learning-owner.test.ts`（新規。fake のリポジトリで、各ユースケースが ownerId を渡すことを確認する）

**Interfaces:**

- Produces: `LearningEntryRepository.{importBatch(ownerId, fileName, entries), listRecent(ownerId, limit), listCreatedAt(ownerId), listByDate(ownerId, range), getByDateAndNumber(ownerId, range, entryNumber)}`。各ユースケースは `execute(ownerId, ...)`。
- 呼び出し側（ページ・Action・エクスポート）は Task 5 で直す。このタスクでは typecheck を通すために、呼び出し箇所へ一時的に `user.githubId ?? ""` を渡してよい。Task 5 で ResolveRecordOwner に置き換える。

- [ ] **Step 1: 失敗するテストを書く**。`learning-owner.test.ts` で、次の呼び出しで fake の受け取った ownerId が `"o1"` になることを確認する。
  - `new ListRecentEntries(fake).execute("o1", 10)`
  - `ImportLearningCsv(...).execute("o1", "a.csv", csv)`
  - `ListDailyEntries`、`GetDailyEntry`、`ListLogDates`、`ExportIntegration`、`PreviewIntegration`
- [ ] **Step 2: 失敗を確認する**（`node --import tsx --test packages/core/tests/learning-owner.test.ts`）
- [ ] **Step 3: 実装する**。リポジトリ、ユースケース、Prisma の実装、スキーマ、マイグレーションを変更する。日付内の番号（`getByDateAndNumber`）と件数も ownerId で絞る（Review Focus 3）。
- [ ] **Step 4: 確認する**
  - `pnpm run db:generate && pnpm run typecheck && pnpm run test:unit` が通る。
  - E2E 用DB（`docker compose -f compose.e2e.yaml up -d --wait`、`DATABASE_URL=postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e`）で `prisma migrate deploy` が成功する。
  - そのDBに既存行を1件入れた状態からマイグレーションした場合、`ownerId='219588180'` が入ることも確かめて報告する。
  - 終わったら DB を停止する。
- [ ] **Step 5: コミットする** `feat: 学習ノートに持ち主を持たせる`

---

### Task 3: LINE の保存先 `LINE_NOTE_OWNER_ID`

**Files:**

- Modify: `src/infrastructure/line/config.ts`（`LineConfig` に `noteOwnerId: string | null` を足す。値が `isOwnerId` を満たせばその値、そうでなければ null。LINE 自体は無効にしない）
- Modify: `packages/core/src/application/line/use-cases/process-line-learning.ts`（コンストラクタで `noteOwnerId: string | null` を受け取る。null のときは保存せず `jobs.fail(job, false, "NOTE_OWNER_MISSING")` を呼び、生成失敗と同じ返信の流れにする。ログ出力は注入された logger か composition で `console.error("LINE_NOTE_OWNER_MISSING")` を出す）
- Modify: `packages/core/src/domain/line/repositories/line-job-repository.ts` と `prisma-line-job-repository.ts`（`saveResult(job, draft, csv, ownerId)` で LearningEntry に `ownerId` を入れる）
- Modify: `src/composition/line-container.ts`、`e2e/server.ts`（`LINE_NOTE_OWNER_ID: "10001"` など E2E の admin と同じ値）、`docs/line-integration.md`（環境変数の表）、`docs/cloud-run.md`、`scripts/enable-line-cloud-run.sh`（`--update-env-vars` に `LINE_NOTE_OWNER_ID=$note_owner_id` を追加し、値の入力を促す。既定値なし）
- Test: `packages/core/tests/line-results.test.ts` または `drain-line-jobs.test.ts` に追加（既存の fake に倣う）。`tests/line.test.ts`（config）。

- [ ] **Step 1: 失敗するテストを書く**
  - noteOwnerId が null のとき、`saveResult` は呼ばれない。`fail` が `"NOTE_OWNER_MISSING"` で呼ばれ、利用者には失敗の返信が行く（既存の生成失敗テストと同じ観点）。
  - `"o1"` のとき、`saveResult` に `"o1"` が渡る。
  - config：`LINE_NOTE_OWNER_ID` が未設定・`"x"` のときは `noteOwnerId === null` で、他の値はそのまま。`"219588180"` のときはその値。
- [ ] **Step 2: 失敗を確認する**
- [ ] **Step 3: 実装する**。`fail` の失敗コードの型に `NOTE_OWNER_MISSING` を加える必要があれば、domain の型に追加する。DBの制約で failureCode の値が限られていないかも確認する（以前のマイグレーションで CHECK 制約を足している）。制約がある場合は、Task 2 のマイグレーションとは別に `prisma/migrations/20261008091000_line_note_owner_missing/migration.sql` で許可する値を足す。
- [ ] **Step 4: 確認する** 対象テスト、`pnpm run test:unit`、`pnpm run typecheck`、`pnpm run lint`
- [ ] **Step 5: コミットする** `feat: LINE の記録を LINE_NOTE_OWNER_ID の持ち主に保存する`

---

### Task 4: 表示対象の解決・切り替え欄・表示中バナー

**Files:**

- Modify: `src/composition/identity-container.ts`（`getRecordOwner(requested: string | undefined): Promise<RecordOwner>` を追加。`getCurrentViewerUser` に相当する現在のユーザーを取り、`resolveRecordOwner` を呼ぶ）
- Create: `src/presentation/presenters/record-owner-href.ts`（`withRecordOwner(href: string, owner: RecordOwner): string`。`kind === "other"` のときだけ `user` クエリを付ける。既存のクエリやハッシュは保つ）
- Create: `src/presentation/components/records/record-owner-switcher.tsx`（server component。props は `{ owner: RecordOwner; options: { ownerId: string; label: string }[]; action: string }`。admin のときだけ描画する GET フォームで、`<select name="user">` の先頭が「自分」（value ""）、ボタンは「表示」）
- Create: `src/presentation/components/records/viewing-other-banner.tsx`（「〇〇さんの記録を表示中（閲覧のみ）」と「自分の記録に戻る」リンク）
- Create: `src/composition/record-owner-options.ts`（`listRecordOwnerOptions(): Promise<{ ownerId; label }[]>`。`passwordAccountUseCases.list` から `password:<id>` と `表示名（ログインID）` を作る。`labelForOwner(ownerId, options)` は一致すれば表示名、なければ ownerId を返す）
- Test: `tests/record-owner-href.test.ts`

- [ ] **Step 1: 失敗するテストを書く**
  - `withRecordOwner("/logs/2026/10/07", {kind:"other", ownerId:"password:ck…"})` → `"/logs/2026/10/07?user=password%3Ack…"`
  - `{kind:"self"}` → そのまま
  - `"/logs?x=1#a"` + other → クエリとハッシュを保つ
- [ ] **Step 2: 失敗を確認する** → **Step 3: 実装する** → **Step 4: 確認する**（`pnpm run typecheck && pnpm run lint && pnpm run test:unit`）
- [ ] **Step 5: コミットする** `feat: 記録の表示対象の切り替え欄と表示中バナーを追加する`

---

### Task 5: 学習ノート・日付別ログ・連携の画面と CSV インポート

**Files:**

- Modify: `src/app/page.tsx`、`src/app/logs/page.tsx`、`src/app/logs/[year]/[month]/[day]/page.tsx`、`src/app/logs/[year]/[month]/[day]/[number]/page.tsx`、`src/app/integrations/[id]/page.tsx`、`src/app/api/integrations/[id]/export/route.ts`（＋`integration-export-controller.ts` に ownerId を渡す）
- Modify: `src/presentation/actions/import-learning-csv-action.ts`（`user.githubId` がなければ「一度ログアウトしてログインし直してください。」を返す。あれば `execute(user.githubId, …)` を呼ぶ）
- Modify: ログ・カードのコンポーネント（`src/presentation/components/learning/*`、`log-date-presenter.ts` の href 生成）。他人を表示中は `withRecordOwner` でリンクを作る。

**各ページの共通の流れ**

1. `searchParams.user` を読み、`getRecordOwner` で表示対象を決める。
2. 結果ごとに次のようにする。
   - `denied/unauthenticated`：今と同じくサインインへ移す。
   - `denied/guest`：`/` ではゲスト向けの案内（Global Constraints の文言と `/practice` へのリンク）を出す。それ以外のページは `/` へ移す。
   - `denied/reauth`：今の再ログイン案内と同じ表示にする。
   - `redirect-self`：`?user` を外した同じパスへ移す。
3. 記録は `owner.ownerId` で読み、`kind === "other"` のときはバナーを出して CSV インポートを隠す。
4. admin には `RecordOwnerSwitcher` を出す。

- その他
  - エクスポートの API は `?user=` を同じ規則で解決する。`denied` は 401/403、`redirect-self` は自分として扱わず 403 を返す。
  - 「共有ノート」という文言を、トップ・ログイン画面・ゲストのカードで「学習ノート」に合う表現へ直す。
- Test: `tests/integration-export.test.ts`（ownerId を渡すこと、権限がないときに 403 になること）。それ以外の画面は Task 7 の E2E で確認する。

- [ ] **Step 1: 失敗するテストを書く**（エクスポートのコントローラが、解決した ownerId でエクスポートを呼ぶこと。member が他人を指定した場合は 403）
- [ ] **Step 2: 実装する**（上記の各ページ。Task 2 の一時的な `?? ""` をすべて取り除く）
- [ ] **Step 3: 確認する** `pnpm run test:unit && pnpm run typecheck && pnpm run lint && pnpm run build`（build のときは `DATABASE_URL` と仮の `AUTH_SECRET` を export する）
- [ ] **Step 4: コミットする** `feat: 学習ノートを本人と管理者だけが見られるようにする`

---

### Task 6: 会話ノートを管理者も閲覧できるようにする

**Files:**

- Modify: `src/app/conversations/page.tsx`、`src/app/conversations/[year]/[month]/[day]/page.tsx`、`src/app/conversations/[year]/[month]/[day]/[number]/page.tsx`（`getRecordOwner` を使い、`owner.ownerId` で `conversationNoteUseCases` を読む。admin には切り替え欄、表示中はバナー、リンクは `withRecordOwner`）
- 会話の API（`/api/chat/conversations`）と `/chat` は変更しない。

- [ ] **Step 1: 実装する**（`denied/guest` は `/`、`denied/reauth` は今の ReauthPage、`redirect-self` は `?user` を外したパスへ）
- [ ] **Step 2: 確認する** `pnpm run typecheck && pnpm run lint && pnpm run build`
- [ ] **Step 3: コミットする** `feat: 管理者がメンバーの会話ノートを閲覧できるようにする`

---

### Task 7: E2E と README

**Files:**

- Create: `e2e/records.spec.ts`
- Modify: `e2e/fixtures.ts`（必要なら `createMember` を流用）、ゲストが共有ノートを閲覧する前提の既存 E2E（`learning.spec.ts`、`responsive.spec.ts`、`theme.spec.ts` など）、`README.md`（学習ノートは個人の記録であること、管理者の閲覧、ゲストの範囲、`LINE_NOTE_OWNER_ID`、本番への反映手順）

- [ ] **Step 1: E2E を書く**（spec の「テスト」節の E2E をすべて扱う）
  - `members see only their own notes`：A と B が CSV をインポートする。それぞれの `/` と `/logs/<日付>/1` に自分の記録しか出ず、番号はそれぞれ 1 番から始まる（Review Focus 3）。
  - `admin views a member read-only`：切り替え欄で A を選ぶと、バナーが出てインポートフォームは出ない。日付リンクをたどっても `?user` が残る。
  - `member cannot view others`：`/?user=<adminのID>` → `/` に戻され、自分の記録が出る（Review Focus 1）。
  - `guest sees the practice guidance`：ゲストの `/` に案内と `/practice` へのリンクが出る。`/logs` は `/` へ移される。
  - `admin views member conversations; member cannot view others'`
  - `export contains only the shown owner's entries`
  - `LINE note goes to LINE_NOTE_OWNER_ID`（既存の line.spec に、保存された LearningEntry の ownerId を確かめる行を加える）
- [ ] **Step 2: 全体を検証する** `pnpm run test:regression`（E2E は Docker が必要。終わったら `pnpm run test:e2e:stop`）
- [ ] **Step 3: コミットする** `test: ユーザーごとの記録の E2E と README を追加する`
