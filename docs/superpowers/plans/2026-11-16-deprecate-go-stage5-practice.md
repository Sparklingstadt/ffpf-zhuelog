# Go 廃止 段階 5（練習の記録）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 介詞・補語（量詞・了・过・着を含む）の練習の記録（`GET /v1/preposition-records`・`GET/PUT /v1/preposition-records/{id}`、`GET /v1/complement-records`・`GET/PUT /v1/complement-records/{id}`）と、保存したときに間違えた問題を「今日の復習」に入れる処理（`EnqueueReviewItems`）を、Go API から Next.js（Prisma）に移す。Go の該当コードを消す（デモのリセットが使う部分は残す）。

**Architecture:** 段階 1〜4 と同じ形にする。

- 1 回分の記録の確かめ（Go の `validRound` とモード）、保存する形（数え方・JSON）、復習に入れる問題の決め方は、I/O の無い純粋な関数として `src/domain/practice/practice-round.ts` に置く。
- DB の読み書きは `src/infrastructure/prisma/practice-record-store.ts` に置く。復習の列に入れる SQL は、列の持ち主である `src/infrastructure/prisma/review-store.ts` に足し、練習の記録の保存と同じトランザクションで呼ぶ。
- 持ち主の決定は `src/application/practice/practice-records.ts` に置く。
- `src/composition/practice-container.ts` の `prepositionRecords`・`complementRecords` を新しい実装にする。名前とメソッド（`list`・`get`・`save`）は変えないので、ページは変えない。
- 保存の Server Action の判定は、段階 4 の `review-answer-controller.ts` と同じく controller に出して試す。
- 画面・Server Action の名前と見た目は変えない。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7（`$executeRaw`・対話型トランザクション）、zod、`node:test` + `tsx`、Playwright。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 5、決めたこと 7〜9）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage5-go-reference.md`（以下「参照」）。検証の順番と上限、文言、保存の SQL、復習に入れる SQL、Go に残すべきコードが、file:line 付きで書いてある。

## 設計者の判断（コントローラーが確かめること）

1. **復習の列に入れる処理は、1 つの文（`INSERT … ON CONFLICT … DO UPDATE … WHERE`）で書く。読んでから書く形にはしない。** 段階 4 の最終レビューからの持ち越し。答える処理（`review-store.ts` の `answer`）は項目を `FOR UPDATE` で取ってから FSRS の列をすべて書き直す。1 つの文の `ON CONFLICT DO UPDATE` は、その行のロックを待ち、答えが commit されたあとの行で `WHERE "ReviewItem"."due" > EXCLUDED."due"` を確かめ直すので、どちらの書き込みも消えない（参照 §4）。Prisma の `upsert` は `WHERE` を付けられないので、`$executeRaw` で書き、そのわけをコメントに書く。
2. **1 回分の対象は、1 つの文にまとめて入れる。** Go は対象ごとに 1 文だった。Web は、対象を重ならないようにし（同じ文の `ON CONFLICT DO UPDATE` は同じ行を 2 度さわれないため）、`(kind, targetId)` の順に並べてから、複数行の `VALUES` で 1 文にする。並べるのは、同じ対象を持つ 2 つの保存が、逆の順に行をロックして待ち合わないようにするため。結果（新しく入る・前倒しになる・そのまま）は Go と同じ。
3. **記録の保存と復習に入れる処理を、1 つのトランザクションにする。** Go は記録を保存してから、別のトランザクションで列に入れていた（列に入れられないと記録だけ残って 500、送り直すと列に入る）。Web は両方が入るか、どちらも入らないかにする。送り直したときの結果は Go と同じ（同じ id なら、最初に保存した記録の間違いを入れ直す）。分離レベルは既定の READ COMMITTED にする（REPEATABLE READ だと、答えと同時に動いたときに `ON CONFLICT DO UPDATE` が直列化の失敗になる）。
4. **記録の行は Prisma のクエリで書く。** `createMany({ skipDuplicates: true })`（= `ON CONFLICT DO NOTHING`）のあとに、`findUnique({ where: { id_ownerId } })` で保存された行を読む。行が無ければ、その id はほかの人のもの（`"taken"`）で、何も変えず、列にも入れない。Go の「何もしない UPDATE で既存の行を返す」SQL は写さない。
5. **保存の結果は、例外ではなく `"saved" | "invalid" | "taken"` で返す。** 段階 4 の「見つからないは `false`」と同じ考え方。画面の文言は今のまま：
   - 形の不正（zod の形、または `"invalid"`）→ 「練習の記録の形式が不正です。」
   - `"taken"`（ほかの人の id。ブラウザの `crypto.randomUUID()` ではまず起きない）→ 今と同じく一般的な文言（Go の 404 は `goFailureMessage` で一般的な文言になっていた）。ログは `console.error(code, "taken")`。
6. **確かめは Go と同じにし、場所を domain に移す。** 文字数は Go の rune と同じくコードポイントで数える（`[...s].length`。`s.length` ではない）。Server Action の zod は形だけを見る（今と同じ）。ただし `id` は `z.uuid()` をやめ、Go と同じ小文字の UUID の正規表現にする（段階 4 の logId と同じ判断）。知らないキーは zod が捨てるので保存されない（Go の「知らないキーは 400」は写さない。呼ぶのは自分の画面だけのため）。
7. **権限のエラーは `PracticeForbiddenError` を新しく作り、`action-state.ts` の `isForbidden` に足す。** 段階 4 の `ReviewForbiddenError` と同じ形。
8. **保存する JSON の形は Go と同じにする。** 問題ごとに `answer`・`noun`・`prompt`・`misses`（無ければ `[]`）、`id` は空でないときだけ。切り替えのあいだ、古い Go と新しい Web がたがいの行を読めるようにするため。
9. **Go のテストのうち、消えるルートを通っていた `act_as_test.go` と `demo_test.go` は、残るルート（`PUT /v1/questions/{id}`・`GET /v1/questions`）で書き直す。** 確かめることは同じ（act-as の持ち主とログ、デモは自分の記録を読める）。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Server Action）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は何も import しない（同じ domain の型と関数を除く）。
- 持ち主（参照 §0）：
  - 常に今の利用者の `githubId`（管理者が「メンバーとして見る」ときは、その会員の ownerId）。フォームの値は使わない。
  - 未ログイン・ゲスト・revoked・`githubId` なし → `PracticeForbiddenError`。
  - デモのアカウントも、一覧・1 件・保存のすべてができる（Go と同じ。`notForDemo` ではない）。
- 確かめ（参照 §2。すべてを満たさなければ `"invalid"`）：
  - `id`：`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`（`PRACTICE_RECORD_ID`）
  - `startedAt`：有効な `Date`（範囲は見ない）
  - `elapsedMs`：整数で `0`〜`86_400_000`
  - 問題の数：`1`〜`50`
  - 問題ごと：`id` は `40` 文字以下（空か無しはよい）。`answer` は 1 文字以上で、介詞 `10`・補語 `40` 文字以下。`noun` は 1〜`40` 文字。`prompt` は 1〜`100` 文字。`misses` は `3` 個以下。
  - 間違いごと：1 文字以上で、`answer` と同じ上限以下。`answer` と同じではない。重ならない。
  - 補語：`mode` が `COMPLEMENT_ROUND_MODES`（10 個）のどれか。介詞：`mode` は無い。
  - 文字数はコードポイント。空白を削らない（`" "` は 1 文字）。
- 保存（参照 §3）：
  - 数は問題から数える（`scoreRound`）。`createdAt` は `now`（1 回の処理で 1 度だけ取る）。
  - 同じ id がすでに自分のものなら、何も変えず保存されている記録を使う（最初の保存が勝つ。モードも問題も `createdAt` も）。
  - ほかの人の id なら、何も変えずに `"taken"`。
  - トランザクションの時間：`{ maxWait: 5_000, timeout: 15_000 }`（`TRANSACTION_OPTIONS`、`learning-note-writes.ts`）。分離レベルは指定しない（READ COMMITTED）。
- 復習に入れる（参照 §4）：
  - 保存された記録（送られた記録ではない）の問題のうち、`id` があり、間違いが 1 つ以上あるもの。
  - 介詞 → `kind "preposition"`、`targetId` は `"<id>:<noun>"`。補語（10 モードすべて）→ `kind "complement"`、`targetId` は `id`。`language` は `"zh"`。
  - 1 つの文：
    ```sql
    INSERT INTO "ReviewItem" ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")
    VALUES (…), (…)
    ON CONFLICT ("ownerId", "language", "kind", "targetId") DO UPDATE
    SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "ReviewItem"."due" > EXCLUDED."due"
    ```
    `due = createdAt = updatedAt = now`、`state 0`、`id` は `newId()`。ほかの列は既定値。
  - 新しい対象 → New のカード。今より後が期日の対象 → `due` と `updatedAt` だけを今にする（FSRS の列は残す）。もう期日が来ている対象 → 何もしない（`updatedAt` も）。
- 読む（参照 §3）：
  - 一覧は `100` 件、`createdAt` の新しい順、同じなら `id` の大きい順。問題は読まない。
  - 1 件は `id` と持ち主で読む。`id` が `PRACTICE_RECORD_ID` に合わなければ、DB を読まずに `null`。
  - 保存されている問題の JSON は、`id` が空でない文字列のときだけ `id` を付け、`misses` が配列でなければ `[]` にする。
- 文言（今のまま）：
  - 形の不正 → `練習の記録の形式が不正です。`
  - 権限 → `accountForbiddenMessage`
  - `"taken"`・そのほかの失敗 → `genericErrorMessage`。ログはコードとエラーの名前（`"taken"`）だけ。
  - 画面の側（`use-practice-round.ts`）の文言は変えない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（DB のテストは Docker があれば）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **前倒しは 1 つの文で、FSRS の列を残す。** 今より後が期日のカードは今になり、`reps`・`stability`・`state` は残る。もう期日のカードはさわらない。→ Task 2 のテスト `enqueueReviewItemsSql brings a card forward in one statement`、Task 4 の e2e `a retried save keeps one round and brings a card due later forward`。
2. **確かめが Go と同じか。** Go の 2 つのハンドラのテストの表（不正な 1 回分すべて、3 つの間違いと 0 ms は通る）と、上限ちょうど・1 つ超え、4 バイトの文字。→ Task 1 のテスト `a round is checked as Go checked it`。
3. **送り直しと、ほかの人の id。** 同じ id は 1 行のまま（最初の保存が勝つ）。ほかの人の id は上書きせず、列にも入れず、一般的な文言。ほかの人の記録のページは 404。→ Task 4 の e2e `a round id already saved by someone else is not overwritten`、Task 3 のテスト `an id taken by someone else shows the generic message`。
4. **だれの記録か。** 管理者が「メンバーとして見る」ときは会員の記録と列。デモは保存できる。ゲストは記録を持たない。→ Task 3 のテスト `practice records follow the signed-in owner`、Task 4 の e2e `an admin acting as a member saves a practice round as the member's` と `the demo account saves a practice round`、既存の `e2e/prepositions.spec.ts:85`。
5. **どの間違いが復習に入るか。** `id` があって間違えた問題だけ。介詞は `<id>:<noun>`、補語は `id`。重なりは 1 つ。→ Task 1 のテスト `missed questions with an id become review targets`、既存の `e2e/review.spec.ts:42`・`:126`、`e2e/aspect-particles.spec.ts:38`。

