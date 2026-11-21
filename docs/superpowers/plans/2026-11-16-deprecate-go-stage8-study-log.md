# Go 廃止 段階 8（学習ログ・AI の利用量）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学習ログ（`GET /v1/study-log`。日本時間の日ごとの復習・練習・ノート・単語の数）と、管理者の AI の利用量（`GET /v1/admin/ai-usage`。日本時間の月ごとの集計）を、Go API から Next.js に移す。どちらも読むだけなので、Web が Prisma で DB を直接読む。Go の 2 つのルートと、それだけが使うコードを消す（LINE が使う `RecordAIUsage` は残す）。

**Architecture:** 段階 4〜7 と同じ形にする。

- 期間の確かめと日本時間の境目の計算（Go の `parseLogDate`・93 日・`dayRange`・`parseMonth`）は、I/O の無い純粋な関数として `src/domain/study-log/study-log.ts` と `src/domain/ai-usage/monthly-usage.ts` に置く。
- DB を読むのは `src/infrastructure/prisma/study-log-store.ts`（新規）と `src/infrastructure/prisma/ai-usage-store.ts`（足す）。どちらも Go と同じ 1 つの SQL を `$queryRaw` で流す。
- だれが読めるかの判断は `src/application/study-log/study-log-reader.ts` と `src/application/ai-usage/ai-usage-summary.ts`。
- `src/composition/study-log-container.ts` の `studyLog`（`list(from, to)`）は名前も形も変えない。AI の利用量は新しい `src/composition/ai-usage-container.ts` の `aiUsage`（`month(month?)`）にし、`identity-container.ts` から外す。
- 画面と文言は変えない（判断 5 の 1 文を除く）。

**Tech Stack:** Next.js 16.4（Server Component、`unstable_rethrow` を使う `loadOr`）、TypeScript、Prisma 7（`$queryRaw`、`Prisma.sql`）、`node:test` + `tsx`、Playwright。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 8、決めたこと 7〜9）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage8-go-reference.md`（以下「参照」）。だれが読めるか、期間と月の規則と文言、2 つの SQL の全文、Go に残すべきコード、書き直す Go のテストが file:line 付きで書いてある。

## 設計者の判断（コントローラーが確かめること）

1. **2 つとも、Go と同じ 1 つの SQL を `$queryRaw`（タグ付きテンプレート）で流す。** 学習ログは 5 つの表を `UNION ALL` して日本時間の日でまとめる。AI の利用量は 2 つのアカウントの表を `LEFT JOIN` し、人ごとのトークンの合計（窓関数）で並べる。どちらも Prisma のクエリ（`groupBy` など）では 1 回で書けず、JS で足し合わせると Go と並び順（DB の照合順序）がずれうるため。SQL を作る部分は純粋な関数（`studyLogSql`・`aiUsageMonthSql`）にして、`tests/review-store.test.ts` と同じく `sql.sql` と `sql.values` を確かめる。わけはコメントに書く。
2. **日本時間の日は、Go と段階 4 の `reviewedDates` と同じく `(列 + interval '9 hours')::date`。** 列は時差なしの `TIMESTAMP(3)` に UTC を入れているので、`AT TIME ZONE` は使わない。日付は SQL の中で `to_char(…, 'YYYY-MM-DD')` にして文字列で受け取る（JS の `Date` に戻さない）。合計は `bigint` で来るので `Number()` にする。
3. **期間と月の規則は Go のまま domain に写す。** ページは正しい値しか送らないが、Go の 400 の規則（ゼロ埋めの `YYYY-MM-DD`、実在する日、2000〜9999 年、`to >= from`、両端を含めて 93 日まで、月は `YYYY-MM` で 2000 年以降の 1〜12 月）は安く写せるので写す。合わなければ application が `RangeError` を投げ、学習ログのページは今と同じく `loadOr` の注意（一般的な文言）になる。`?month=2000-01`（`1999-12-27` から）と `?month=9999-12` で注意が出るのも Go と同じ（参照 §3 の Quirk）。
4. **だれが読めるかは Go と同じ。**
   - 学習ログ：admin と会員（デモを含む）。いつも `githubId` の記録（admin が会員として操作するときは会員の記録）。未ログイン・ゲスト・`githubId` なし・`revoked` は `StudyLogForbiddenError`。
   - AI の利用量：`role === "admin"` だけ（会員として操作している admin も読める。Go の `ActAs` は役割を admin のまま残すため）。会員・デモ・ゲスト・未ログインは `AiUsageForbiddenError`。集計は全員分で、持ち主で絞らない。
   - 確かめる順は Go と同じく、だれか → 期間・月。
5. **`/admin/ai-usage` は `loadOr` を通す。** 今は Go の `404` だけを `null`（注意）にし、ほかの失敗はページを落としていた。Web が DB を読むと `404` は起きないので、`loadOr("AI_USAGE_UNAVAILABLE", …, null)` で失敗を注意にする（学習ログのページと同じ扱い）。注意の文言の「Go API が最新かを確認してください。」は誤りになるので、`利用量を読めませんでした。時間をおいてもう一度お試しください。` にする。画面の文言を変えるのはこの 1 つだけ。
6. **返す `month` は、指定された月か、`now` の日本時間の月。** `now` は 1 回の処理で 1 度だけ読む。
7. **入れ物の置き場所。** `aiUsage` は `identity-container.ts`（ログインの入れ物）から新しい `ai-usage-container.ts` に移す。ほかの機能（`*-container.ts` が機能ごと）と同じにするため。
8. **Go は、この 2 つのルートのためだけのコードをすべて消す。** 参照 §6 のとおり。`store.AIUsage`・`RecordAIUsage`（LINE が記録に使う）と `memberAccounts`（会員の一覧が使う）は残す。
9. **消えるルートを通っていた Go のテストは、残るものだけを確かめる形に直す。**
   - `TestDemoKeepsItsOwnRecords` は、段階 8 のあと Go にデモの記録を返すルートが無いので、前半（学習ログ）を消し、後半（会員の一覧はデモには閉じ、ふつうの会員には開く）だけを残して `TestDemoIsRefusedTheMemberDirectory` にする。
   - `demo/demo_db_test.go` の学習ログでの確かめは、SQL で日本時間の日を数える形にする。
   - `store/ai_usage_test.go` は、Go に残る `RecordAIUsage` だけを確かめる `TestRecordAIUsageStoresOneCall` にする。
   - 学習ログのテストだけが使っていた道具（`prepositionRecord`・`complementRecord`・`saveRound`）は消す。
10. **DB を使う確かめは e2e で行う**（Web の unit テストは DB を使わない。段階 4〜7 と同じ）。日本時間の境目・ゴミ箱・ほかの人・種類ごとの数・並び順・合計は、e2e で行を直接入れて、ページの表示で確かめる。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Server Component の `searchParams`、`redirect`、`unstable_rethrow`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない（判断 5 の 1 つを除く）。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は何も import しない（同じ domain の型と関数を除く）。
- SQL はタグ付きテンプレート（`$queryRaw\`…\``・`Prisma.sql\`…\``）だけ。`$queryRawUnsafe` と文字列の連結は使わない。
- 学習ログ（参照 §1）：
  - 期間は `from`・`to`（`YYYY-MM-DD`、両端を含む）。`studyLogRange` が `null` なら `RangeError`。
  - `start` = `from` の日本時間 0 時（UTC で前日 15 時）、`end` = `to` の翌日の日本時間 0 時。
  - 数えるもの：`ReviewLog` の行（`reviewedAt`）が `reviews`、2 つの練習の表の `questionCount` の合計が `practiceQuestions`、ゴミ箱にない（`"deletedAt" IS NULL`）`LearningEntry` が `notes`、`VocabularyEntry` が `words`（どれも `createdAt`）。すべて `"ownerId" = 持ち主`、`>= start`、`< end`。
  - 何もない日は返さない。古い日から順。`[]` になりうる。
