# Go 廃止 段階 4（復習）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「今日の復習」（`GET /v1/reviews/due`・`/count`・`/entries`、`POST /v1/reviews/{itemId}`）と、学習ノートを復習に入れる・外す（`GET/PUT/DELETE /v1/entries/{id}/review`）を、Go API から Next.js（Prisma）に移し、FSRS の計算も TypeScript で行う。Go の該当コードを消す。

**Architecture:** 段階 1〜3 と同じ形にする。

- FSRS の計算は、I/O の無い純粋な関数として `src/domain/review/fsrs.ts` に置く。JST の日の数え方（連続日数・この 7 日間）も純粋な関数として `src/domain/review/review-days.ts` に置く。
- DB の読み書きは `src/infrastructure/prisma/review-store.ts` に置く。`NOT EXISTS` の条件と行のロックは `$queryRaw` で書く（設計の決めたこと 7）。
- 持ち主の決定は `src/application/review/review-queue.ts`（今日の復習）と、`src/application/learning/learning-notes.ts` の `isInReview`・`setInReview`（ノートの出し入れ）に置く。
- `src/composition/review-container.ts` の `reviews` と、`learning-container.ts` の `learningNotes` を新しい実装にする。これで `learning-container.ts` から Go が消える。
- 画面・Server Action・Route Handler の名前と見た目は変えない。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7（`$queryRaw`・対話型トランザクション）、`node:test` + `tsx`、Playwright。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 4、決めたこと 7〜9）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage4-go-reference.md`（以下「参照」）。FSRS の式と定数、ルートごとの SQL・順番・文言、Go に残すべきコードが、file:line 付きで書いてある。

## 設計者の判断（コントローラーが確かめること）

1. **FSRS は手で TypeScript に写し、`ts-fsrs` は入れない。** Go が使うのは go-fsrs の basic scheduler（short-term あり、fuzz なし）だけで、式と状態の移り変わりは約 150 行で読める形に書ける（参照 §1）。`ts-fsrs` は go-fsrs の元だが、版によって丸めや既定値が変わりうるので、Go と同じ結果を保証できない。使わない部分（long-term scheduler・fuzz・パラメーターの検証と clip・reschedule・rollback）は写さない。clip は既定の重みでは何も変えないことを確かめてある（参照 §1）。
2. **Go と同じ結果であることは、golden ファイルで固定する。** Task 1 で Go 側に `services/api/review/golden_test.go` を足し、Go の `review.Next` の結果を `tests/fixtures/fsrs-golden.json` に書き出す（`go test ./review -run TestGolden -update`）。ふだんの `go test` は、Go がそのファイルと同じ結果を出すことを確かめる。TS のテストは同じファイルを読む。`review` パッケージはデモのリセットが使うので段階 10 まで残り、そのあいだ 2 つの実装がずれないことを両側から確かめられる。整数・状態・日時は完全一致、`stability`・`difficulty` は相対誤差 `1e-9` 以内（Go と V8 の `exp`・`pow` は最後の桁が違いうるため）。**乱数は無い**（fuzz が切ってある。参照 §1）ので、`now` を渡すだけで決まる。
3. **練習の間違いを復習に入れる処理（`EnqueueReviewItems`）は Go に残す。** 練習の記録の保存（段階 5）の一部だから。Web は Go が作った `preposition`・`complement` の項目を読んで答えるだけ。行の形は同じなので、Go と Web が同じ表を使っても問題ない。
4. **連続日数と「この 7 日間」は、1 回のクエリ（JST の日付の一覧、今日から 400 日前の 0 時「以上」）から純粋な関数で出す。** Go は連続日数を「より後（`>`）」、7 日間を「以上（`>=`）」の 2 回のクエリで読んでいた。違いは、ちょうど 400 日前の JST 0 時 0 分 0.000 秒の回答が 401 日目に数えられうることだけで、受け入れる。
5. **答えの「見つからない」は例外ではなく `false` で返す。** 段階 2 の `trash` などと同じ形にする。Go の 404 の条件（形の合わない itemId、ほかの人の項目、無い項目、ほかの項目に使われた logId）は、すべて `false`。画面の文言は今のまま「この問題は復習の一覧にありません。」。
6. **権限のエラーは `ReviewForbiddenError` を新しく作り、`action-state.ts` の `isForbidden` に足す。** 復習は学習ノートの一部ではないため、`LearningForbiddenError` を使い回さない。ノートの出し入れ（`learningNotes.isInReview`・`setInReview`）は、今までどおり `LearningForbiddenError`。
7. **logId の確かめは Go と同じ正規表現にする。** `z.uuid()` をやめ、`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` にする（ブラウザの `crypto.randomUUID()` は常に通る）。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Route Handler、Server Action）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は何も import しない（同じ domain の型を除く）。
- 持ち主（参照 §0）：
  - 常に今の利用者の `githubId`（管理者が「メンバーとして見る」ときは、その会員の ownerId）。フォームの値は使わない。
  - 未ログイン・ゲスト・revoked・`githubId` なし → `ReviewForbiddenError`（ノートの出し入れは `LearningForbiddenError`）。
  - デモのアカウントも、読む・答える・出し入れする、のすべてができる（Go と同じ。`notForDemo` ではない）。
- FSRS（参照 §1）：
  - 重み `W` は参照 §1 の 21 個をそのまま定数にする。`RequestRetention 0.9`、`MaximumInterval 36500`、学習のステップ `[1, 10]` 分、再学習のステップ `[10]` 分、short-term あり、fuzz なし。
  - 経過日数は、前回の回答と今の **UTC の日付** の差（JST ではない）。New か `lastReview` が無ければ 0。
  - 1 回の回答で `reps + 1`、`lastReview = now`。`lapses + 1` は Review の状態で「もう一度」のときだけ。
  - 次のときは `FsrsError` を投げる：rating が 1〜4 でない、state が 0〜3 でない、New でないのに `stability < 0.001`・`difficulty < 1`・有限でない、`lastReview > now`、結果の `stability < 0.001`・`difficulty < 1`。
  - 間隔の丸めは `Math.round`（値はすべて正なので Go の `math.Round` と同じ）。
- 期日の条件（参照 §3）：`"ownerId" = owner AND "due" <= now AND NOT EXISTS (… 'entry' … "deletedAt" IS NOT NULL)`。`now` は 1 回の処理で 1 度だけ取る（ミリ秒）。
  - ゴミ箱のノートの項目は、数えず並べない。
  - ノートや単語が無くなった項目（孤児）は、数えて並べる（画面は飛ばす。今の `toCards` のまま）。
- 今日の復習（`listDue(limit)`）：
  - `limit` は 1〜100 の整数（ほかは `RangeError`。呼ぶのは `/review` の 20 とホームの 1 だけ）。
  - `count` は種類ごとの数の合計。並びは `due, id` の順で `limit` 件。項目とその単語・ノート（ゴミ箱に無いもの、ヒントは position 順）は、`RepeatableRead` の 1 つのトランザクションで読む。
  - `nextDue` は、同じ `now` で 4 つの rating を計算したもの。`FsrsError` なら `null`。
- 連続日数・7 日間（参照 §3）：今日は `now` の JST の日付。`streakDays` は今日か昨日から続く日数（どちらにも回答が無ければ 0）。`recentDays` は今日を最後とする 7 日（古い順）。
- 答える（参照 §4）：
  - 1 つのトランザクションで、次の順に行う。
    1. `SELECT … FROM "ReviewItem" WHERE id AND ownerId FOR UPDATE`
    2. logId の `ReviewLog` を探す。同じ項目と持ち主なら、何もせずに `true`。ほかの項目のものなら `false`。
    3. FSRS で次のカードを出す。
    4. `ReviewLog` を作る。`state`・`due`・`stability`・`difficulty`・`scheduledDays` は **答える前** のカード、`reviewedAt` は now。
    5. `ReviewItem` を更新する。`updatedAt` は now を明示する（Prisma の `@updatedAt` に任せない）。
  - itemId が `/^c[a-z0-9]{24}$/` に合わなければ、DB を読まずに `false`。
- ノートを入れる・外す（参照 §4）：
  - 同じトランザクションで、先に `SELECT 1 FROM "LearningEntry" WHERE "id" = … AND "ownerId" = … AND "deletedAt" IS NULL FOR SHARE` を行う。ゴミ箱に入れる・完全に消す処理と競っても、項目が残らないようにするため。
  - 入れる：`language 'zh'`、`kind 'entry'`、`due = createdAt = updatedAt = now`、`state 0`。すでにあれば何もしない（`createMany` + `skipDuplicates`）。
  - 外す：`entry` の項目を消す（ログは cascade で消える）。入っていなくても `true`。
  - 自分の生きているノートでなければ `false`（読むときは `null`）。
- トランザクションの時間：`{ maxWait: 5_000, timeout: 15_000 }`（`learning-note-writes.ts` と同じ）。
- 文言（今のまま）：
  - 形の不正 → `復習の回答の形式が不正です。`
  - 見つからない → `この問題は復習の一覧にありません。`
  - 権限 → `accountForbiddenMessage`（答える）、`ログインし直してください。`（出し入れ）
  - ノートが無い → `見つかりませんでした。画面を更新してください。`
  - そのほかの失敗 → 一般的な文言。ログはコードとエラーの名前だけ。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（DB のテストは Docker があれば）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **FSRS が Go と同じか。** golden ファイルのすべての手順で、カードと 4 つの `nextDue` が一致し、エラーになる手順はエラーになる。→ Task 1 のテスト `matches every answer Go scheduled in the golden file`（と Go の `TestGolden`）。
2. **答えは 1 つの logId で 1 回だけ、持ち主の中だけ。ログは答える前のカードを残す。** → Task 2 のテスト `reviewLogRow keeps the card as it stood before the answer`、Task 4 の e2e `a retried answer is applied once`。
3. **ゴミ箱と孤児。** ゴミ箱のノートの項目は数にも一覧にも出ず、戻すと出る。対象の無い項目は数えるが、カードにはならない。→ Task 4 の e2e `the count leaves out trashed notes but still counts cards whose target is gone`、既存の `e2e/note-review.spec.ts:56`。
4. **JST の日の境目。** 23:30 JST・00:10 JST の回答の日、昨日まで続く連続日数、7 日間の端。→ Task 2 のテスト `streak counts Japan days and lasts until a whole day is missed` と `recent days are the last 7 Japan days, oldest first`。
5. **だれの列か。** 管理者が「メンバーとして見る」ときは会員の列を読んで答える。デモは答えられる。ゲストは列を持たない。→ Task 3 のテスト `reviews follow the signed-in owner`、Task 4 の e2e `an admin acting as a member reviews the member's queue` と `the demo account can answer a review`、既存の `e2e/review.spec.ts:252`。