---

### Task 1: 1 回分の確かめ・保存する形・復習に入れる問題（純粋な関数）

**Files:**

- Create: `src/domain/practice/practice-round.ts`
- Modify: `src/domain/practice/practice-record.ts`（先頭と `scoreRound` の Go を指すコメントだけ）
- Test: `tests/practice-round.test.ts`

**Interfaces:**

- Consumes: `ChoiceAnswer`・`RoundScore`・`scoreRound`（`practice-record.ts`）、`COMPLEMENT_ROUND_MODES`・`ComplementRoundMode`（`complement-record.ts`）。
- Produces:

  ```ts
  export type PracticeKind = "preposition" | "complement";
  export const PRACTICE_RECORD_LIST_LIMIT = 100;
  // A lower-case UUID, as the browser's crypto.randomUUID() makes them.
  export const PRACTICE_RECORD_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  export const PRACTICE_ROUND_LIMITS = {
    questions: 50,
    misses: 3,
    id: 40,
    noun: 40,
    prompt: 100,
    elapsedMs: 86_400_000,
    answer: { preposition: 10, complement: 40 },
  } as const;

  export type PracticeRound = {
    id: string;
    startedAt: Date;
    elapsedMs: number;
    questions: readonly ChoiceAnswer[];
  };
  export type ComplementRound = PracticeRound & { mode: ComplementRoundMode };

  // A round as it is saved: questions copied (an empty id dropped, misses
  // copied) and counted.
  export type CheckedRound = {
    id: string;
    startedAt: Date;
    elapsedMs: number;
    questions: ChoiceAnswer[];
  } & RoundScore;

  // null when Go would have refused the round (400 or 404).
  export function checkPracticeRound(
    kind: "preposition",
    round: PracticeRound & { mode?: unknown },
  ): CheckedRound | null;
  export function checkPracticeRound(
    kind: "complement",
    round: PracticeRound & { mode: unknown },
  ): (CheckedRound & { mode: ComplementRoundMode }) | null;

  export type PracticeReviewTarget = {
    language: "zh";
    kind: PracticeKind;
    targetId: string;
  };
  // The missed questions that name their question, once each, sorted by
  // targetId (see 設計者の判断 2).
  export function practiceReviewTargets(
    kind: PracticeKind,
    questions: readonly ChoiceAnswer[],
  ): PracticeReviewTarget[];

  // The questions of a saved row's JSON.
  export function choiceAnswersFrom(json: unknown): ChoiceAnswer[];
  ```

