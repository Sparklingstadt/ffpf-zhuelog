# Go 廃止 段階 3（CSV の取り込み）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学習ノートの CSV の取り込み（`POST /v1/imports/csv`）を、Go API から Next.js（Prisma）に移し、Go の該当コードを消す。

**Architecture:** 段階 2 と同じ形にする。

- CSV の検証と解析は、I/O の無い純粋な関数として `src/infrastructure/csv/learning-csv.ts` に置く。
- DB への書き込み（1 つのトランザクション）は `src/infrastructure/prisma/learning-csv-import.ts` に置く。
- 持ち主の決定とエラーの扱いは `src/application/learning/learning-notes.ts` の `importCsv` に置く。
- `src/composition/learning-container.ts` の `learningNotes.importCsv` を、Go のゲートウェイから新しい実装に差し替える。Go に残るのは `isInReview`・`setInReview`（段階 4）だけになる。
- 画面（`/import`・`csv-import-form.tsx`）と Server Action の名前は変えない。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7、`csv-parse@7`、`node:test` + `tsx`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 3、決めたこと 7〜9）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage3-go-reference.md`（以下「参照」）。確かめる順番・文言・解析の規則・DB の形・Go に残すべきコードが、file:line 付きで書いてある。

## 設計者の判断（コントローラーが確かめ、1・3〜5 はそのまま、2 は直した）

1. **`csv-parse@^7.0.3` を依存に戻す**（「依存を増やさない」の例外）。Go の `csvimport` は、もともと Web が使っていた csv-parse の動きを手で写したもの（約 200 行の状態機械）で、`expected.json` も csv-parse の出力から作られている。TypeScript で状態機械をもう一度写すより、元のライブラリを使うほうが読みやすく、fixture との一致も確実なため（設計のアンチゴール「1 行ずつ写しただけ」を避ける）。認めないときは、Task 1 で `parse.go:247-380` を TypeScript に写し、同じ fixture で確かめる。
2. **解析は `src/infrastructure/csv/learning-csv.ts` に置き、application には関数として渡す。**（コントローラーの決定）domain と application は npm を import しない、という今の形を守るため。I/O の無い純粋な関数で、unit テストはそのまま書ける。
3. **デモのアカウントも取り込める**（Go と同じ。Go のルートは `notForDemo` ではない）。管理者の「メンバーとして見る」では、その会員のノートに入る（Go と同じ）。
4. **ファイルの大きさは Web で確かめ、Next の `bodySizeLimit: "4.5mb"` はそのまま残す。** Go の 4 分のアップロードの期限に当たるものは作らない（ファイルは Server Action が呼ばれる前に受け取り終わっている）。`maxDuration` も足さない。
5. **Go の store のテスト用の `createBatch` は、`CreateImportBatch` を消したあと `queueImportBatch` + `execBatch` で書き直して残す**（demo・review・follows・study_log のテストが使うため）。`CreateImportBatch` のテスト 4 本は消す（同じことを Task 2 の unit テストと Task 4 の e2e で確かめる）。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Server Action の `FormData` と `File`、`serverActions.bodySizeLimit`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。増やす依存は `csv-parse` だけ（設計者の判断 1）。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。
- **CSV の中身はログに出さない**（Go の `TestImportCSVHandlerNeverLogsContents` と同じ）。失敗のログは `CSV_IMPORT_FAILED` とエラーの名前だけ。
- 持ち主（参照 §0）：常に今の利用者の `githubId`（管理者が「メンバーとして見る」ときは、その会員の ownerId）。フォームの `user` などは読まない。未ログイン・ゲスト・revoked・`githubId` なしは `LearningForbiddenError`。デモは取り込める。
- 確かめる順番と文言（参照 §1。最初に当たったものだけを出す）：
  1. `csvFile` が `File` でない、または 0 バイト → `CSVファイルを選択してください。`
  2. 4,194,304 バイトより大きい（ちょうど 4 MiB は通る）→ `ファイルは4MB以下にしてください。`
  3. `name.toLowerCase().endsWith(".csv")` でない → `拡張子が.csvのファイルを選択してください。`
  4. CSV の中身（下の解析の規則）
  5. ファイル名に NUL → 形式のエラーの文言
- 解析の規則（参照 §2）：
  - 文字列は `await file.text()` で得る（BOM を 1 つ落とし、不正な UTF-8 を U+FFFD にする）。
  - `parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true, max_record_size: 100_000, to: 1002 })`。csv-parse が投げたら、どのエラーでも形式のエラー。
  - レコードが 0 件 → `CSVにデータ行がありません。`
  - 1 件目が見出しなら飛ばす。見出しかどうかは、先頭 3 列を `trim()`・`replaceAll(" ", "")`・`toLowerCase()` して比べる。
    - 1 列目：`最初の文`・`原文`・`original`
    - 2 列目：`添削後の文`・`添削文`・`corrected`
    - 3 列目：`ピンイン`・`ピン音`・`拼音`・`pinyin`
  - データ行が 0 件 → `CSVにデータ行がありません。`。1000 件より多い → `一度にインポートできるのは1000件までです。`（行ごとの確かめより先）。
  - 行ごと（`n` = レコードの番号 + 見出しの分 + 1。物理的な行番号ではない）：
    - 3 列未満 → `{n}行目は3列未満です。`
    - 103 列より多い、またはどれかの列が 10,000（JS の `length`）より長い → `{n}行目は上限（各項目1万文字・ヒント100列）を超えています。`
    - 各列を `trim()` し、先頭 3 列のどれかが空 → `{n}行目の「最初の文」「添削後の文」「ピンイン」は必須です。`
    - ヒントは 4 列目以降の空でない列を、順に並べたもの。
  - すべての行が通ったあとで、どれかの文字列に NUL（U+0000）→ 形式のエラー。
  - 形式のエラーの文言：`CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。`
- 保存（参照 §3）：
  - 1 つのトランザクションで、すべて入るか何も入らないかにする。
  - `ImportBatch`：`fileName` は `name.slice(0, 255)`、`rowCount` は件数、`importedAt` は `now`（ミリ秒に切り詰める）。
  - `LearningEntry` の i 件目（0 から）：`kind: "correction"`、`createdAt = now + i ms`、`ownerId`、`batchId`。
  - `Hint`：`position` は 0 から。
  - id はすべて `newId()`（`src/infrastructure/prisma/new-id.ts`）。`ReviewItem` は作らない。
- 成功の文言：`${count}件の学習文を登録しました。`。成功したら `revalidateNotes()`。
- エラーの扱い：
  - 未ログイン・ゲスト・revoked（`getMember()` が null）→ `この操作を行う権限がありません。再度ログインしてください。`（今の controller のまま）
  - `githubId` なし → `一度ログアウトしてログインし直してください。`
  - 上の検証のエラー → その文言。
  - `LearningForbiddenError` → `actionUnauthorized`。
  - DB の失敗 → `処理できませんでした。時間をおいてもう一度お試しください。`
  - Next の `redirect` は投げ直す（`attemptGoAction` のまま）。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。
- `git commit` と `git push`、`pnpm add` は、サンドボックスの外で行う。

## Review Focus

1. **csv-parse と Go の結果が同じか。** 43 個の fixture のすべてで、ノートか文言が `expected.json` と一致する。→ Task 1 のテスト `matches every fixture the Go parser was checked against`。
2. **確かめる順番。** 1001 行は行のエラーより先、行のエラーは NUL より先、4 MiB を超えたら拡張子より先。行番号は物理的な行ではなくレコードで数える。→ Task 1 のテスト `checks run in Go's order` と `numbers rows by record, not by line`。
3. **持ち主。** 管理者が「メンバーとして見る」ときは会員のノートに入る。フォームの `user` は無視する。ゲストは取り込めない。→ Task 3 のテスト `imports into the signed-in owner only`、Task 4 の e2e `an admin acting as a member imports into the member's notes`。
4. **DB の形と、全部か無しか。** `createdAt` が 1 ms ずつずれる。ヒントの `position` が 0 から。途中で失敗したら何も残らない。→ Task 2 のテスト `importRows spaces notes 1 ms apart in input order`、Task 4 の e2e `an admin acting as a member imports into the member's notes`（DB を読む）と、既存の `learning.spec.ts:164`（invalid CSV writes nothing）。
5. **いちばん大きい取り込み。** 1000 行 × ヒント 100 個（ヒント 10 万行）が、パラメータの上限を超えずに 1 回で入る。→ Task 2 のテスト `chunks keep every hint in order`、Task 4 の e2e `imports 1000 notes with 100 hints each`。