---

### Task 1: FSRS（純粋な関数）と golden ファイル

**Files:**

- Create: `services/api/review/golden_test.go`（`-update` で書き出し、ふだんは比べる）
- Create: `tests/fixtures/fsrs-golden.json`（Go が書き出したもの）
- Create: `src/domain/review/fsrs.ts`
- Test: `tests/review-fsrs.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // 0 new, 1 learning, 2 review, 3 relearning (go-fsrs's numbers).
  export type FsrsState = 0 | 1 | 2 | 3;
  export type FsrsCard = {
    due: Date;
    stability: number;
    difficulty: number;
    scheduledDays: number;
    reps: number;
    lapses: number;
    state: number; // checked to be an FsrsState
    remainingSteps: number;
    lastReview: Date | null;
  };
  export class FsrsError extends Error {}
  export function newFsrsCard(now: Date): FsrsCard;
  // The card after an answer rated `rating` (1..4) at `now`. Throws FsrsError.
  export function nextFsrsCard(
    card: FsrsCard,
    rating: number,
    now: Date,
  ): FsrsCard;
  // When each rating, もう一度 to 簡単, would bring the card back; null when
  // FSRS refuses the card (the due list then shows no intervals).
  export function nextFsrsDues(
    card: FsrsCard,
    now: Date,
  ): readonly [Date, Date, Date, Date] | null;
  ```