- [ ] **Step 1: 失敗するテストを書く。** `tests/practice-round.test.ts`：
  - `a round is checked as Go checked it`：Go の `TestPrepositionRecordPutRejectsInvalidRounds` と `TestComplementRecordPutRejectsInvalidRounds` の表をすべて写す（どれも `null`）。
    - 問題なし、51 問、`elapsedMs` が `-1`・`86_400_001`・`1.5`、答えが空、答えと同じ間違い、重なる間違い、4 つの間違い、空の間違い、101 文字の `prompt`、41 文字の `id`、有効でない `startedAt`（`new Date("yesterday")`）。
    - 補語：`mode` が `"unknown"`・無い。介詞：`mode` がある。
    - `id` が `not-a-uuid`・大文字の UUID。
    - 通るもの：3 つの間違いと `elapsedMs 0`、40 文字の `id`、介詞の 10 文字の答え（11 は `null`）、補語の 40 文字の答え（41 は `null`）、40 文字の `noun`（41 は `null`）、`"𠮷"` を 100 個並べた `prompt`（コードポイントで 100。`s.length` だと 200 になり落ちる）。
  - `every complement mode is accepted`：Go の `TestComplementRecordPutAcceptsEveryMode` の 10 個。
  - `the saved round counts from its questions`：Go の `TestAddComplementRecordCountsFromTheQuestions`。間違いが `[]`・`["把","被"]`・`[]`・`["对"]` → `questionCount 4`・`firstTryCount 2`・`missCount 3`。渡した問題の配列は変わらない。
  - `a question without an id is saved without one`：`id: ""` と `id` 無しの問題は、どちらも `id` のキーを持たない。`id: "q-1"` は残る（Go の `…KeepsTheQuestionID`）。
  - `missed questions with an id become review targets`：Go の `TestSavingARoundQueuesItsMissedQuestions` を写す。
    - 介詞 `P001`（学校、間違いあり）・`P002`（間違いなし）・`id` なし（間違いあり）→ `[{zh, preposition, "P001:学校"}]`。
    - 補語 `result-01`（間違いあり）→ `[{zh, complement, "result-01"}]`。`measure-07`・`aspect-12`・`verb:C005:看` も `complement`。
    - 同じ対象が 2 つ → 1 つ。順番は `targetId` の順。
  - `choiceAnswersFrom reads rows saved before questions had ids`：Go の `…ReadsAQuestionWithoutAnID`。`[{"answer":"在","noun":"学校","prompt":"（　）学校学习","misses":["把"]}]` → `id` のキーなし。`misses` が無い・`null` → `[]`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/practice-round.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 文字数は `const length = (s: string) => [...s].length;` の 1 か所にまとめ、コードポイントで数えるわけ（Go の rune と同じ）をコメントに書く。
  - `checkPracticeRound` は参照 §2 の順に見る。数は `scoreRound` を使う。
  - 各関数の上に、Go のどこにあたるかを英語のコメントで 1 行書く（`// Go's validRound (httpapi/practice_handlers.go)`）。
  - `practice-record.ts` の「as the Go API keeps it」「as Go counts them」のコメントを、Web が保存する説明に直す。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 練習の記録の確かめと復習に入れる問題を決める`

### Task 2: 練習の記録の読み書きと、復習の列に入れる文（Prisma）

**Files:**

- Create: `src/infrastructure/prisma/practice-record-store.ts`
- Modify: `src/infrastructure/prisma/review-store.ts`（`enqueueReviewItemsSql`・`enqueueReviewItems` を足す）
- Test: `tests/practice-record-store.test.ts`（新規）、`tests/review-store.test.ts`（足す）。純粋な部分だけ。DB の動きは Task 4 の e2e。

**Interfaces:**

- Consumes: Task 1 の `CheckedRound`・`PracticeReviewTarget`・`practiceReviewTargets`・`choiceAnswersFrom`、`newId`、`prisma()`、`TRANSACTION_OPTIONS`。
- Produces:

  ```ts
  // review-store.ts
  // The one INSERT … ON CONFLICT … DO UPDATE … WHERE that puts the targets in
  // the owner's queue at now (see 設計者の判断 1, 2). null when there are none.
  export function enqueueReviewItemsSql(
    ownerId: string,
    targets: readonly PracticeReviewTarget[],
    now: Date,
    newItemId?: () => string, // default newId
  ): Prisma.Sql | null;
  export function enqueueReviewItems(
    tx: Prisma.TransactionClient,
    ownerId: string,
    targets: readonly PracticeReviewTarget[],
    now: Date,
  ): Promise<number>;

  // practice-record-store.ts
  // Pure: the row a checked round is saved as.
  export function practiceRecordRow(
    ownerId: string,
    round: CheckedRound,
    now: Date,
  ): {
    id: string;
    ownerId: string;
    questionCount: number;
    firstTryCount: number;
    missCount: number;
    elapsedMs: number;
    questions: ChoiceAnswer[];
    startedAt: Date;
    createdAt: Date;
  };
  export function createPracticeRecordStore(db: () => PrismaClient): {
    listPrepositions(
      ownerId: string,
      limit: number,
    ): Promise<PracticeRecordSummary[]>;
    listComplements(
      ownerId: string,
      limit: number,
    ): Promise<ComplementRecordSummary[]>;
    getPreposition(ownerId: string, id: string): Promise<PracticeRecord | null>;
    getComplement(
      ownerId: string,
      id: string,
    ): Promise<ComplementRecord | null>;
    // Saves the round unless the id is taken, then queues the saved round's
    // misses, in one transaction. null: the id is another owner's (nothing
    // changed, nothing queued).
    savePreposition(
      ownerId: string,
      round: CheckedRound,
      now: Date,
    ): Promise<PracticeRecord | null>;
    saveComplement(
      ownerId: string,
      round: CheckedRound & { mode: ComplementRoundMode },
      now: Date,
    ): Promise<ComplementRecord | null>;
  };
  export type PracticeRecordStore = ReturnType<
    typeof createPracticeRecordStore
  >;
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/review-store.test.ts`：`enqueueReviewItemsSql brings a card forward in one statement`
    - 2 つの対象で、空白を 1 つにまとめた `.sql` が次を含む。
      - `INSERT INTO "ReviewItem" ("id", "ownerId", "language", "kind", "targetId", "due", "state", "createdAt", "updatedAt")`
      - `ON CONFLICT ("ownerId", "language", "kind", "targetId") DO UPDATE SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt" WHERE "ReviewItem"."due" > EXCLUDED."due"`
    - `INSERT` は 1 回だけ。`SELECT` と `FOR UPDATE` を含まない。
    - `.values` は、対象ごとに `[id, ownerId, "zh", kind, targetId, now, 0, now, now]`（`newItemId` を差し替えて固定する）。
    - 対象が無ければ `null`。
  - `tests/practice-record-store.test.ts`：`practiceRecordRow keeps Go's counts and question JSON`
    - 数は `round` のもの。`createdAt` は `now`、`startedAt` は `round.startedAt`。
    - `questions` を `JSON.stringify` すると、`id` の無い問題に `"id"` が出ない（Go の `strings.Count(raw, "\"id\"") == 1` と同じ確かめ）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/review-store.test.ts tests/practice-record-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `enqueueReviewItemsSql`：`Prisma.join` で `VALUES` を作る。`ON CONFLICT` の `WHERE` を Prisma の `upsert` では書けないこと、答えの `FOR UPDATE` と同時に動いても 1 つの文なら消えないことを、コメントに書く（設計者の判断 1）。対象の重なりと順番は Task 1 の `practiceReviewTargets` が決める（ここでもう一度並べない）。
  - `enqueueReviewItems`：`sql` が `null` なら `0`。そうでなければ `tx.$executeRaw(sql)`。
  - 一覧：`findMany({ where: { ownerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: <questions 以外> })`。
  - 1 件：`findUnique({ where: { id_ownerId: { id, ownerId } } })`。`questions` は `choiceAnswersFrom`。
  - 保存：`db().$transaction(async (tx) => …, TRANSACTION_OPTIONS)` の中で次の順に行う。
    1. `createMany({ data: [practiceRecordRow(…)（補語は mode も）], skipDuplicates: true })`
    2. `findUnique({ where: { id_ownerId } })`。無ければ `null` を返す（ほかの人の id）。
    3. `enqueueReviewItems(tx, ownerId, practiceReviewTargets(kind, 保存された行の問題), now)`
    4. 保存された行を記録にして返す。
  - 介詞と補語の違い（表と `mode`）は、小さな関数 2 つか、表ごとの設定で書く。読みやすい方でよい。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 練習の記録を Prisma で読み書きし、間違いを復習に入れる`

### Task 3: application・container・呼ぶ側を差し替える

**Files:**

- Create: `src/application/practice/practice-records.ts`
- Create: `src/presentation/controllers/practice-round-controller.ts`（zod の形と判定を action から移す）
- Modify: `src/composition/practice-container.ts`、`src/presentation/actions/practice-record-actions.ts`（controller を呼ぶだけにする）、`src/presentation/actions/practice-round-input.ts`（コメント）、`src/presentation/controllers/action-state.ts`（`isForbidden` に `PracticeForbiddenError`、コメント）
- Modify: Go を指すコメント（`src/app/practice/page.tsx:96-97` ほか、`grep -rn "Go" src/app/practice src/presentation/components/practice src/presentation/guards/practice-guard.ts` で出るもの）。`…/records/[id]/page.tsx` の 2 つのページは、手元の `UUID` を `PRACTICE_RECORD_ID` に替える。
- Delete: `src/infrastructure/go-api/preposition-record-gateway.ts`、`src/infrastructure/go-api/complement-record-gateway.ts`、`tests/go-api-preposition-record-gateway.test.ts`、`tests/go-api-complement-record-gateway.test.ts`
- Test: `tests/practice-records.test.ts`（新規）、`tests/practice-round-controller.test.ts`（新規）

**Interfaces:**

- Consumes: Task 1 の `checkPracticeRound`・`PRACTICE_RECORD_ID`・`PRACTICE_RECORD_LIST_LIMIT`・`PracticeRound`・`ComplementRound`、Task 2 の `createPracticeRecordStore`・`PracticeRecordStore`。
- Produces:

  ```ts
  // practice-records.ts
  export class PracticeForbiddenError extends Error {
    override name = "PracticeForbiddenError";
  }
  export type SaveRoundResult = "saved" | "invalid" | "taken";
  export type PracticeRecordsDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: PracticeRecordStore; // the methods only (a Pick or a structural type)
    now: () => Date;
  };
  export function createPracticeRecords(deps: PracticeRecordsDeps): {
    prepositions: {
      list(): Promise<PracticeRecordSummary[]>;
      get(id: string): Promise<PracticeRecord | null>;
      save(round: PracticeRound): Promise<SaveRoundResult>;
    };
    complements: {
      list(): Promise<ComplementRecordSummary[]>;
      get(id: string): Promise<ComplementRecord | null>;
      save(round: ComplementRound): Promise<SaveRoundResult>;
    };
  };

  // practice-round-controller.ts
  export const prepositionRoundInput: z.ZodType<…>; // id: regex PRACTICE_RECORD_ID, startedAt: z.iso.datetime(), elapsedMs: z.number().int(), questions: z.array(practiceAnswerInput)
  export const complementRoundInput: z.ZodType<…>; // + mode: z.enum(COMPLEMENT_ROUND_MODES)
  export async function handlePracticeRoundSave<T extends { startedAt: string }>(
    input: unknown,
    dependencies: {
      schema: z.ZodType<T>;
      code: string; // "PREPOSITION_RECORD_SAVE_FAILED" | "COMPLEMENT_RECORD_SAVE_FAILED"
      getViewer: () => Promise<{ role: AppRole } | null>;
      save: (round: Omit<T, "startedAt"> & { startedAt: Date }) => Promise<SaveRoundResult>;
    },
  ): Promise<ActionResult>;
  ```

  どのメソッドも、はじめに持ち主を決める（権限が無ければ、確かめより先に `PracticeForbiddenError`。Go の 403 が 400 より先なのと同じ）。`save` は次の順に行う。
  1. 持ち主を決める。
  2. `checkPracticeRound`。`null` なら `"invalid"`（store を呼ばない）。
  3. `now` を 1 回取り、store の `save…` を呼ぶ。`null` なら `"taken"`、そうでなければ `"saved"`。

  `get` は `id` が `PRACTICE_RECORD_ID` に合わなければ、store を呼ばずに `null`。`list` は `PRACTICE_RECORD_LIST_LIMIT` で呼ぶ。

  `handlePracticeRoundSave` は次の順に行う。
  1. viewer が admin・member でない → `accountForbiddenMessage`。
  2. zod の形が合わない → `練習の記録の形式が不正です。`
  3. `attemptGo(code, () => save(…))`。失敗はそのまま返す（`PracticeForbiddenError` → `accountForbiddenMessage`、ほか → 一般的な文言）。
  4. `"invalid"` → `練習の記録の形式が不正です。`、`"taken"` → `console.error(code, "taken")` と `genericErrorMessage`、`"saved"` → `{ ok: true }`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/practice-records.test.ts`（`tests/review-queue.test.ts` の利用者の作り方にならう）：
    - `practice records follow the signed-in owner`：
      - 会員 → その ownerId。会員として見ている管理者 → 会員の ownerId。デモ → 自分の ownerId（`save` も store まで届く）。
      - 未ログイン・ゲスト・revoked・`githubId` なし → どのメソッドも `PracticeForbiddenError`。store は呼ばれない。不正な 1 回分を渡しても `"invalid"` ではなく `PracticeForbiddenError`。
    - `list reads the newest 100 rounds`：store の `listPrepositions`・`listComplements` が `100` で呼ばれる。
    - `get of an id of the wrong shape is null without asking the store`：`not-a-uuid`・大文字の UUID。
    - `save checks the round before the store and passes one now`：
      - 不正な 1 回分 → `"invalid"`、store は呼ばれない。
      - store が `null` → `"taken"`。記録 → `"saved"`。
      - store に渡る `now` が `deps.now()` の値で、`CheckedRound` の数が問題から数えたもの。
      - 補語は `mode` も渡る。
  - `tests/practice-round-controller.test.ts`：
    - 権限なし（`null`・guest）→ `accountForbiddenMessage`。`save` は呼ばれない。
    - `id` が大文字の UUID・`questions` が配列でない → `練習の記録の形式が不正です。`
    - `"invalid"` → `練習の記録の形式が不正です。`
    - `an id taken by someone else shows the generic message`：`"taken"` → `genericErrorMessage`。`console.error` には `code` と `"taken"` だけ。
    - `save` が `PracticeForbiddenError` を投げる → `accountForbiddenMessage`。ふつうの `Error` → `genericErrorMessage`（ログはコードとエラーの名前だけ）。
    - `"saved"` → `{ ok: true }`。`save` に渡る `startedAt` が `Date`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/practice-records.test.ts tests/practice-round-controller.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `practice-container.ts`：
    ```ts
    const practiceRecords = createPracticeRecords({
      currentUser: getCachedCurrentUser,
      store: createPracticeRecordStore(prisma),
      now: () => new Date(),
    });
    export const prepositionRecords = practiceRecords.prepositions;
    export const complementRecords = practiceRecords.complements;
    ```
  - `practice-record-actions.ts`：`savePrepositionRoundAction`・`saveComplementRoundAction` の名前と引数の型は変えず、`handlePracticeRoundSave(input, { schema, code, getViewer: getCurrentViewerUser, save: (round) => prepositionRecords.save(round) })` を返すだけにする。revalidate しない（今のまま）。
  - ページは、`loadOr` のコード（`PRACTICE_RECORDS_UNAVAILABLE`）と見え方を変えない。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
  - `grep -rn "preposition-records\|complement-records\|record-gateway" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): 練習の記録を Go に頼まずに行う`