- AI の利用量（参照 §2）：
  - 月は `isAiUsageMonth` に合うもの。合わなければ `RangeError`。無ければ `now` の日本時間の月。
  - 範囲は、その月の 1 日の日本時間 0 時から、翌月の 1 日の日本時間 0 時の手前まで。
  - 行は人・`feature`・`model` ごと。`displayName` は会員の表示名（`'password:' || id`・`'ffpf:' || id`）、無ければ `""`。
  - 並びは、その月のその人のトークン（入力 + 出力）の合計が多い順、同じなら `ownerId`、人の中は `feature`・`model` の順（すべて SQL の `ORDER BY`）。
- ログは `STUDY_LOG_UNAVAILABLE`・`AI_USAGE_UNAVAILABLE` とエラーの名前だけ（`loadOr`）。持ち主の id や数は記録しない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **日本時間の日・月の境目が Go と同じか。** 日本時間 0 時ちょうどは新しい日・月に入り、その 1 ミリ秒前は前の日・月。→ Task 1 のテスト `study log ranges are Japan days, as Go read them` と `AI usage months are Japan months`、Task 4 の e2e `the study log counts each kind by Japan day, the owner's only` と `the admin reads a Japan month of AI usage, most tokens first`。
2. **数えるものが Go と同じか。** 練習は問題数の合計、ゴミ箱のノートは数えない、ほかの人の分は数えない。→ Task 2 のテスト `studyLogSql counts the five kinds as Go did`、Task 4 の e2e（同上）。
3. **だれの記録か。** 学習ログは会員として操作している admin なら会員の記録、デモは自分の記録。AI の利用量は admin だけ（操作中も）。→ Task 3 のテスト `the study log is the signed-in owner's` と `only admins read the AI usage`、Task 4 の e2e `an admin acting as a member reads the member's study log`。
4. **並び順と合計。** → Task 2 のテスト `aiUsageMonthSql orders people by their tokens as Go did`、Task 4 の e2e。
5. **Go に残すものを消していないか。** `RecordAIUsage`・`store.AIUsage`・`memberAccounts`・`jst`。→ Task 4 Step 1 の `go test ./...` と grep。

---

### Task 1: 期間と月の規則（純粋な部分）

**Files:**

- Modify: `src/domain/study-log/study-log.ts`、`src/domain/ai-usage/monthly-usage.ts`
- Test: `tests/study-log.test.ts`、`tests/ai-usage.test.ts`（どちらも足す）

**Interfaces:**

