# Go 廃止 段階 2（学習ノート・ゴミ箱・共有・カレンダー・検索）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学習ノートの一覧・検索・カレンダー・日ごとの表示・ゴミ箱・共有を、Go API から Next.js（Prisma）に移し、Go の該当コードを消す。

**Architecture:** 段階 1 と同じ形にする。

- Prisma の読み取り（生 SQL を含む）と書き込みを `src/infrastructure/prisma/` に置く。
- 権限と持ち主の決定は `src/application/learning/learning-notes.ts` に置く。
- `src/composition/learning-container.ts` の `learningNotes` が、移したメソッドは新しい実装、まだ移していないメソッドは Go のゲートウェイを指すように組み立てる。移していないのは、復習（段階 4）と CSV（段階 3）。
- 画面と Server Action は、`learningNotes` のメソッド名と型を変えずに使い続ける。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7（`$queryRaw`）、`node:test` + `tsx`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 2、決めたこと 7〜9）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage2-go-reference.md`（以下「参照」）。ルートごとの SQL・順番・文言・副作用と、Go に残すべきコードが、file:line 付きで書いてある。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない（ログは依存として受け取る）。
- **移さずに消すもの**：`GET /v1/entries/{id}`・`PATCH /v1/entries/{id}`・`POST /v1/batches`。Web から呼ぶところがなく、モバイル向けの API は残さないため（設計の決めたこと 2）。
- 持ち主：
  - 読み取りは、画面が決めた `ViewedOwner` を使う。`kind: "other"` のときは、application でもう一度、今の利用者が `role === "admin"` かを確かめる。違えば `LearningForbiddenError`。
  - 書き込み（ゴミ箱・戻す・完全に消す・空にする・共有）は、常に今の利用者の `githubId` で行う。管理者が「メンバーとして見る」ときは、その会員の ownerId になる。フォームの値は使わない。
  - 未ログイン・ゲスト・revoked・`githubId` なしは、どの操作も `LearningForbiddenError`。
- 共有：`role === "member"` で、`demo !== true` のときだけ。管理者（「メンバーとして見る」も含む）とデモは `LearningForbiddenError`。今の画面での見え方（`actionUnauthorized`）は変えない。
- 並び順（参照 §6-3）：
  - 一覧：`createdAt DESC, id DESC`
  - ゴミ箱：`deletedAt DESC, id DESC`
  - 日ごと：`createdAt ASC, id ASC`
  - 並べ替えは SQL で行う。id の比較は DB の照合順序に任せる。
- 日付（参照 §6-2）：
  - ノートの日は `("createdAt" + interval '9 hours')::date`。列は UTC を入れた `timestamp without time zone`。
  - 日の範囲は「JST の 0 時」を UTC に直したもの（前の日の 15:00Z）から 1 日。
  - 日ごとの「番号」は、その日のゴミ箱に無いノートを上の順に並べた、1 から始まる位置。
- 検索（参照 §1「Search filter」と §6-1）：生 SQL で、Go と同じ形にする。
  - 比較は `lower(col) LIKE lower($p) ESCAPE '\'`。
  - `q` は 3 列の OR と、ヒントの `UNION`。
  - `hint` は `EXISTS`。
  - `kind` は等しいかどうか。
  - パターンは `%` + 語（`\`→`\\`、`%`→`\%`、`_`→`\_`）+ `%`。
  - 小文字にするのは SQL で行う（JS では行わない）。
- `total` は、一覧と同じ条件で数える（カーソルは含めない）。
- ゴミ箱を完全に消す・空にするとき（参照 §6-8）：同じトランザクションで、その持ち主の `ReviewItem`（`kind = 'entry'`、`targetId` が消した id）も消す。`Hint` と `ReviewLog` は FK の cascade に任せる。`ImportBatch` は消さない。
- 共有（参照 §6-7）：
  - 共有するときは `sharedAt IS NULL` の行だけに `now` を入れ、最初の時刻を保つ。
  - やめるときは `sharedAt = NULL`。
  - どちらも、ゴミ箱にあるノートは「見つからない」。
- ゴミ箱に入れる・戻すときは、`sharedAt` と `createdAt` を変えない。`ReviewItem` にもさわらない（段階 4 までは、Go の復習がゴミ箱のノートを隠す）。
- 「見つからない」の扱い：ほかの人のもの・無いもの・ゴミ箱の状態が違うものは、区別せず `false` または `null` を返す（今のゲートウェイと同じ）。
- エラーの扱い（段階 1 と同じ）：Next の `redirect`・`notFound` は `unstable_rethrow` で投げ直す。それ以外の DB の失敗は、コードとエラーの名前だけをログに出し、今と同じ画面（お知らせ・一般的な文言）にする。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **検索に `%`・`_`・`\` が入る。** 文字どおりに探し、すべてには当たらない。→ Task 1 のテスト `escapes LIKE wildcards`、Task 4 の e2e `searching for 100% finds only the literal text`。
2. **JST の日付の境目。** UTC の 14:59 と 15:00 のノートが別の日になる。→ Task 1 のテスト `jstDayRange covers JST midnight to midnight`。既存の e2e `learning.spec.ts:237`（JST の日付ごとのまとめ）。
3. **管理者以外が `kind: "other"` で読む。** ほかの人のノートは返らない。→ Task 3 のテスト `only admins read another owner`。
4. **デモ・管理者・「メンバーとして見る」での共有。** どれも共有できない。→ Task 3 のテスト `only plain members may share`、Task 4 の e2e `the demo account cannot share`。
5. **ゴミ箱を完全に消したあとの復習カード。** その持ち主の entry カードだけが消え、ほかの人のカードと単語のカードは残る。→ Task 2 の説明と、Task 4 の既存 e2e `note-review.spec.ts:56`。

---

### Task 1: 読み取り（一覧・検索・カレンダー・日ごと・ゴミ箱の一覧）

**Files:**

- Create: `src/infrastructure/prisma/learning-note-reads.ts`、`src/infrastructure/prisma/learning-sql.ts`（純粋な関数）
- Test: `tests/learning-sql.test.ts`

**Interfaces:**

- Consumes: `prisma()`、`LearningEntry`（`src/domain/learning/entities/learning-entry.ts`）、`EntrySearch`（`src/domain/learning/entry-search.ts`）、`LogDate`（`src/domain/calendar/value-objects/log-date.ts`）、型 `RecentLearningEntries`・`LogDateSummary`・`DailyLearningEntry`・`TrashedLearningEntries`（今は `src/infrastructure/go-api/learning-gateway.ts` にある。`src/domain/learning/learning-note-views.ts` に移し、ゲートウェイからは re-export する）。
- Produces:

  ```ts
  // learning-sql.ts (pure)
  export function likeContains(term: string): string; // "%" + escaped + "%"
  export function jstDayRange(date: LogDate): { start: Date; end: Date }; // UTC instants of JST midnight and the next JST midnight
  // learning-note-reads.ts
  export function createLearningNoteReads(db: () => PrismaClient): {
    listRecent(
      ownerId: string,
      limit: number,
      search?: EntrySearch,
    ): Promise<RecentLearningEntries>; // newest first, at most limit, total = all matching live notes
    listAll(ownerId: string): Promise<LearningEntry[]>; // all live notes newest first, at most 10,000 (as today's export)
    listLogDates(ownerId: string): Promise<LogDateSummary[]>; // newest date first
    listDailyEntries(
      ownerId: string,
      date: LogDate,
    ): Promise<DailyLearningEntry[]>;
    getDailyEntry(
      ownerId: string,
      date: LogDate,
      number: number,
    ): Promise<{ entry: LearningEntry; number: number; total: number } | null>; // same shape the gateway returns today
    listTrashed(ownerId: string): Promise<TrashedLearningEntries>; // at most 100, newest trash first, total = all trashed
  };
  ```

  返す型と値の形は、今のゲートウェイ（`learning-gateway.ts` の `listRecent`・`listAll`・`listLogDates`・`listDailyEntries`・`getDailyEntry`・`listTrashed`）とまったく同じにする。ヒントは `position` の順に並べ、無ければ `[]` にする。

- [ ] **Step 1: 失敗するテストを書く。**
  - `escapes LIKE wildcards`：`likeContains("100%_a\\b")` → `"%100\\%\\_a\\\\b%"`。
  - `jstDayRange covers JST midnight to midnight`：`{year:2026,month:11,day:16}` → start は `2026-11-15T15:00:00.000Z`、end は `2026-11-16T15:00:00.000Z`。月末（`2026-12-31` → end `2026-12-31T15:00:00.000Z`）とうるう日（`2028-02-29`）も確かめる。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-sql.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 検索・カレンダー・日ごとの番号は `$queryRaw`（タグ付きテンプレートで値を渡し、文字列をつなげない）で書く。
  - ほかは、Prisma のクエリでも生 SQL でもよい。並び順と条件は、参照と Global Constraints のとおりにする。
  - `count(*)` の bigint は number に直す。
  - ヒントは、ノートの id をまとめて 1 回の問い合わせで取る（N+1 にしない）。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。`pnpm typecheck`、`pnpm lint` も PASS。
- [ ] **Step 5: コミット。** `feat(web): 学習ノートを Prisma で読む`

### Task 2: 書き込み（ゴミ箱・戻す・完全に消す・空にする・共有）

**Files:**

- Create: `src/infrastructure/prisma/learning-note-writes.ts`
- Test: `tests/learning-note-writes.test.ts`（純粋な部分だけ。DB の動きは Task 4 の e2e）

**Interfaces:**

- Produces:
  ```ts
  export function createLearningNoteWrites(
    db: () => PrismaClient,
    now: () => Date = () => new Date(),
  ): {
    trash(ownerId: string, id: string): Promise<boolean>; // live → trashed (deletedAt = now); false when not the owner's live note
    restore(ownerId: string, id: string): Promise<boolean>; // trashed → live; false otherwise
    purge(ownerId: string, id: string): Promise<boolean>; // only a trashed note; deletes its entry ReviewItems in the same transaction
    emptyTrash(ownerId: string): Promise<number>; // deletes all the owner's trashed notes and their entry ReviewItems; returns how many notes
    setShared(ownerId: string, id: string, shared: boolean): Promise<boolean>; // live notes only; keeps the first sharedAt
  };
  export function reviewItemsToDelete(
    ownerId: string,
    ids: string[],
  ): { ownerId: string; kind: "entry"; targetId: { in: string[] } }; // pure; the where clause both purge paths use
  ```
- [ ] **Step 1: 失敗するテストを書く。** `reviewItemsToDelete("password:a", ["x","y"])` → `{ownerId:"password:a", kind:"entry", targetId:{in:["x","y"]}}`。単語のカード（kind `"vocabulary"`）を巻き込まないことを確かめる。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-note-writes.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - どの書き込みも、`where` に `ownerId` と状態の条件（`deletedAt`、共有なら `sharedAt`）を入れ、`updateMany`・`deleteMany` の件数で判定する。先に読んで確かめてから書く形にはしない（段階 1 で見つかった競合を避ける）。
  - `emptyTrash` は、先に id を集めてから消すのではなく、トランザクションの中で「消した行の id」を確実に得る。生 SQL の `DELETE … RETURNING "id"` でもよい。
  - 時刻は `now()` を 1 回だけ取り、ミリ秒に切り詰める。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck` で PASS。