### Task 4: Go の練習の記録のルートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §7 の「Becomes dead」と §6 の「keep」に従う）：
  - 消す：`httpapi/practice_handlers.go`、`httpapi/practice_reviews.go`、`httpapi/preposition_handlers_test.go`、`httpapi/complement_handlers_test.go`、`httpapi/practice_reviews_test.go`、`store/review_items.go`、`store/review_items_test.go`、`store/preposition_records_test.go`、`store/complement_records_test.go`。
  - `router.go`：`Deps.PrepositionRecords`・`ComplementRecords`・`Reviews` と、`practiceRecordRoutes` とその呼び出しを消す。`main.go:169-171` を消す。
  - `respond.go`：`msgPracticeRecordInvalid`・`msgPracticeRecordNotFound` を消す。`validUUID` のコメントから「practice rounds」を外す。
  - `store/practice_records.go`：デモのリセットが使うもの（`PracticeQuestion`・`PracticeRecordSummary`・4 つの別名・`PrepositionRecord`・`ComplementRecord`・`practiceKind`・`prepositionPractice`・`complementPractice`・`insert`）だけを残す。ファイルの先頭に「the demo reset seeds rounds with these; the web reads and saves them」と書く。`practiceKind.name` が使われなくなれば消す。
  - `review/golden_test.go:129` のコメントの `EnqueueReviewItems` を「a practice miss (the web's enqueue)」にする。
- テスト用の関数（`store/testhelpers_test.go` に移す・足す）：
  - `reviewOwner`（`review_items_test.go:12-19` から移す。`line_review_notify_test.go:124`・`vocabulary_test.go:15` が使う）。
  - `prepositionRecord`・`complementRecord`（消える `*_records_test.go` から移す）と、`saveRound(t, s, k practiceKind, owner string, r PracticeRecordSummary, qs []PracticeQuestion, createdAt time.Time)`：`demoScore` で数え、`k.insert` で入れる。
- テストの書き直し：
  - `store/study_log_test.go:30,33`：`AddPrepositionRecord`・`AddComplementRecord` を `saveRound` にする。期待する数は変えない。
  - `store/demo_test.go:131-138`：`ListPrepositionRecords`・`ListComplementRecords` を、生の SQL（`"questionCount"`・`"firstTryCount"`・`"missCount"`、補語は `"mode"`）で読む形にする。確かめることは同じ。
  - `httpapi/act_as_test.go:33-55`：`TestActAsWritesGoToTheMember` を `PUT /v1/questions/{testConversationID}`（本文 `{"question":"了と过？","answer":"違いです"}`、`Questions: &fakeQuestions{}`、`ChatModel` は既定）で書き直す。`fakeQuestions` の持ち主が `actedMember` で、「acting as member」のログがあることを確かめる。
  - `httpapi/demo_test.go:101-113`：`TestDemoKeepsItsOwnRecords` を `GET /v1/questions` と `fakeQuestions` の持ち主で書き直す。`allRoutesDeps`（:40-50）から 3 つの欄を消す。
  - `httpapi/router_test.go:26-27,61-62,134-135`：3 つの欄を消す。
- Modify（docs-site。段階 1〜4 と同じ扱い）：
  - `docs-site/reference/practice.md` を消し、`docs-site/.vuepress/config.ts:35` のナビから外す。
  - `docs-site/reference/README.md:35-40` の 6 行を消す。
  - `docs-site/reference/study-log.md:33` の `practice.md` へのリンクを、ふつうの文（Web の練習の記録）にする。
  - `docs-site/README.md:27` の「Web が Prisma で直接扱うため」の列に「練習の記録（介詞・補語）」を足し、`:41` の `store/` の説明から「練習の間違いを復習の列に入れる処理」を外す。
- Modify：`e2e/fixtures.ts`、`e2e/review.spec.ts`、`e2e/prepositions.spec.ts`、`e2e/act-as.spec.ts`、`e2e/demo.spec.ts`（下の Step 2）

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功。テスト用の関数を移したので、`store` と `demo` の DB のテストは、開発用 DB（Docker）で必ず走らせる。
  - `grep -rn "preposition-records\|complement-records\|EnqueueReviewItems\|ReviewTarget\|AddPrepositionRecord\|AddComplementRecord\|ListPrepositionRecords\|ListComplementRecords\|msgPracticeRecord" services/api` → 何も出ない。
- [ ] **Step 2: e2e を足す（今の e2e に無いものだけ）。**
  - `e2e/fixtures.ts`：`e2e/review.spec.ts` の `pickUntilRight` と `practiceOneRound` を `pickUntilRight`・`practicePrepositionRound(page)` として移し、`review.spec.ts` はそれを import する（動きは変えない。「記録に保存しました。」まで待つ）。
  - 保存の Server Action の捕まえ方（下の 3 本で使う）：`/practice/prepositions` の前に `page.on("request")` で、`method() === "POST"`、`pathname === "/practice/prepositions"`、`headers()["next-action"]` があるものを取っておく（`e2e/note-review.spec.ts:176-184` と同じ）。
  - `e2e/prepositions.spec.ts`：`a retried save keeps one round and brings a card due later forward`
    - 会員で 1 回解き、保存の POST を捕まえる。間違えた項目（`ReviewItem`）が 2 つ未満なら `test.skip`（今の `review.spec.ts:69` と同じ扱い。順に選ぶので、まず起きない）。
    - SQL で、項目 A を「答えて先に送ったカード」にする：`due = now() + interval '10 days'`、`state 2`、`reps 3`、`stability 7.5`、`difficulty 5`、`"lastReview" = now() - interval '1 day'`。項目 B は変えず、その `due` と `"updatedAt"` を覚える。記録の `"createdAt"` も覚える。
    - `const before = (await db.query("SELECT now() AS t")).rows[0].t;` のあとに、`page.request.fetch(captured)` で同じ本文（同じ id）をもう一度送る → 200、本文に `{"ok":true}`。
    - DB で次を確かめる。
      - `PrepositionPracticeRecord` は 1 行で、`"createdAt"` は変わらない。
      - `ReviewItem` の数は変わらない。
      - A：同じ id で、`due` は `before` 以上・`now()` 以下。`state 2`・`reps 3`・`stability 7.5`・`difficulty 5`・`lastReview` は残る。
      - B：`due` と `"updatedAt"` が変わらない。
  - `e2e/prepositions.spec.ts`：`a round id already saved by someone else is not overwritten`
    - 会員 A で 1 回解き、保存の POST を捕まえる。
    - 別の context で会員 B としてログインし、B の `page.request.post(captured.url(), { headers: { "next-action": …, "content-type": …, accept: … }（captured.headers() から写す）, data: captured.postData() })` で同じ本文を送る（Cookie は B のもの）。
    - 確かめること：
      - 応答の本文に `処理できませんでした。時間をおいてもう一度お試しください。` がある。
      - `PrepositionPracticeRecord` は 1 行で、`ownerId` は A。B の `ReviewItem` は 0 件。
      - B が `/practice/prepositions/records/<その id>` を開くと 404。
  - `e2e/act-as.spec.ts`：`an admin acting as a member saves a practice round as the member's`
    - 会員を作り、管理者が「この会員として操作」してから `practicePrepositionRound(page)`。
    - DB：`PrepositionPracticeRecord` の `ownerId` が会員で 1 行。`adminOwnerId` の記録と `ReviewItem` は 0 件。会員の `ReviewItem` は、記録の間違えた問題（`id` あり）の数と同じ。
  - `e2e/demo.spec.ts`：`the demo account saves a practice round`
    - `resetDemo()` のあと、デモの持ち主の `PrepositionPracticeRecord` の数を数える。
    - 「デモで試す」で入り、`practicePrepositionRound(page)`。
    - 数が 1 増える。
  - 1 回 25 問を解くテストは `test.setTimeout(90_000)` にする（`aspect-particles.spec.ts:42` と同じ）。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。
  - 参照 §5「E2E」の spec（prepositions・complements・aspect-particles・review・study-log・hsk-levels・practice-fit・act-as・demo・note-review）を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の練習の記録のルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`README.md`（変える必要があれば）

- [ ] **Step 1: 直す。**
  - 「Web が練習の記録を DB に直接読み書きし、間違えた問題も Web が復習の列に入れる」ことを書く。Go に残っているものの一覧から、練習の記録と「練習の間違いを列に入れる処理」を外す。
  - `docs/features.md:110,148`：「Go API の `/v1/preposition-records` へ保存」「Go API 経由で保存」「API の仕様は練習の記録を参照」を、Web が保存する説明にする（消した `practice.md` へのリンクを残さない）。
  - `docs/architecture.md`：
    - 「5. 復習」の「練習の間違いの登録が使うのは、新しいカードの状態の定数だけです」を消す（Go の `review` パッケージを使うのはデモのリセットだけになる）。
    - 「6. 練習」の「記録」に、保存と復習に入れる処理が 1 つのトランザクションであること、期日を前倒しする文が 1 つの文（`ON CONFLICT … WHERE "due" > EXCLUDED."due"`）であることと、そのわけ（答えの `FOR UPDATE` と同時でも消えない）を 2〜3 行で足す。
  - `docs/api-deployment.md` の「段階4（復習）のマージの前と後」のあとに、「段階5（練習の記録）のマージの前と後」を足す。段階 4 の文中の「練習の間違いを列に入れる処理（段階5）」は、Go に残るものから外す。
    - マージの前：新しい環境変数も、マイグレーションもない。
    - マージのあと：
      1. Web の Production のデプロイが Ready になったことを確かめる。
      2. `vercel promote` で切り替える。
      3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/preposition-records*` と `/v1/complement-records*` が本番の Go から消える。
    - 切り替えのあいだ：古い Go と新しい Web が同じ表に記録を書き、同じ列に間違いを入れても問題ない。行の形（問題の JSON）と、列に入れる文（`ON CONFLICT … WHERE "due" > EXCLUDED."due"`）が同じだから。
    - 戻すとき：
      - Go だけを戻しても害はない。
      - Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/*-records` を呼んで 404 になる。
        - 練習を終えると「処理できませんでした。時間をおいてもう一度お試しください。」になり、記録も復習も残らない。
        - `/practice` のカードから前回の記録が消える。
        - 記録の一覧のページはエラーの表示、1 件のページは 404 になる。
      - Web を戻すなら Go も戻す。いっしょに戻すのがいちばん安全。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。`grep -rn "preposition-records\|complement-records" docs README.md docs-site --include='*.md'`（`docs/releases/` と `docs/superpowers/` を除く）で、残っているのが歴史の記録だけであることを確かめる。
- [ ] **Step 3: コミット。** `docs: 練習の記録を Web に移したことを書く`