- [ ] **Step 1: Go の golden を書き出す。**
  - `golden_test.go` に `var update = flag.Bool("update", false, …)` と `TestGolden` を書く。ファイルは `../../../tests/fixtures/fsrs-golden.json`。
  - 形：`{"cases":[{"name","start":card,"steps":[{"at","rating","nextDues":[4 iso]|null,"card":card|null,"error":bool}]}]}`。card は `review.Card` のすべての列（日時は `YYYY-MM-DDTHH:MM:SS.sssZ`、`lastReview` は null か日時）。`nextDues` は答える前のカードに 1〜4 の `review.Next` をかけた `Due`（`NextDues` は Task 4 で消すので使わない）。次の手順は、エラーでなければ前の手順の `card` から続ける。
  - ケース（開始は `2026-11-05T09:00:00.000Z` の New）：
    1. `new-again`・`new-hard`・`new-good`・`new-easy`（1 回だけ）
    2. `good-path`：Good を期日ごとに 8 回（卒業して Review を 6 回）
    3. `easy-path`：Easy を期日ごとに 6 回
    4. `hard-in-learning`：Hard、Hard、Good、Good（期日ごと）
    5. `lapse`：Good、Good で卒業 → 期日に Again → Good、Hard、Again、Good（期日ごと）
    6. `early-review`：卒業したカードに、前回から 1 時間後（同じ UTC の日）に Good
    7. `overdue`：卒業したカードに、期日の 90 日後に Hard → その 90 日後に Again → その 90 日後に Easy
    8. `utc-day-boundary`：Again（23:58Z）→ 23:59Z に Good → 翌日 00:01Z に Good（経過 1 日）
    9. `jst-midnight-same-utc-day`：Again（14:58Z）→ 14:59Z に Good → 15:01Z に Good（JST では日をまたぐが、UTC では同じ日なので経過 0）
    10. `brought-forward`：卒業したカードの `due` を回答の 2 日前に早めて Good（練習の間違いで前倒しされたカード）
    11. `errors`：rating 0、5、前回より前の時刻、`state 2` で `stability 0` のカード（どれも `error: true`、`card: null`。`nextDues` は、時刻かカードが不正な後ろの 2 つだけ `null`）
  - `go test ./review -run TestGolden -update` で書き出し、`go test ./review` で PASS を確かめる。