- [ ] **Step 5: コミット。** `feat(web): 学習ノートのゴミ箱と共有を Prisma で行う`

### Task 3: 権限をまとめ、`learningNotes` を差し替える

**Files:**

- Create: `src/application/learning/learning-notes.ts`、`src/domain/learning/learning-note-views.ts`
- Modify: `src/composition/learning-container.ts`、`src/infrastructure/go-api/learning-gateway.ts`（移したメソッドと、そのためだけの型・定数を消す。型は domain から re-export）、`tests/go-api-learning-gateway.test.ts`（移した部分を消す）
- Modify: `src/presentation/controllers/load-or.ts`、`src/presentation/controllers/action-state.ts`（`attemptGoAction`・`attemptGo`）
- Modify: `src/presentation/controllers/follow-controller.ts`、`src/presentation/controllers/note-trash-controller.ts`（今の `getCurrentMemberUser().githubId` を `learningNotes` に任せる）と、それぞれのテスト
- Test: `tests/learning-notes.test.ts`、`tests/load-or.test.ts`（無ければ作る）

**Interfaces:**

- Consumes: Task 1・2 の `createLearningNoteReads`・`createLearningNoteWrites`、`getCachedCurrentUser`。
- Produces（`learningNotes` の、移したメソッドの形。呼び出し側は変えない）：

  ```ts
  export class LearningForbiddenError extends Error {}
  export function createLearningNotes(deps: {
    currentUser: () => Promise<AuthenticatedUser | null>;
    reads: ReturnType<typeof createLearningNoteReads>-shaped interface (declared in application with domain types);
    writes: ReturnType<typeof createLearningNoteWrites>-shaped interface;
  }): {
    listRecent(owner: ViewedOwner, limit: number, search?: EntrySearch): Promise<RecentLearningEntries>;
    listAll(): Promise<LearningEntry[]>;                       // the signed-in owner's own notes
    listLogDates(owner: ViewedOwner): Promise<LogDateSummary[]>;
    listDailyEntries(owner: ViewedOwner, date: LogDate): Promise<DailyLearningEntry[]>;
    getDailyEntry(owner: ViewedOwner, date: LogDate, number: number): Promise<... | null>;
    trash(id: string): Promise<boolean>;
    restore(id: string): Promise<boolean>;
    purge(id: string): Promise<boolean>;
    emptyTrash(): Promise<number>;
    listTrashed(): Promise<TrashedLearningEntries>;
    setShared(id: string, shared: boolean): Promise<boolean>;
  };
  ```

  メソッドの名前と引数は、今の `learningNotes`（Go のゲートウェイ）とそろえる。`learning-container.ts` は、`createLearningNotes(...)` と、Go のゲートウェイの `isInReview`・`setInReview`・`importCsv` を 1 つのオブジェクトにまとめて、今と同じ名前で export する。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/learning-notes.test.ts`：
    - `reads the viewed owner`：会員が self → reads に会員の ownerId が渡る。
    - `only admins read another owner`：会員が `{kind:"other"}` → `LearningForbiddenError`、reads は呼ばれない。管理者なら、その ownerId が渡る。
    - `writes always use the signed-in owner`：管理者が会員として見ているとき → writes には会員の ownerId が渡る。
    - `refuses without a member or admin`：未ログイン・ゲスト・revoked → `LearningForbiddenError`。
    - `only plain members may share`：会員 → 呼ばれる。管理者・会員として見ている管理者・デモの会員 → `LearningForbiddenError`、writes は呼ばれない。
  - `tests/load-or.test.ts`：DB のエラー（ふつうの `Error`）→ fallback を返し、ログはコードとエラーの名前だけ。`redirect()` が投げるエラー → そのまま投げる（`unstable_rethrow` を使う）。`GoApiError` → 今までどおり。
  - `attemptGoAction`・`attemptGo` も同じ形で、ふつうの `Error` → 一般的な文言、`LearningForbiddenError` → 今の 403 と同じ扱い（`actionUnauthorized`・`accountForbiddenMessage`）。名前は今のままにする。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-notes.test.ts tests/load-or.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `LearningForbiddenError` を「権限がない」として扱うために、`action-state.ts` は application のエラーを import してよい（presentation → application の向き）。
  - `follow-controller.ts` の共有は、今の `role === "member"` の確認を残してよい。デモの確認は `learningNotes` が行う。
- [ ] **Step 4: 確かめる。** `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
- [ ] **Step 5: コミット。** `refactor(web): 学習ノートを Go に頼まずに読み書きする`