- Produces:

  ```ts
  // study-log.ts (the existing types and functions stay; the StudyDay
  // comment says "as the web counts it")
  // Go: maxStudyLogDays. The longest range one read covers, both ends included.
  export const STUDY_LOG_MAX_DAYS = 93;
  // [start, end) of the Japan dates from..to as instants, or null when Go
  // would have answered 400: either is not a zero-padded real date of
  // 2000..9999, to is before from, or the range is over 93 days.
  // Go: parseLogDate + listStudyLog's checks + LogDate.dayRange.
  export function studyLogRange(
    from: string,
    to: string,
  ): { start: Date; end: Date } | null;

  // monthly-usage.ts (the existing exports stay; summarizeAiUsage's comment
  // says "keeping the order the store read")
  // [from, to) of the Japan month "YYYY-MM" as instants. Go: AIUsageMonth.
  // Throws a RangeError when isAiUsageMonth(month) is false.
  export function aiUsageMonthRange(month: string): { from: Date; to: Date };
  // The Japan month of an instant as "YYYY-MM". Go: parseMonth("").
  export function aiUsageMonthOf(now: Date): string;
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/study-log.test.ts`：`study log ranges are Japan days, as Go read them`（Go の `TestStudyLog` の表を写す）。
    - `("2026-10-27", "2026-12-06")` → `{ start: new Date("2026-10-26T15:00:00.000Z"), end: new Date("2026-12-06T15:00:00.000Z") }`。
    - `("2026-11-02", "2026-11-02")` → `2026-11-01T15:00:00.000Z`〜`2026-11-02T15:00:00.000Z`。
    - `("2026-01-01", "2026-04-03")`（93 日）→ `null` でない。`("2026-12-31", "2027-01-01")` → `end` は `2027-01-01T15:00:00.000Z`。
    - `null`：`("2026-01-01", "2026-04-04")`（94 日）、`("2026-11-02", "2026-11-01")`、`("", "2026-11-01")`、`("2026-11-31", "2026-12-01")`、`("2026-11-1", "2026-11-30")`、`("1999-12-27", "2000-01-02")`、`("9999-12-27", "10000-01-02")`、`("2026-02-29", "2026-03-01")`。
  - `tests/ai-usage.test.ts`：`AI usage months are Japan months`（Go の `TestAIUsageSummaryDefaultsToTheJSTMonth` と store のテストの境目）。
    - `aiUsageMonthRange("2026-11")` → `{ from: new Date("2026-10-31T15:00:00.000Z"), to: new Date("2026-11-30T15:00:00.000Z") }`。
    - `aiUsageMonthRange("2026-12")` → `to` は `2026-12-31T15:00:00.000Z`。`aiUsageMonthRange("2027-01")` → `from` は `2026-12-31T15:00:00.000Z`。
    - `aiUsageMonthRange("2026-13")`・`("1999-12")` → `RangeError` を投げる。
    - `aiUsageMonthOf(new Date("2026-10-31T15:00:00.000Z"))` → `"2026-11"`。`(new Date("2026-10-31T14:59:59.999Z"))` → `"2026-10"`。`(new Date("2026-12-31T15:00:00.000Z"))` → `"2027-01"`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/study-log.test.ts tests/ai-usage.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 日付は `/^(\d{4})-(\d{2})-(\d{2})$/` のあと `Date.UTC` で作り、年・月・日が戻ることを確かめる（`src/domain/calendar/value-objects/log-date.ts` の `parseLogDate` と同じ確かめ方）。年は `2000`〜`9999`。
  - 日数は UTC の 0 時どうしの差を 1 日のミリ秒で割る。`(to - from) / DAY >= STUDY_LOG_MAX_DAYS` なら `null`（Go の `end.Sub(start) >= 93*24h`）。
  - 日本時間 0 時は `Date.UTC(y, m - 1, d) - 9 時間`。月の終わりは `Date.UTC(y, m, 1) - 9 時間`（13 月は JS が翌年 1 月にする）。
  - 各関数の上に、Go のどこにあたるかを英語のコメントで 1 行書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 学習ログの期間と AI の利用量の月を日本時間で決める`

### Task 2: 学習ログと AI の利用量を Prisma で読む

**Files:**

- Create: `src/infrastructure/prisma/study-log-store.ts`
- Modify: `src/infrastructure/prisma/ai-usage-store.ts`（`recordAiUsage` は変えない）
- Test: `tests/study-log-store.test.ts`、`tests/ai-usage-store.test.ts`（どちらも新規。純粋な部分だけ）

**Interfaces:**

- Consumes: `prisma()`（`src/infrastructure/prisma/prisma-client.ts`）、`Prisma`（`src/generated/prisma/client`）、`StudyDay`、`AiUsageTotal`。
- Produces:

  ```ts
  // study-log-store.ts
  // Pure: Go's StudyLog statement (store/study_log.go:25-40), with the day as
  // "YYYY-MM-DD" text. See 設計者の判断 1–2.
  export function studyLogSql(
    ownerId: string,
    start: Date,
    end: Date,
  ): Prisma.Sql;
  export type StudyDayRow = {
    date: string;
    reviews: bigint;
    practiceQuestions: bigint;
    notes: bigint;
    words: bigint;
  };
  // Pure: a row as the domain's StudyDay (bigint sums to numbers).
  export function studyDayFromRow(row: StudyDayRow): StudyDay;
  export function createStudyLogStore(db: () => PrismaClient): {
    // The owner's days with anything in [start, end), oldest first.
    days(ownerId: string, start: Date, end: Date): Promise<StudyDay[]>;
  };

  // ai-usage-store.ts (recordAiUsage stays as it is)
  // Pure: Go's AIUsageMonth statement (store/ai_usage.go:51-60).
  export function aiUsageMonthSql(from: Date, to: Date): Prisma.Sql;
  export type AiUsageTotalRow = {
    ownerId: string;
    displayName: string;
    feature: string;
    model: string;
    requests: bigint;
    inputTokens: bigint;
    outputTokens: bigint;
  };
  export function aiUsageTotalFromRow(row: AiUsageTotalRow): AiUsageTotal;
  export function createAiUsageStore(db: () => PrismaClient): {
    // Every owner's totals of the calls in [from, to), most tokens first.
    monthTotals(from: Date, to: Date): Promise<AiUsageTotal[]>;
  };
  ```

- 学習ログの SQL（`$1` などは `${ownerId}`・`${start}`・`${end}` の差し込み。5 つの副問い合わせのそれぞれに 3 つずつ）：

  ```sql
  SELECT to_char("day", 'YYYY-MM-DD') AS "date",
         sum("reviews") AS "reviews", sum("practice") AS "practiceQuestions",
         sum("notes") AS "notes", sum("words") AS "words"
    FROM (
      SELECT ("reviewedAt" + interval '9 hours')::date AS "day", 1 AS "reviews", 0 AS "practice", 0 AS "notes", 0 AS "words"
        FROM "ReviewLog" WHERE "ownerId" = ${ownerId} AND "reviewedAt" >= ${start} AND "reviewedAt" < ${end}
      UNION ALL
      SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
        FROM "PrepositionPracticeRecord" WHERE "ownerId" = … AND "createdAt" >= … AND "createdAt" < …
      UNION ALL
      SELECT ("createdAt" + interval '9 hours')::date, 0, "questionCount", 0, 0
        FROM "ComplementPracticeRecord" WHERE …
      UNION ALL
      SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 1, 0
        FROM "LearningEntry" WHERE "ownerId" = … AND "deletedAt" IS NULL AND "createdAt" >= … AND "createdAt" < …
      UNION ALL
      SELECT ("createdAt" + interval '9 hours')::date, 0, 0, 0, 1
        FROM "VocabularyEntry" WHERE …
    ) AS "activity"
   GROUP BY "day"
   ORDER BY "day"
  ```

- AI の利用量の SQL（アカウントの接頭辞は SQL の中の文字列。Go は値で渡していたが、同じ結果）：

  ```sql
  SELECT u."ownerId" AS "ownerId", coalesce(m."displayName", '') AS "displayName",
         u."feature" AS "feature", u."model" AS "model",
         count(*) AS "requests", sum(u."inputTokens") AS "inputTokens", sum(u."outputTokens") AS "outputTokens"
    FROM "AiUsage" u
    LEFT JOIN (SELECT 'password:' || p."id" AS "ownerId", p."displayName" FROM "PasswordAccount" p
               UNION ALL
               SELECT 'ffpf:' || f."id", f."displayName" FROM "FfpfAccount" f) m
           ON m."ownerId" = u."ownerId"
   WHERE u."createdAt" >= ${from} AND u."createdAt" < ${to}
   GROUP BY u."ownerId", m."displayName", u."feature", u."model"
   ORDER BY sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") DESC,
            u."ownerId", u."feature", u."model"
  ```

- [ ] **Step 1: 失敗するテストを書く。**（`tests/review-store.test.ts:60` と同じく、空白をつぶした `sql.sql` と `sql.values` を見る）
  - `tests/study-log-store.test.ts`：
    - `studyLogSql counts the five kinds as Go did`：`studyLogSql("password:a", start, end)`（`start = new Date("2026-10-26T15:00:00.000Z")`、`end = new Date("2026-12-06T15:00:00.000Z")`）。
      - 文が `FROM "ReviewLog" WHERE "ownerId" = $1 AND "reviewedAt" >= $2 AND "reviewedAt" < $3`、`FROM "PrepositionPracticeRecord"`、`FROM "ComplementPracticeRecord"`、`FROM "LearningEntry" WHERE "ownerId" = $10 AND "deletedAt" IS NULL AND "createdAt" >= $11 AND "createdAt" < $12`、`FROM "VocabularyEntry"`、`("reviewedAt" + interval '9 hours')::date`、`0, "questionCount", 0, 0`（2 回）、`GROUP BY "day" ORDER BY "day"`、`to_char("day", 'YYYY-MM-DD')` を含む。
      - `"deletedAt" IS NULL` は 1 回だけ。`AT TIME ZONE` を含まない。
      - `sql.values` は `["password:a", start, end]` を 5 回並べたもの（15 個）。
    - `studyDayFromRow turns the sums into numbers`：`{ date: "2026-11-02", reviews: 5n, practiceQuestions: 25n, notes: 1n, words: 2n }` → `{ date: "2026-11-02", reviews: 5, practiceQuestions: 25, notes: 1, words: 2 }`（Go の `TestStudyLog` の日）。
  - `tests/ai-usage-store.test.ts`：
    - `aiUsageMonthSql orders people by their tokens as Go did`：`aiUsageMonthSql(from, to)`（`2026-10-31T15:00:00.000Z`・`2026-11-30T15:00:00.000Z`）。
      - 文が `coalesce(m."displayName", '')`、`'password:' || p."id"`、`'ffpf:' || f."id"`、`LEFT JOIN`、`WHERE u."createdAt" >= $1 AND u."createdAt" < $2`、`GROUP BY u."ownerId", m."displayName", u."feature", u."model"`、`ORDER BY sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") DESC, u."ownerId", u."feature", u."model"` を含む。
      - `sql.values` は `[from, to]`。
    - `aiUsageTotalFromRow turns the sums into numbers`：Go の `TestAIUsageSummaryOfAMonth` の行（`password:a`・花子・`line`・`gpt-5-mini`・`3n`・`300n`・`120n`）→ 数の 3・300・120。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/study-log-store.test.ts tests/ai-usage-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `days`：`(await db().$queryRaw<StudyDayRow[]>(studyLogSql(…))).map(studyDayFromRow)`。
  - `monthTotals`：`(await db().$queryRaw<AiUsageTotalRow[]>(aiUsageMonthSql(…))).map(aiUsageTotalFromRow)`。
  - 先頭のコメントに、Prisma のクエリで書かないわけ（判断 1）、列が時差なしの UTC なので 9 時間を足すわけ（判断 2）、Go のどこと同じ結果か（参照 §1・§2）を書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 学習ログと AI の利用量を Prisma で読む`

### Task 3: application・container・ページを差し替える

**Files:**

- Create: `src/application/study-log/study-log-reader.ts`、`src/application/ai-usage/ai-usage-summary.ts`、`src/composition/ai-usage-container.ts`
- Modify: `src/composition/study-log-container.ts`、`src/composition/identity-container.ts`（`aiUsage` と `createAiUsageGateway` の import を消す）、`src/app/admin/ai-usage/page.tsx`、`tests/ai-usage.test.ts`（ゲートウェイのテストと、その 3 つの import を消す）
- Delete: `src/infrastructure/go-api/study-log-gateway.ts`、`src/infrastructure/go-api/ai-usage-gateway.ts`、`tests/go-api-study-log-gateway.test.ts`
- Test: `tests/study-log-reader.test.ts`、`tests/ai-usage-summary.test.ts`（どちらも新規）

**Interfaces:**

- Consumes: Task 1 の `studyLogRange`・`aiUsageMonthRange`・`aiUsageMonthOf`・`isAiUsageMonth`、Task 2 の `createStudyLogStore`・`createAiUsageStore`、`getCachedCurrentUser`。
- Produces:

  ```ts
  // study-log-reader.ts
  // The signed-in user has no study log: signed out, a guest, revoked or
  // without an owner id.
  export class StudyLogForbiddenError extends Error {
    override name = "StudyLogForbiddenError";
  }
  export type StudyLogReaderDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: {
      days(ownerId: string, start: Date, end: Date): Promise<StudyDay[]>;
    };
  };
  export function createStudyLogReader(deps: StudyLogReaderDeps): {
    // Japan dates from..to ("YYYY-MM-DD", both included) that have anything,
    // oldest first. RangeError when Go would have answered 400.
    list(from: string, to: string): Promise<StudyDay[]>;
  };

  // ai-usage-summary.ts
  // Only admins read the AI usage (an admin acting as a member included).
  export class AiUsageForbiddenError extends Error {
    override name = "AiUsageForbiddenError";
  }
  export type AiUsageSummaryDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: { monthTotals(from: Date, to: Date): Promise<AiUsageTotal[]> };
    now: () => Date;
  };
  export function createAiUsageSummary(deps: AiUsageSummaryDeps): {
    // month: "YYYY-MM" in Japan time; without it, the Japan month of now.
    // RangeError when it is not isAiUsageMonth.
    month(month?: string): Promise<AiUsageMonth>;
  };
  ```

  決まり：
  - `list`：`user` が無い・`isMemberRole(user.role)` でない・`githubId` が無い → `StudyLogForbiddenError` → `studyLogRange(from, to)` が `null` なら `RangeError`（store を呼ばない）→ `store.days(user.githubId, start, end)`。
  - `month`：`user?.role !== "admin"` → `AiUsageForbiddenError` → `month ?? aiUsageMonthOf(deps.now())`（`now` は 1 回）→ `isAiUsageMonth` でなければ `RangeError`（store を呼ばない）→ `{ month: その月, totals: await store.monthTotals(from, to) }`。

- [ ] **Step 1: 失敗するテストを書く。**（利用者は `tests/practice-records.test.ts:23-45` の `member`・`actingAdmin`・`demo` を写す。admin は `{ githubLogin: "octocat", githubId: "10001", role: "admin" }`）
  - `tests/study-log-reader.test.ts`：
    - `the study log is the signed-in owner's`：会員 → store に `"password:abc"` と `new Date("2026-10-26T15:00:00.000Z")`・`new Date("2026-12-06T15:00:00.000Z")`（`list("2026-10-27", "2026-12-06")`）が渡り、store の答えがそのまま返る。会員として操作している admin → `"password:abc"`（会員）。admin → `"10001"`。デモ → `"demo:1"`。
    - `others have no study log`：`null`・ゲスト（`{ githubLogin: "guest", githubId: "guest", role: "guest" }`）・`revoked`・`githubId` の無い会員 → `StudyLogForbiddenError`、store は呼ばれない。ゲストに不正な期間を渡しても `StudyLogForbiddenError`（だれかが先）。
    - `a range Go refused never reaches the store`：会員で `("2026-01-01", "2026-04-04")` と `("2026-11-1", "2026-11-30")` → `RangeError`、store は呼ばれない。
  - `tests/ai-usage-summary.test.ts`：
    - `only admins read the AI usage`：admin・会員として操作している admin → 読める。会員・デモ・ゲスト・`null` → `AiUsageForbiddenError`、store は呼ばれない。
    - `a month is read as Japan time`：`month("2026-09")` → store に `2026-08-31T15:00:00.000Z`・`2026-09-30T15:00:00.000Z`、答えは `{ month: "2026-09", totals: <store の答え> }`。`now` が `2026-10-31T15:00:00.000Z` で `month()` → `"2026-11"`、`2026-10-31T15:00:00.000Z`・`2026-11-30T15:00:00.000Z`、`totals: []` のときも `[]`。
    - `a bad month never reaches the store`：Go の `TestAIUsageSummaryRejectsABadMonth` の 6 つ（`2026-13`・`2026-00`・`2026-1`・`202611`・`1999-12`・`x`）→ `RangeError`、store は呼ばれない。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/study-log-reader.test.ts tests/ai-usage-summary.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `study-log-container.ts`：

    ```ts
    // The study log, read in the database as the signed-in user.
    export const studyLog = createStudyLogReader({
      currentUser: getCachedCurrentUser,
      store: createStudyLogStore(prisma),
    });
    ```

  - `ai-usage-container.ts`：`export const aiUsage = createAiUsageSummary({ currentUser: getCachedCurrentUser, store: createAiUsageStore(prisma), now: () => new Date() });`（コメント「The admin's monthly summary of OpenAI usage, read in the database.」）。
  - `/study-log` のページは変えない（`studyLog.list` の名前と形が同じ。`loadOr` がそのまま失敗を注意にする）。
  - `/admin/ai-usage`（判断 5）：`aiUsage` を `@/composition/ai-usage-container` から import。`const usage = await loadOr("AI_USAGE_UNAVAILABLE", () => aiUsage.month(month), null);`。注意の文言を `利用量を読めませんでした。時間をおいてもう一度お試しください。` に。ほかは変えない。
  - `src/domain/study-log/study-log.ts` の `StudyDay` のコメントの「as the Go API counts it」を「as the web counts it from the database」に。`summarizeAiUsage` のコメントの「Go's order」を「the store's order」に。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS（`tests/architecture.test.ts` を含む）。
  - `grep -rn "study-log-gateway\|ai-usage-gateway\|/v1/study-log\|/v1/admin/ai-usage\|Go API が最新" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): 学習ログと AI の利用量を Go に頼まずに読む`