- [ ] **Step 2: 失敗する TS のテストを書く。**
  - `matches every answer Go scheduled in the golden file`：
    - すべてのケースのすべての手順で、`nextFsrsDues` と `nextFsrsCard` の結果が golden と一致する。
    - 日時・整数・`lastReview` は完全一致。`stability`・`difficulty` は相対誤差 `1e-9` 以内。
    - `error: true` の手順は `FsrsError` を投げる。
  - Go の `review_test.go` の 5 本を写す。
    - `a new card is due at once`
    - `the first answer schedules by rating`
    - `good answers spread the reviews`
    - `again on a review card is a lapse`
    - `better answers never come back sooner`
  - `elapsed days follow UTC dates, not Japan dates`：`jst-midnight-same-utc-day` と `utc-day-boundary` の 2 手順目の `stability` が違うことを、名前のあるテストで示す。
- [ ] **Step 3: 失敗を確かめる。** `node --import tsx --test tests/review-fsrs.test.ts` → FAIL。
- [ ] **Step 4: 実装する。**
  - 参照 §1 の式を、名前の付いた小さな関数（`initStability`・`initDifficulty`・`nextDifficulty`・`shortTermStability`・`forgettingCurve`・`nextRecallStability`・`nextForgetStability`・`nextInterval`）と、状態ごとの 3 つの関数（new・learning・review）に分けて書く。
  - 各関数の上に、go-fsrs のどの関数にあたるかを英語のコメントで 1 行書く（`// go-fsrs arithmetic.go nextForgetStability`）。
  - 重みは `as const` の配列にし、なぜ既定値のままかをコメントに書く。