### Task 4: Go の学習ノートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §5 の「Becomes dead」と「must be kept」に従う）：
  - `services/api/store/trash.go`
  - `services/api/store/entries.go` の `ListEntries`・`CountEntries`・`GetEntry`/`getEntry`・`entryFilterSQL`・`likeEscaper`/`likeContains`・`CreateBatch`・`UpdateEntry`・`TrashEntry`
  - `services/api/store/daily.go` の `ListLogDates`・`ListDailyEntries`・`GetDailyEntry`・`LogDateCount`
  - `services/api/httpapi/trash_handlers.go`、`daily_handlers.go`（`parseLogDate`・`formatLogDate`・`minLogYear`・`maxLogYear` は残す）、`entry_handlers.go` の該当ハンドラ、`validate.go` の使わなくなった検証、`owner.go` の `readOwner` と関連
  - `router.go` の該当ルート・`privateReadUser`・`allowUser`
  - `respond.go` の使わなくなった文言
  - 上のすべてのテスト
- Keep：参照 §5 の「keep」に挙げたもの（タイムライン・復習・学習ログ・LINE・デモのリセット・CSV が使う）。
- Modify：`docs-site/reference/`（消したルートの記述と、ナビ。段階 1 と同じ扱い）
- Modify：`e2e/` にテストを 2 つ足す