### Task 4: Go の 2 つのルートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §5・§6・§7 に従う）：
  - 消す：`httpapi/study_log_handlers.go`、`httpapi/study_log_handlers_test.go`、`httpapi/ai_usage_handlers.go`、`httpapi/ai_usage_handlers_test.go`、`store/study_log.go`、`store/study_log_test.go`、`store/daily.go`。
  - `store/ai_usage.go`：`AIUsageTotal`（:21-31）、`AIUsageMonth`（:45-80）、`jst` の import を消す。`AIUsage` と `RecordAIUsage` のコメントに「LINE records its calls with it; the web writes and reads the other rows.」を足す。
  - `router.go`：`Deps.StudyLog`・`AIUsage` とそのコメント（:94-98）、`r.studyLogRoutes()`（:153）と `studyLogRoutes`（:291-296）、`adminRoutes` の `AIUsage` の分岐（:286-288）を消す。`adminRoutes` のコメントを「adminRoutes are member management (passwords are hashed with the shared scrypt semaphore and are never logged).」にする。
  - `respond.go`：`msgInvalidMonth`（:22）と `msgStudyLogInvalid`（:50）を消す。
  - `main.go`：`StudyLog: db,`・`AIUsage: db,`（:168-169）を消す。
  - `store/testhelpers_test.go`：`prepositionRecord`（:281-293）・`complementRecord`（:295-308）・`saveRound`（:310-330）を消す（使われなくなる import も）。