- [ ] **Step 5: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint`、`cd services/api && go test ./review` → PASS。
- [ ] **Step 6: コミット。** `feat(web): FSRS の計算を TypeScript で行う`

### Task 2: 復習の列の読み書き（Prisma）と JST の日

**Files:**

- Create: `src/domain/review/review-days.ts`
- Create: `src/infrastructure/prisma/review-store.ts`
- Test: `tests/review-days.test.ts`、`tests/review-store.test.ts`（純粋な部分だけ。DB の動きは Task 4 の e2e）

**Interfaces:**

- Consumes: Task 1 の `FsrsCard`・`nextFsrsCard`、`newId`、`prisma()`、`LearningEntry`・`VocabularyCard`。
- Produces:

  ```ts
  // review-days.ts. Dates are Japan calendar dates as "YYYY-MM-DD".
  export const REVIEW_HISTORY_DAYS = 400;
  export function japanDate(at: Date): string;
  // JST midnight of the date `daysBack` days before `today`, as a UTC instant.
  export function japanMidnightBefore(today: string, daysBack: number): Date;
  // Days in a row with a review, ending today or yesterday; 0 otherwise.
  export function reviewStreak(
    today: string,
    reviewed: readonly string[],
  ): number;
  // Whether each of the `count` days up to today had a review, oldest first.
  export function recentReviewDays(
    today: string,
    reviewed: readonly string[],
    count?: number,
  ): boolean[];

  // review-store.ts
  export const REVIEW_ITEM_ID = /^c[a-z0-9]{24}$/;
  export type StoredReviewItem = {
    id: string;
    language: string;
    kind: string;
    targetId: string;
    card: FsrsCard;
    vocabulary: VocabularyCard | null; // kind "vocabulary" with its word
    entry: LearningEntry | null; // kind "entry" with its live note
  };
  // Pure: the ReviewLog row for an answer, from the card as it stood.
  export function reviewLogRow(input: {
    logId: string;
    ownerId: string;
    itemId: string;
    rating: number;
    before: FsrsCard;
    reviewedAt: Date;
  }): {
    id: string;
    ownerId: string;
    itemId: string;
    rating: number;
    state: number;
    due: Date;
    stability: number;
    difficulty: number;
    scheduledDays: number;
    reviewedAt: Date;
  };
  export function createReviewStore(db: () => PrismaClient): {
    countDue(ownerId: string, now: Date): Promise<number>;
    countDueByKind(ownerId: string, now: Date): Promise<Record<string, number>>;
    listDue(
      ownerId: string,
      now: Date,
      limit: number,
    ): Promise<StoredReviewItem[]>;
    // Distinct Japan dates of the owner's answers at or after `since`.
    reviewedDates(ownerId: string, since: Date): Promise<string[]>;
    // false: not the owner's item, or logId already used for another item.
    answer(
      ownerId: string,
      itemId: string,
      logId: string,
      rating: number,
      now: Date,
    ): Promise<boolean>;
    entryIdsInReview(ownerId: string): Promise<Set<string>>;
    // null: not the owner's live note.
    isEntryInReview(ownerId: string, entryId: string): Promise<boolean | null>;
    // false: not the owner's live note.
    addEntry(ownerId: string, entryId: string, now: Date): Promise<boolean>;
    removeEntry(ownerId: string, entryId: string): Promise<boolean>;
  };
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/review-days.test.ts`：
    - `streak counts Japan days and lasts until a whole day is missed`：Go の `TestReviewStreakCountsDaysInJapanTime` を写す。回答は `2026-10-18T03:00Z`・`2026-10-18T15:10Z`・`2026-10-20T01:00Z`。`japanDate` で日付にしてから数える。今が `2026-10-20T14:30Z` → 3、その 2 時間後 → 3、26 時間後 → 0。
    - `the streak table`：Go の `TestStreakFrom` の表をすべて写す。
    - `recent days are the last 7 Japan days, oldest first`：
      - 今日と 6 日前に回答 → `[true, false, false, false, false, false, true]`。
      - 7 日前と明日の日付は無視する。
      - 月と年をまたぐ（`2027-01-02` の 7 日間）。
    - `japanMidnightBefore`：`("2026-11-05", 0)` → `2026-11-04T15:00:00.000Z`。`("2026-11-05", 400)` も確かめる。
  - `tests/review-store.test.ts`：
    - `reviewLogRow keeps the card as it stood before the answer`：`state`・`due`・`stability`・`difficulty`・`scheduledDays` が `before` のもの、`reviewedAt` が渡した時刻。
    - `REVIEW_ITEM_ID`：`newId()` は合う。`not-an-id`・大文字・26 文字は合わない。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/review-days.test.ts tests/review-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 期日の条件は、1 つの `Prisma.sql` の部品（`dueCondition(ownerId, now)`）にまとめる。`countDue`・`countDueByKind`・`listDue` は、それを使う `$queryRaw` で書く。`NOT EXISTS` が Prisma のクエリで書けないことをコメントに書く。
  - `listDue`：`$transaction(async (tx) => …, { isolationLevel: "RepeatableRead", ...TRANSACTION_OPTIONS })`。
    - 中で、項目、単語（`vocabularyEntry.findMany`、持ち主と id で絞る）、ノート（ゴミ箱に無いもの、ヒントは position 順）を読む。
    - ノートを `LearningEntry` にする部分が `learning-note-reads.ts` と重なるなら、そちらから小さな関数を export して使う。
  - `reviewedDates`：
    ```sql
    SELECT DISTINCT to_char(("reviewedAt" + interval '9 hours')::date, 'YYYY-MM-DD') AS day
      FROM "ReviewLog" WHERE "ownerId" = … AND "reviewedAt" >= …
    ```
  - `answer`：Global Constraints の 5 つの手順を、対話型トランザクションで行う。`FOR UPDATE` は `$queryRaw`。`nextFsrsCard` が投げたら、そのまま投げる（Go の 500 と同じ）。
  - `isEntryInReview`：ノートが自分の生きているものかを `learningEntry.findFirst` で見てから、`reviewItem.count`。
  - `addEntry`・`removeEntry`：対話型トランザクションで、`FOR SHARE` の `$queryRaw` を先に行う（0 行なら `false`）。消すときは `reviewItemsToDelete`（`learning-note-writes.ts`）を使う。
  - `REVIEW_KIND_ENTRY = "entry"`・`LANGUAGE = "zh"` を定数にする。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 復習の列を Prisma で読み書きする`

### Task 3: application・container・呼ぶ側を差し替える

**Files:**