---

### Task 1: CSV の検証と解析（純粋な関数）

**Files:**

- Modify: `package.json`、`pnpm-lock.yaml`（`pnpm add csv-parse@^7.0.3`）
- Create: `src/infrastructure/csv/learning-csv.ts`
- Create: `tests/fixtures/learning-csv/`（`services/api/csvimport/testdata/` の `*.csv` 43 個と `expected.json` をそのまま写す。Go 側は Task 4 で消す）
- Test: `tests/learning-csv.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // The message is meant for the user and is shown as it is.
  export class CsvValidationError extends Error {}
  export type LearningCsvDraft = {
    originalText: string;
    correctedText: string;
    pinyin: string;
    hints: string[]; // non-empty, in column order
  };
  export const MAX_CSV_FILE_BYTES = 4 * 1024 * 1024;
  // Steps 1-3 of the order in Global Constraints; null when the file may be read.
  export function checkCsvFile(file: {
    name: string;
    size: number;
  }): string | null;
  // Throws CsvValidationError with the exact message.
  export function parseLearningCsv(text: string): LearningCsvDraft[];
  // name.slice(0, 255); throws CsvValidationError (format message) on NUL.
  export function importFileName(name: string): string;
  ```

- [ ] **Step 1: 失敗するテストを書く。** Go の `parse_test.go` を写す。
  - `matches every fixture the Go parser was checked against`：
    - fixture の数と `expected.json` の数が同じ。
    - 各 fixture は `new Blob([bytes]).text()` で文字列にし、`parseLearningCsv` の結果（`entries` と同じ形）か `CsvValidationError` の文言（`error`）が一致する。
  - `enforces the row, cell and column limits`：`TestParseLimits` の表をすべて写す。見出しが `ピンイン` だけの CSV → データ行が無い、も含む。
  - `checks run in Go's order`：
    - 1001 行の 1 行目が 2 列 → 1000 件の文言。
    - `a\0,b,c\nd,e` → `2行目は3列未満です。`
    - NUL がセル・ヒント・後ろの行にある → 形式のエラー（`TestParseRejectsNUL`）。
  - `numbers rows by record, not by line`：空行と、改行を含む引用のレコードのあとのエラーの行番号（`blank_line_numbering.csv` と同じ考え方の短い例）。
  - `reads back what the export writes`：
    - `src/presentation/presenters/learning-csv-export.ts` で、引用符・カンマ・改行・ヒント 2 個を含むノートを書き出す。
    - BOM を付けた文字列を `parseLearningCsv` に渡すと、同じ中身に戻る。
  - `checkCsvFile`：
    - 0 バイト → 選択の文言。
    - 4 MiB ちょうどで `a.csv` → `null`。4 MiB + 1 で `a.txt` → 大きさの文言。
    - `Notes.CSV` → `null`。`a.csv.txt`・`acsv` → 拡張子の文言。
  - `importFileName`：`"字".repeat(300)` → 255 文字。`"a\0.csv"` → 形式のエラー。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-csv.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `git show 60e05a6^:src/infrastructure/csv/csv-parse-learning-parser.ts` の形に、Go で足された 2 つを加える。
    - 見出しの `ピンイン`。
    - 最後の NUL の確かめ。
  - 文言は定数にまとめる。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。`pnpm typecheck`、`pnpm lint` も PASS。