- テストの書き直し（判断 9）：
  - `httpapi/demo_test.go`：`allRoutesDeps`（:41-48）から `StudyLog`・`AIUsage` を消す。`TestDemoKeepsItsOwnRecords`（:96-122）を `TestDemoIsRefusedTheMemberDirectory` にし、`fakeStudyLog` と学習ログの確かめを消す（コメントは「The member directory is closed to the demo and open to a normal member.」）。
  - `httpapi/router_test.go:24`：`AIUsage: &fakeAIUsage{}` を消す。
  - `demo/demo_db_test.go:62-72`：`logDate` と `s.StudyLog` を、次の数え方に替える（`jst` の import を消す）。

    ```go
    // The seed has activity on most of the last seven Japan days.
    days := countRows(t, url, `SELECT count(DISTINCT ("at" + interval '9 hours')::date) FROM (
      SELECT "createdAt" AS "at" FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL
      UNION ALL SELECT "createdAt" FROM "VocabularyEntry" WHERE "ownerId" = $1
      UNION ALL SELECT "createdAt" FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1
      UNION ALL SELECT "createdAt" FROM "ComplementPracticeRecord" WHERE "ownerId" = $1
      UNION ALL SELECT "reviewedAt" FROM "ReviewLog" WHERE "ownerId" = $1) AS "activity"
      WHERE "at" >= $2`, owner, now.AddDate(0, 0, -8).UTC())
    if days < 5 {
      t.Fatalf("activity on %d days; want most of the last 7", days)
    }
    ```

  - `store/ai_usage_test.go`：`onlyOwners` と `TestAIUsageMonthAddsUpByOwnerFeatureAndModel` を消し、`TestRecordAIUsageStoresOneCall` を書く：`aiUsageOwner` の持ち主に `RecordAIUsage(ctx, AIUsage{OwnerID, Feature: "line", Model: "gpt-5-mini", InputTokens: 100, OutputTokens: 50}, at)`（`at = time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)`）→ `countRows(t, s, `SELECT count(*) FROM "AiUsage" WHERE "ownerId" = $1 AND "feature" = 'line' AND "model" = 'gpt-5-mini' AND "inputTokens" = 100 AND "outputTokens" = 50 AND "createdAt" = $2`, owner, at) == 1`。