- Create: `src/application/review/review-queue.ts`
- Modify: `src/application/learning/learning-notes.ts`（`isInReview`・`setInReview` と依存 `entryReviews` を足す）
- Modify: `src/composition/review-container.ts`、`src/composition/learning-container.ts`（Go のゲートウェイを外す）
- Modify: `src/presentation/actions/review-actions.ts`（`attemptGo` で `false` を見つからないの文言に。logId は設計者の判断 7）、`src/presentation/controllers/action-state.ts`（`isForbidden` に `ReviewForbiddenError`）、`src/app/api/review-count/route.ts`・`src/app/review/page.tsx`・`src/app/page.tsx`（呼び方が変わるときだけ）
- Modify: Go を指すコメント（`src/domain/review/review-item.ts`、`note-review-actions.ts`、`note-review-controller.ts`、ページのコメント）
- Delete: `src/infrastructure/go-api/review-gateway.ts`、`src/infrastructure/go-api/learning-gateway.ts`、`tests/go-api-review-gateway.test.ts`、`tests/go-api-learning-gateway.test.ts`
- Test: `tests/review-queue.test.ts`（新規）、`tests/learning-notes.test.ts`（足す）、`tests/review-actions.test.ts`（新規。action を依存の注入で試せないなら、判定の部分を controller に出して試す）、`tests/note-review-controller.test.ts`（Go の 403 の行を `LearningForbiddenError` に直す）

**Interfaces:**