- [ ] **Step 1: Go を消す。** `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功（DB を使うテストは、開発用 DB があれば走らせる）。消したルートの名前で `grep` → 残りがない。
- [ ] **Step 2: e2e を足す。**
  - `searching for 100% finds only the literal text`：`100%` を含むノートと含まないノートを用意し、ホームで「100%」を検索する → 前者だけが出る。
  - `the demo account cannot share`：デモで日ごとのノートを開く → 共有ボタンが出ない、または押すと今の「ログインし直してください。」相当になる。今の画面の作りを読んで、合うほうを確かめる。
- [ ] **Step 3: 全体を確かめる。** `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。参照 §4「E2E」の spec（trash・records・learning・follow・home-search・security・note-review・demo・act-as）を含む。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の学習ノート・ゴミ箱・共有・カレンダーを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`README.md`、`.env.example`（変える必要があれば）

- [ ] **Step 1: 直す。**
  - Web が学習ノート（一覧・検索・カレンダー・ゴミ箱・共有）も DB から直接読み書きすることを書く。
  - Go に残っているものの一覧を直す。
  - 「段階2のマージの前と後」を足す。この段階で新しい環境変数は無い。マージのあとは、Web を `vercel promote` で切り替えてから Go を出し直す。戻すときは、Web と Go を一緒に戻す。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: 学習ノートを Web に移したことを書く`