- Modify（docs-site。段階 1〜7 と同じ扱い）：
  - `docs-site/reference/study-log.md` を消し、`docs-site/.vuepress/config.ts:33` のナビから外す。
  - `docs-site/reference/README.md:30`・`:34` の 2 行を消す。
  - `docs-site/reference/admin.md`：`:3` の「と、AI の利用量を月ごとに見るルート」を消し、`## GET /v1/admin/ai-usage`（:128）からその節の終わり（エラーの表）までを消す。
  - `docs-site/README.md`：`:24` の「学習の記録、」を消す。`:27` の「、学習の記録など」を消し、Web が Prisma で直接扱うものの列の最後に「学習ログ（カレンダー）、AI の利用量の集計」を足す。
  - `docs-site/operations/local.md:58`：`/v1/study-log` の行を `curl -s "$API_LOCAL_URL/v1/me" -H "Authorization: Bearer $TOKEN" | jq` にする（デモでログインしているので、残るルートで読めるのは `/v1/me`）。
- Modify：`e2e/study-log.spec.ts`、`e2e/act-as.spec.ts`、`e2e/demo.spec.ts`。Create：`e2e/ai-usage.spec.ts`。

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
  - `grep -rn "study-log\|ai-usage\|StudyLog\|StudyDay\|LogDate\|jstDay\|AIUsageMonth\|AIUsageTotal\|fakeAIUsage\|msgStudyLogInvalid\|msgInvalidMonth\|parseMonth\|saveRound" services/api` → 何も出ない。`grep -rn "RecordAIUsage" services/api` には `store/ai_usage.go`・`store/ai_usage_test.go`・`linebot/` が残る。