- [ ] **Step 5: コミット。** `feat(web): CSV の検証と解析を Web で行う`

### Task 2: 取り込みの書き込み（1 つのトランザクション）

**Files:**

- Create: `src/infrastructure/prisma/learning-csv-import.ts`
- Test: `tests/learning-csv-rows.test.ts`（純粋な部分だけ。DB の動きは Task 4 の e2e）

**Interfaces:**

- Consumes: `LearningCsvDraft`（Task 1）、`newId`、`prisma()`。
- Produces:

  ```ts
  // Pure: the rows one import inserts. Entry i is created at now + i ms so
  // that (createdAt, id) order follows the file; hints are numbered from 0.
  export function importRows(
    ownerId: string,
    fileName: string,
    drafts: LearningCsvDraft[],
    now: Date,
    id: () => string,
  ): {
    batch: { id: string; fileName: string; rowCount: number; importedAt: Date };
    entries: {
      id: string;
      kind: "correction";
      originalText: string;
      correctedText: string;
      pinyin: string;
      createdAt: Date;
      ownerId: string;
      batchId: string;
    }[];
    hints: {
      id: string;
      content: string;
      position: number;
      learningEntryId: string;
    }[];
  };
  export function chunks<T>(items: T[], size: number): T[][]; // pure
  export function createLearningCsvImport(
    db: () => PrismaClient,
    now: () => Date = () => new Date(),
    id: () => string = newId,
  ): {
    // Stores the drafts as one batch in one transaction; returns how many notes.
    importBatch(
      ownerId: string,
      fileName: string,
      drafts: LearningCsvDraft[],
    ): Promise<number>;
  };
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `importRows spaces notes 1 ms apart in input order`：
    - 3 件を `2026-11-16T00:00:00.000Z` で作る。
    - 3 件の `createdAt` は `.000`・`.001`・`.002`。
    - `importedAt` は `now`、`rowCount` は 3、`kind` はすべて `correction`。
    - すべての `batchId` が `batch.id` と同じ。id はすべて別。
  - `numbers each note's hints from 0`：ヒント 2 個と 0 個のノート → position は 0・1。ヒントの `learningEntryId` は、それぞれのノート。
  - `truncates now to milliseconds`：`now` は Date なので、そのままでよいことを確かめる（Go の `dbTime` と同じ結果）。
  - `chunks keep every hint in order`：100,000 件を 5,000 ずつ → 20 個。つなげると元と同じ。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-csv-rows.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `db().$transaction([...])`（配列の形。対話型にしない）で、次の順に送る。
    1. `importBatch.create`
    2. `learningEntry.createMany`（1000 件 × 8 列は 1 回で入る）
    3. `hint.createMany` を 5,000 件ずつ（4 列 × 5,000 = 20,000 個のパラメータ。Postgres の上限 65,535 より小さい。Prisma が自分で分けるかに頼らない）
  - 時刻は `now()` を 1 回だけ取る。
  - 定数 `HINT_CHUNK = 5_000` に、そのわけをコメントで書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck` で PASS。
- [ ] **Step 5: コミット。** `feat(web): CSV の取り込みを Prisma で保存する`

### Task 3: `learningNotes.importCsv` を差し替え、画面につなぐ

**Files:**

- Modify: `src/application/learning/learning-notes.ts`（`importCsv` と依存 `csvImport` を足す）
- Modify: `src/composition/learning-container.ts`（`importCsv` を新しい実装にする。Go に残るのは `isInReview`・`setInReview` だけ）
- Modify: `src/presentation/controllers/learning-csv-import-controller.ts`、`src/presentation/actions/import-learning-csv-action.ts`（呼び方が変わるなら）
- Modify: `src/infrastructure/go-api/learning-gateway.ts`（`importCsv` と `upload` の引数を消す）、`src/infrastructure/go-api/authed.ts`・`client.ts`（`goUpload`・`goUploadAuthed`・`GoUploadCall`・`UPLOAD_TIMEOUT_MS` を消す）
- Modify: `src/presentation/controllers/action-state.ts`（`userFacingCodes` から `invalid_csv` を消す。`too_large` は、ほかに使うところが無ければ消す）
- Test: `tests/learning-notes.test.ts`（足す）、`tests/learning-csv-import.test.ts`（書き直す）、`tests/go-api-learning-gateway.test.ts`・`tests/go-api-client.test.ts`（消したものの部分を消す）

**Interfaces:**

- Consumes: Task 1 の `checkCsvFile`・`parseLearningCsv`・`importFileName`・`CsvValidationError`、Task 2 の `createLearningCsvImport`。
- Produces:

  ```ts
  // learning-notes.ts
  export type CsvImportResult =
    | { ok: true; count: number }
    | { ok: false; message: string }; // a CsvValidationError's message
  // added to LearningNotesDeps
  csvImport: {
    importBatch(ownerId: string, fileName: string, drafts: LearningCsvDraft[]): Promise<number>;
  };
  // added to the object createLearningNotes returns
  importCsv(file: { name: string; size: number; text(): Promise<string> }): Promise<CsvImportResult>;
  ```

  `importCsv` は、次の順に行う。
  1. `own()`（`LearningForbiddenError` を投げうる）
  2. `checkCsvFile`
  3. `file.text()`
  4. `parseLearningCsv`
  5. `importFileName`
  6. `importBatch`

  `CsvValidationError` だけを `{ ok: false }` にする。ほかは投げる。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/learning-notes.test.ts`：
    - `imports into the signed-in owner only`：
      - 会員 → その ownerId。
      - 会員として見ている管理者 → 会員の ownerId。
      - デモの会員 → 取り込める（`importBatch` が呼ばれる）。
      - 未ログイン・ゲスト・revoked・`githubId` なし → `LearningForbiddenError`、`importBatch` は呼ばれない。
    - `returns the CSV's problem without writing`：
      - 2 列だけの CSV → `{ ok: false, message: "1行目は3列未満です。" }`。
      - `a.txt` → 拡張子の文言。
      - どちらも `importBatch` は呼ばれない。
    - `passes the cut file name and the drafts`：300 文字の名前 → 255 文字。戻りは `{ ok: true, count }`。
  - `tests/learning-csv-import.test.ts`（controller）：
    - `getMember` が null → 権限の文言。`githubId` なし → ログインし直しの文言。`csvFile` が無い・文字列 → 選択の文言。この 3 つでは `importCsv` を呼ばない。
    - フォームの `user` を渡さない（`importCsv` には `File` だけが渡る）。
    - `{ ok: false, message }` → その文言。`{ ok: true, count: 2 }` → `2件の学習文を登録しました。`。
    - `LearningForbiddenError` → `ログインし直してください。`。
    - ふつうの `Error`（DB の失敗）→ 一般的な文言。ログは `CSV_IMPORT_FAILED` とエラーの名前だけ（CSV の中身が出ないことを確かめる）。
    - `redirect` は投げ直す。
    - Go 向けのテスト（「size and extension left to Go」「Go's message for invalid_csv」）は消す。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/learning-notes.test.ts tests/learning-csv-import.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - controller は、今の 1・2 の確かめを残す。3 は「`File` でない」だけを controller で見て、0 バイトは `checkCsvFile` に任せてよい（文言は同じ）。
  - `attemptGoAction("CSV_IMPORT_FAILED", …)` の中で `importCsv` を呼ぶ。
  - `learning-container.ts` のコメントを、Go に残るのが復習の 2 つだけになったことに合わせて直す。