- Consumes: Task 1 の `nextFsrsDues`、Task 2 の `createReviewStore`・`reviewStreak`・`recentReviewDays`・`japanDate`・`japanMidnightBefore`・`REVIEW_HISTORY_DAYS`・`REVIEW_ITEM_ID`。
- Produces:

  ```ts
  // review-queue.ts
  export class ReviewForbiddenError extends Error {
    override name = "ReviewForbiddenError";
  }
  export type ReviewQueueDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: Pick<ReviewStore, "countDue" | "countDueByKind" | "listDue" | "reviewedDates" | "answer" | "entryIdsInReview">;
    now: () => Date;
  };
  export function createReviewQueue(deps: ReviewQueueDeps): {
    listDue(limit: number): Promise<DueReviews>;
    countDue(): Promise<number>;
    entriesInReview(): Promise<Set<string>>;
    // false when the item is not the user's (see 設計者の判断 5).
    answer(answer: { itemId: string; logId: string; rating: ReviewRating }): Promise<boolean>;
  };
  // added to LearningNotesDeps
  entryReviews: {
    isEntryInReview(ownerId: string, id: string): Promise<boolean | null>;
    addEntry(ownerId: string, id: string, now: Date): Promise<boolean>;
    removeEntry(ownerId: string, id: string): Promise<boolean>;
  };
  // added to the object createLearningNotes returns (same names as before)
  isInReview(id: string): Promise<boolean | null>;
  setInReview(id: string, inReview: boolean): Promise<boolean>;
  ```

  `listDue` は次の順に行う。
  1. 持ち主を決める。
  2. `now` を 1 回取る。
  3. `countDueByKind` → `listDue` → `reviewedDates(owner, japanMidnightBefore(today, REVIEW_HISTORY_DAYS))`。
  4. 項目ごとに `nextFsrsDues(card, now)` を計算する。
  5. `DueReviews` にする（`count` は byKind の合計）。

  `ReviewItem`（domain）の形は変えない（`due`・`state`・`reps`・`lapses`・`lastReview` はカードから取る）。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/review-queue.test.ts`：
    - `reviews follow the signed-in owner`：
      - 会員 → その ownerId。
      - 会員として見ている管理者 → 会員の ownerId。
      - デモ → 自分の列（`answer` も呼ばれる）。
      - 未ログイン・ゲスト・revoked・`githubId` なし → `ReviewForbiddenError`。どのメソッドでも store は呼ばれない。
    - `listDue sums the kinds and works out each answer's next due from one now`：
      - 渡した `now` が、store の 3 つの呼び出しと `nextFsrsDues` のすべてで同じ。
      - `count` は byKind の合計。
      - `FsrsError` になるカード（`state 2`、`stability 0`）は `nextDue: null` で、ほかの項目は残る。
      - `streakDays` と `recentDays` が、`reviewedDates` の結果から出る。
    - `listDue only takes a limit from 1 to 100`：0・101・1.5 → `RangeError`。
    - `an answer to an item id of the wrong shape is not found without asking the store`
  - `tests/learning-notes.test.ts`：
    - `the review status is the signed-in owner's`：
      - 会員として見ている管理者 → 会員の ownerId で `isEntryInReview`・`addEntry`・`removeEntry` が呼ばれる。
      - ゲストなど → `LearningForbiddenError`。
      - `setInReview(id, true)` は `addEntry`、`false` は `removeEntry`。
  - 答える action（または controller）：
    - 権限なし → `accountForbiddenMessage`。
    - 大文字の logId・`z.uuid()` だけが通す形 → `復習の回答の形式が不正です。`
    - `false` → `この問題は復習の一覧にありません。`
    - `ReviewForbiddenError` → `accountForbiddenMessage`。
    - ふつうの `Error` → 一般的な文言（ログは `REVIEW_ANSWER_FAILED` とエラーの名前だけ）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/review-queue.test.ts tests/learning-notes.test.ts tests/note-review-controller.test.ts` ほか → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `review-container.ts`：`export const reviews = createReviewQueue({ currentUser: getCachedCurrentUser, store: createReviewStore(prisma), now: () => new Date() })`。
  - `learning-container.ts`：`learningNotes` を `createLearningNotes(...)` そのものにし、`entryReviews` に同じ `createReviewStore(prisma)` を渡す。「Go を通る」のコメントを消す。
  - ページと Route Handler は、`loadOr` のコードと見え方を変えない。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
  - `grep -rn "/v1/reviews\|/v1/entries/.*/review\|learning-gateway\|review-gateway" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): 復習を Go に頼まずに行う`

### Task 4: Go の復習のルートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §8 の「Becomes dead」と §7 の「keep」に従う）：
  - `httpapi/review_handlers.go`・`review_handlers_test.go` を消す。練習のために残すものは、新しい `httpapi/practice_reviews.go` に移す。
    - `Reviews`（`EnqueueReviewItems` だけのインターフェースにする）
    - `queueReviews`・`prepositionReviewTargets`・`complementReviewTargets` と、その 3 つの定数
  - `TestSavingARoundQueuesItsMissedQuestions`・`TestSavingARoundFailsWhenTheQueueFails` と、小さくした `fakeReviews` は `practice_reviews_test.go` に移す。
  - `router.go` の `reviewRoutes` とその呼び出しを消す。`Deps.Reviews` のコメントを「練習の間違いを入れる列」だけに直す。
  - `httpapi/vocabulary_json.go`、`respond.go` の `msgReviewInvalid`・`msgReviewNotFound` を消す。
  - `store/review_items.go`：`ReviewTarget`・`EnqueueReviewItems` だけを残す。テストは `TestEnqueueReviewItemsAddsEachTargetOnce`・`TestEnqueueBringsAMissedItemForward` だけを残し、項目を読むところはテスト用の関数で書き直す。
  - `store/entry_reviews.go`：`ReviewKindEntry`・`entryReviewLanguage`・`notTrashedEntry` だけを残す。`entry_reviews_test.go` は消す（同じことを Task 4 の e2e と `note-review.spec.ts` で確かめる）。
  - `store/vocabulary.go`：`vocabularyByID`・`scanVocabulary`・`vocabularyColumns` を消す。`VocabularyEntry` は、テストのほかに使うところが無ければテストに移すか消す。
  - `review.NextDues`・`TestNextDuesMatchesEachAnswer` を消す。`review.NewCard`・`Next` は残す（デモ）。
- テスト用の関数（stage 3 の `createBatch` と同じ考え方）：`store/testhelpers_test.go` に 3 つの関数を足し、`review_orphans_test.go`・`demo_test.go`・`study_log_test.go`・`review_items_test.go` をそれで書き直す。
  - `dueItems(t, s, owner, now)`：生の SQL で、期日の来た項目の id・kind・targetId を `due, id` の順に読む。
  - `answerItem(t, s, owner, itemID, rating, now)`：`review.Next` を使い、`ReviewLog` を入れて `ReviewItem` を更新する。
  - `putEntryInReview(t, s, owner, entryID, now)`：`INSERT … ON CONFLICT DO NOTHING`。
- テストの書き直しと削除：
  - `TestRemoveEntryReviewLeavesNoOrphanLog`・`TestDueVocabularyCarriesItsWord` を消す。
  - `demo/demo_db_test.go:56` は `countRows` で書き直す。期日の来た項目が 1 件以上あり、対象の無い項目が 0 件であることを確かめる。
  - `httpapi/act_as_test.go` の `TestActAsWritesGoToTheMember` は、残る書き込みのルート `PUT /v1/preposition-records/{id}` で書き直す（持ち主と「acting as member」のログを確かめるのは同じ）。
  - `httpapi/demo_test.go:102-112` は `GET /v1/preposition-records` で書き直す。
  - `router_test.go` の `Reviews: &fakeReviews{}` は、小さくした fake を使う。
- Modify（docs-site。段階 1〜3 と同じ扱い）：
  - `docs-site/reference/reviews.md` を消し、`docs-site/.vuepress/config.ts:36` のナビから外す。
  - `docs-site/reference/README.md:41-47` の行を消す。
  - `reference/practice.md:10`・`reference/study-log.md:32` の `reviews.md` へのリンクを、ふつうの文（Web の「今日の復習」）にする。
  - `operations/local.md:58` の例を、残るルート（`/v1/study-log` など）にする。
- Modify：`e2e/` にテストを足す（下の Step 2）

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功。テスト用の関数を書き直したので、`store` と `demo` の DB のテストは、開発用 DB（Docker）で必ず走らせる。
  - `grep -rn "reviews/due\|reviews/count\|reviews/entries\|RecordReview\|ListDueReviewItems\|EntryInReview\|AddEntryReview\|NextDues" services/api` → 何も出ない。
- [ ] **Step 2: e2e を足す（今の e2e に無いものだけ）。**
  - `e2e/act-as.spec.ts`：`an admin acting as a member reviews the member's queue`
    - 会員のノートを 1 つ seed する。
    - 管理者が会員として操作し、ホームで「復習に入れる」→ `/review` で「めくる」→「できた」。
    - DB で次を確かめる。
      - `ReviewItem` と `ReviewLog` の `ownerId` が会員。
      - 管理者（`adminOwnerId`）の `ReviewItem` が 0 件。
  - `e2e/demo.spec.ts`：`the demo account can answer a review`
    - デモで `/review` の 1 枚目に答える。
    - デモの持ち主の `ReviewLog` が 1 件増える。
  - `e2e/note-review.spec.ts`：`a retried answer is applied once`
    - ノートを復習に入れ、答える Server Action の POST を `page.on("request")` で捕まえる。
    - 「1問 復習しました」のあとに、`page.request.fetch(captured)` で同じ本文（同じ logId）をもう一度送る。
    - DB で次を確かめる。
      - `ReviewLog` が 1 行で、`state` が 0。
      - `ReviewItem.reps` が 1。
  - `e2e/note-review.spec.ts`：`the count leaves out trashed notes but still counts cards whose target is gone`
    - ノート 2 つを復習に入れる。
    - SQL で、対象の無い `entry` の項目（`targetId` は存在しない id、due は今）を 1 つ足す。
    - 確かめること：
      - 復習のバッジが 3。`/review` はカード 2 枚（「1 / 2」）。
      - 1 つ目のノートをゴミ箱に入れると、バッジは 2、`/review` は 1 枚。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。
  - 参照 §6「E2E」の spec（review・note-review・review-schedule・aspect-particles・complements・vocabulary・demo・study-log・bottom-navigation・act-as・trash）を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の復習のルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`README.md`（変える必要があれば）