- [ ] **Step 2: 足りない e2e を足す（判断 10）。**
  - `e2e/study-log.spec.ts`：`the study log counts each kind by Japan day, the owner's only`
    - `createMember` で太郎（`taro`）と次郎（`jiro`）。太郎の持ち主 `memberOwnerId(id)` に、SQL で直接入れる（時刻は UTC。fixture は `SET TIME ZONE 'UTC'`）：
      - `seedNotes`：`2026-10-31 14:59:59.999`（日本時間 10 月 31 日）、`2026-10-31 15:00:00`（11 月 1 日）、`2026-10-31 15:00:00` をもう 1 つ入れて `"deletedAt" = '2026-11-01 00:00:00'` にする（ゴミ箱）。
      - `PrepositionPracticeRecord`（`id` は `randomUUID()`、`questionCount` 3、`firstTryCount` 3、`missCount` 0、`elapsedMs` 1000、`questions` `'[]'`、`startedAt` と `createdAt` は `2026-10-31 15:30:00`）。
      - `ComplementPracticeRecord`（`mode` `'result'`、`questionCount` 2、ほかは同じ形、`2026-11-01 16:00:00` = 11 月 2 日 01:00）。
      - `VocabularyEntry`（`language` `'zh'`、`word` `'认真'`、`pinyin` `'rènzhēn'`、`meaning` `'まじめに'`、`createdAt`・`updatedAt` `2026-11-01 15:00:00`）。
      - `ReviewItem`（`kind` `'vocabulary'`、`targetId` はその単語の id、`due` `2026-11-01 15:00:00`、`updatedAt`）と `ReviewLog`（`rating` 3、`state` 0、`due`、`stability` 0、`difficulty` 0、`scheduledDays` 0、`reviewedAt` `2026-11-01 15:00:00`）。
      - 次郎の持ち主に `seedNotes` で `2026-10-31 15:00:00` のノートを 3 つ。
    - 太郎でログインし `/study-log?month=2026-10`：`この月の合計` に「学習した日1日」と「ノート1件」、`gridcell` `2026-10-31：ノート1件` が見える。
    - `/study-log?month=2026-11`：合計に「学習した日2日」「復習1回」「練習5問」「ノート1件」「単語1語」。`gridcell` `2026-11-01：練習3問・ノート1件` と `2026-11-02：復習1回・練習2問・単語1語`。`[data-date="2026-11-03"]` の `data-total` は `0`。
  - `e2e/act-as.spec.ts`：`an admin acting as a member reads the member's study log`
    - 会員（`test01`）に `seedNotes` で今のノートを 1 つ入れる。admin で会員として操作し `/study-log` → 合計に「ノート1件」。
    - 「管理者に戻る」のあと `/study-log` → 合計に「学習した日0日」。
  - `e2e/ai-usage.spec.ts`（新規）：
    - `the admin reads a Japan month of AI usage, most tokens first`：`createMember` で花子（`hanako`、表示名 `花子`）。`AiUsage` に SQL で入れる（`id` は `randomUUID()`）：
      - 花子 `line`・`gpt-5-mini`・100/50・`2026-10-31 15:00:00`。
      - 花子 `line`・`gpt-5-mini`・200/60・`2026-11-30 14:59:59.999`。
      - 花子 `chat`・`gpt-5`・10/5・`2026-10-31 15:00:00`。
      - 花子 `line`・`gpt-5-mini`・9999/9999・`2026-10-31 14:59:59.999`（10 月）。
      - admin（`adminOwnerId`）`chat`・`gpt-5`・5000/1000・`2026-11-15 00:00:00`。
    - `asAdmin` → `/admin/ai-usage?month=2026-11`：「2026年11月」、「2人が 4 回使いました。」。
      - 1 つ目の `tbody` の最初の行は「管理者」「10001」「1」「5,000」「1,000」。
      - 2 つ目の `tbody`：人の行は「花子」「3」「310」「115」、続く行は「ChatGPT と話す gpt-5」「1」、「LINE の添削・翻訳 gpt-5-mini」「2」「300」「110」の順。
      - `tfoot` は「合計」「4」「5,310」「1,115」。
    - 「← 前の月」→ URL の `month=2026-10`、「1人が 1 回使いました。」、「9,999」。
    - `members are sent home from the AI usage`：花子でログインして `/admin/ai-usage` → `pathname === "/"`。
  - `e2e/demo.spec.ts:28` の最後（「デモを終える」の前）：`/study-log` を開き、見出し「学習ログ」が見え、「処理できませんでした。時間をおいてもう一度お試しください。」が無い（デモは自分の学習ログを読める）。
  - 既存の `e2e/study-log.spec.ts` の 2 本、`act-as.spec.ts`・`demo.spec.ts`・`bottom-navigation.spec.ts` は、ほかを変えずに通ること。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。`study-log`・`ai-usage`・`act-as`・`demo`・`review`・`vocabulary` を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の学習ログと AI の利用量のルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`docs/api-local.md`、`README.md`