- [ ] **Step 4: 確かめる。** `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。`grep -rn "goUpload\|imports/csv" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): CSV の取り込みを Go に頼まずに行う`

### Task 4: Go の CSV の取り込みを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §7 の「Becomes dead」と §6 の「keep」に従う）：
  - `services/api/csvimport/`（すべて）、`httpapi/import_handlers.go`・`import_handlers_test.go`
  - `router.go` の `entryRoutes`・`Entries`・`Deps.Entries`・`_ Entries`、`main.go:163`
  - `entry_handlers.go` の `batchJSON`・`toBatchJSON`、`entry_handlers_test.go` の `fakeEntries`、`router_test.go`・`demo_test.go` の `Entries: &fakeEntries{}`
  - `middleware.go` の `limitBody` の CSV の分岐（コメントも 1 MiB だけに直す）
  - `respond.go` の `msgSelectCSVFile`・`msgCSVFileTooLarge`・`msgCSVExtension`・`codeInvalidCSV`
  - `store/entries.go` の `CreateImportBatch`、`store/entries_test.go` の `TestCreateImportBatch*` 4 本（`TestReadsWebCreatedEntry` は残す）
  - `store/testhelpers_test.go` の `createBatch` を `pgx.BeginFunc` + `queueImportBatch` + `execBatch` で書き直す（設計者の判断 5）
  - `jsstr.Truncate` とそのテスト
  - `httpapi/line_handlers.go:52` のコメント（`extendCSVDeadlines` を指さないように直す）
- Keep：`queueImportBatch`・`queueHints`・`execBatch`・`Batch`・`Entry`・`EntryDraft`（LINE とデモのリセットが使う。段階 10 まで）。
- Modify：
  - `docs-site/reference/entries.md` を消し、`docs-site/.vuepress/config.ts:31` のナビから外す。
  - `docs-site/reference/README.md:19` の行と、`:63-64` の CSV の例外の記述を消す。
  - `docs-site/operations/deploy.md:222-226` の CSV の記述を消す。
  - 段階 1・2 と同じ扱いにする。
- Modify：`e2e/` にテストを足す（下の Step 2）

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功。DB を使うテストは、開発用 DB（Docker）があれば走らせる。`createBatch` を書き直したので、`store` のテストは必ず走らせる。
  - `grep -rn "imports/csv\|csvimport\|CreateImportBatch\|codeInvalidCSV" services/api` → 何も出ない。
- [ ] **Step 2: e2e を足す（今の e2e に無いものだけ）。**
  - `e2e/act-as.spec.ts`：`an admin acting as a member imports into the member's notes`
    - 管理者が会員として `/import` で 2 行（1 行目にヒント 2 個）を取り込む。
    - DB で次を確かめる。
      - ノートの `ownerId` が会員。
      - `ImportBatch` の `fileName` がファイル名、`rowCount` が 2。
      - 2 件の `createdAt` の差が 1 ms で、1 行目のほうが古い。
      - ヒントの `position` が 0・1。
  - `e2e/demo.spec.ts`：`the demo account can import CSV`。デモで 1 行を取り込む → `1件の学習文を登録しました。`、ノートの `ownerId` がデモ。
  - `e2e/learning.spec.ts`：`imports 1000 notes with 100 hints each`。
    - 見出し `最初の文,添削後の文,ピンイン`（`ピンイン` の見出しの確かめも兼ねる）と、1000 行 × ヒント 100 個。
    - → `1000件の学習文を登録しました。`、`LearningEntry` 1000 件、`Hint` 100,000 件。
    - 時間がかかるなら、このテストだけ `test.setTimeout` を延ばす。
  - `e2e/learning.spec.ts:164` の表に 1 行足す：`["NUL in a cell", "原文,添削,pin\u0000yin", "引用符"]`。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。
  - 参照 §5「E2E」の spec（learning・security・records・ffpf-login・home-search・responsive・review-schedule・theme・act-as・demo）を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の CSV の取り込みを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`README.md`、`.env.example`（変える必要があれば）

- [ ] **Step 1: 直す。**
  - Web が CSV の取り込みも DB に直接書くことを書く。Go に残っているものの一覧から CSV を外す。
  - `docs/api-deployment.md` の「段階2のマージの前と後」のあとに、「段階3（CSV の取り込み）のマージの前と後」を足す。見出しに「CSV の取り込み」を入れ、同じファイルの古い「段階3のマージの前に行うこと」（Go API を入れたときの段階）と取り違えないようにする。
    - マージの前：新しい環境変数はない。
    - マージのあと：
      1. Web の Production のデプロイが Ready になったことを確かめる。
      2. `vercel promote` で切り替える。
      3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/imports/csv` が本番の Go から消える。
    - 戻すとき：
      - Go だけを戻しても害はない。
      - Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/imports/csv` を呼んで 404 になり、取り込みが一般的な文言で失敗する。Web を戻すなら Go も戻す。
  - 「運用上の注意」の「本文の上限と CSV」を直す。
    - CSV は Web の Server Action が受け取る。上限は `next.config.ts` の `bodySizeLimit: "4.5mb"` と、Web の 4 MiB の確かめ。
    - Go の 4 MiB + 256 KiB と 4 分の記述は消す。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: CSV の取り込みを Web に移したことを書く`