- [ ] **Step 1: 直す。**
  - 「Web が復習の列を DB に直接読み書きし、FSRS も Web（`src/domain/review/fsrs.ts`）で計算する」ことを書く。Go に残っているものの一覧から、復習を外す。
  - 残るものとして、次を書く。
    - 練習の間違いを列に入れる処理（段階 5）
    - LINE の復習のお知らせ（段階 10）
    - デモのリセット（段階 10）
    - Go の `review` パッケージ。golden ファイル `tests/fixtures/fsrs-golden.json` で、Web と同じ結果であることを確かめている。
  - `docs/architecture.md` の「5. 復習」に、FSRS の計算の場所と golden ファイルのことを足す。
  - `docs/api-deployment.md` の「段階3（CSV の取り込み）のマージの前と後」のあとに、「段階4（復習）のマージの前と後」を足す。
    - マージの前：新しい環境変数も、マイグレーションもない。
    - マージのあと：
      1. Web の Production のデプロイが Ready になったことを確かめる。
      2. `vercel promote` で切り替える。
      3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/reviews/*` と `/v1/entries/{id}/review` が本番の Go から消える。
    - 切り替えのあいだ：古い Go と新しい Web が同じ列に答えを書いても、同じ計算・同じ行のロック（`FOR UPDATE`・`FOR SHARE`）なので問題ない。
    - 戻すとき：
      - Go だけを戻しても害はない。
      - Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/reviews/*` を呼んで 404 になる。今日の復習は失敗の表示、ホームの復習のカードとバッジは消え、答えると「この問題は復習の一覧にありません。」になる。Web を戻すなら Go も戻す。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: 復習を Web に移したことを書く`