- [ ] **Step 1: 直す。**
  - `docs/features.md:7`：最後に「集計は Web が DB から直接読みます。」を足す（記録の分担はそのまま）。
  - `docs/architecture.md:43`：Prisma で読み書きするものの列に「学習ログ（カレンダー）と AI の利用量の集計（読むだけ）」を足す。
  - `docs/api-local.md:56`：`docs-site/operations/local.md:58` と同じく `/v1/me` の行にする。
  - `docs/api-deployment.md`：「段階7（チャット）のマージの前と後」のあとに、「段階8（学習ログ・AI の利用量）のマージの前と後」を足す（段階 7 と同じ形）。
    - はじめの段落：学習ログ（日本時間の日ごとの復習・練習・ノート・単語の数）と管理者の AI の利用量（日本時間の月ごとの集計）を Web に移した変更。どちらも読むだけで、Web が Prisma で Go と同じ SQL を流す。Go の `/v1/study-log` と `/v1/admin/ai-usage` はなくなった。Go に残るのは、LINE（LINE の分の `AiUsage` の記録を含む）、フォローとタイムライン、会員の管理、パスワード変更、ログイン、Cron。
    - マージの前：
      - この段階で必須の環境変数も、マイグレーションもない（表はすべてある。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS` で決めている）。
    - マージのあと：
      1. Web の Production のデプロイが Ready になったことを確かめる。
      2. `vercel promote` で切り替える。
      3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/study-log` と `/v1/admin/ai-usage` が本番の Go から消える。
      4. 本番で、学習ログ（会員）と「AI 利用量」（管理者）を 1 回ずつ開いて、数が出ることを確かめる。
    - 切り替えのあいだ：どちらも読むだけなので、古い Go と新しい Web が同時に動いても DB は変わらない。LINE の利用量は今までどおり Go が同じ表に書き、Web の集計に出る。
    - 戻すとき：
      - Go だけを戻しても害はない。
      - Go を再デプロイしたあとで Web だけを戻すと、古い Web が 2 つのルートを呼んで `404` になる。学習ログは「処理できませんでした。時間をおいてもう一度お試しください。」、AI 利用量は「利用量を読めませんでした。Go API が最新かを確認してください。」になる。
      - Web を戻すなら Go も戻す。いっしょに戻すのがいちばん安全。
  - `README.md:33`：Go の受け持ちから「学習ログ、」を外し、括弧を「（クイック質問・質問ノート・ChatGPT と話す・会話ノート・学習ログ・AI の利用量の集計は Web に移りました）」にする。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。`grep -rn "/v1/study-log\|/v1/admin/ai-usage" docs README.md docs-site --include='*.md' --include='*.ts'`（`docs/releases/` と `docs/superpowers/` を除く）で、何も出ないことを確かめる。
- [ ] **Step 3: コミット。** `docs: 学習ログと AI の利用量を Web に移したことを書く`
