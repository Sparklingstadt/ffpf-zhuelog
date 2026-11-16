# Go 廃止 段階 10b（デモのリセットを Web に移し、Go の LINE と cron を消す）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デモのリセット（`GET`/`POST /v1/cron/demo-reset`）を Next.js の Route Handler（`/api/cron/demo-reset`）に移し、Go から LINE（webhook・連携・拾い直し・お知らせ）、デモのリセット、cron の秘密と、それだけが使うコードとパッケージをすべて消す。Go に残るのはログイン（段階 11）だけになる。Web の cron はまだ登録しない（段階 10c）。

**Architecture:** 段階 10a と同じ形にする。

- 例のデータ（`services/api/demo/seed.json`）から、リセットの時刻に合わせた種を作る処理は、I/O の無い純粋な関数として `src/domain/demo/demo-seed.ts` に置く。FSRS は Web の `src/domain/review/fsrs.ts` を使う。Go が書いた golden ファイル（`tests/fixtures/demo-seed-golden.json`）で、Go と同じ種になることを固定する。
- DB は `src/infrastructure/prisma/demo-reset-store.ts`（新規）。Go と同じく 1 つのトランザクションで、アカウントを作り（無ければ）、デモの持ち物を消し、種を入れる。
- 入口は `src/app/api/cron/demo-reset/route.ts`（`GET`・`POST`）。秘密の確かめは 10a の `handleCronRequest`。
- 入れ物は `src/composition/demo-container.ts`。
- Go は、参照 §18 の表で「none」のものをすべて消す。

**Tech Stack:** Next.js 16.4（Route Handler、`maxDuration`）、TypeScript、Prisma 7（interactive transaction、`createMany`、`$queryRaw`）、`node:test` + `tsx`、Playwright、Go の `testing`（golden ファイル）。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 10、「動いている Go の止め方」の手順 3、決めたこと 8・10）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage10-go-reference.md`（以下「参照」）。この計画で使うのは §0、§1、§13、§14、§17〜§19。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage10a-line.md`（この計画は 10a の PR の上に重ねた別の PR。分ける理由は 10a の判断 1）。**後の計画：** `…-stage10c-web-cron.md`。

**マージの条件：** 10a を本番に出し、利用者が LINE Developers の webhook の URL を Web に変えた（手順 2）**あと** にだけマージする。先に Go を出し直すと、LINE が消えたルートに届いて失われる。

## 設計者の判断（コントローラーが確かめること）

1. **デモのリセットは、この PR で Go から Web に移す。** Go のリセットを消すのと同じ PR に入れれば、e2e（`e2e/demo.spec.ts` は毎回リセットを呼ぶ）がいつも 1 つのリセットで通る。Cron の登録は 10c なので、この PR を出してから 10c までは、拾い直しもリセットも動かない（1 晩飛ぶ。急ぐときは手でリセットを呼ぶ）。
2. **種が Go と同じことは、Go が書いた golden ファイルで固定する。** 段階 4（FSRS）・9b（scrypt）と同じやり方。
   - Task 1 で `services/api/demo/golden_test.go` を足し、2 つの時刻の `Seed(now)` を `tests/fixtures/demo-seed-golden.json` に書き出す（`go test ./demo -run TestSeedGolden -update`）。UUID は乱数なので書き出さない（形だけを Web のテストで確かめる）。
   - Web のテストは同じファイルを読み、同じ時刻で `buildDemoSeed` を呼んで、UUID を除いて `deepEqual` で比べる。
   - Task 3 で Go の `demo` パッケージを消したあとも、ファイルは固定のまま残り、Web のテストが読み続ける（FSRS の golden が `review` パッケージを消したあとも残るのと同じ）。
3. **例のデータは `src/domain/demo/demo-fixture.json` に置く。** Task 1 では Go がまだ `//go:embed seed.json` で使うので、写しを作り、Go のテスト `TestWebFixtureIsTheSame` で 2 つが 1 バイトも違わないことを確かめる。Task 3 で Go の `seed.json` を消す。
4. **リセットは Go と同じ 1 つのトランザクションにし、消す表を schema と照らし合わせる。**
   - アカウントは `INSERT … ON CONFLICT ("loginId") DO NOTHING` のあと `SELECT … FOR UPDATE`（同時のリセットはここで待つ）。ある行（本物のパスワードでも）はそのまま使う。
   - 消すのは Go と同じ 11 の表と `ImportBatch`・`Follow`。残すのは `AiUsage`（管理者の記録）と `ApiRefreshToken`（デモのセッション。`sessionVersion` も変えない）。
   - Go の `TestDemoResetCoversEveryOwnerTable` を Web の unit テストに移す。`prisma/schema.prisma` の `ownerId` を持つモデルが、消す表か、わけ付きの残す表のどちらかに必ず入っていること。新しい表を足したときに、デモのデータが残るのを防ぐため。
   - interactive transaction は `{ maxWait: 5_000, timeout: 25_000 }`（Go の `demoResetTimeout` 25 秒）。route の `maxDuration` は 30。
5. **デモのアカウントのハッシュ `demo:no-password` を domain に 1 つだけ置く。** 今は `token-current-user-provider.ts` の中だけにある。リセットも同じ値を書くので、`src/domain/identity/demo-account.ts` の `DEMO_PASSWORD_HASH` にし、両方がそれを使う。Go のログイン（段階 11 まで）は、この値のアカウントだけを「デモで試す」に使う。
6. **Go は、LINE・cron・リセットだけが使うものをすべて消す（参照 §18）。** 段階 10 のあとの Go の答え：
   - `MemberExists`（store/members.go）は LINE の `ownerValid` だけが使っていたので消す。
   - `notDemo`・`notForDemo`・`route.closedToDemo`・`Auth.IsDemo`・`auth.Service.IsDemo` も、LINE の 5 つのルートだけが使っていたので消す（段階 11 のログインには要らない）。`isDemoAccount`・`DemoEnabled`・`LoginDemo`・`DemoPasswordHash`（store/accounts.go へ移す）は、ログインが使うので残す。
   - `notActing`・`bearerMatches`・`CronSecret`・LINE と OpenAI の設定・`jst`・`review`・`learning`・`openai`・`aiusage`・`line`・`linebot`・`demo` も消す。`store` は `dbTime`・`dbtx`（refresh token と試行回数が使う）を `store.go` に移して残す。
   - `services/api/vercel.json` から `crons` を消す（Go を出し直すと Go の cron が止まる。手順 3）。
7. **e2e の Go から LINE・OpenAI・cron の値を消す。** Go は `DEMO_LOGIN_ID` だけを使い続ける（ログイン）。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で Route Handler（`01-app/03-api-reference/03-file-conventions/route.md`）と `maxDuration`（`02-route-segment-config/maxDuration.md`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は domain のほかを import しない。
- SQL はタグ付きテンプレートだけ。表の名前を文字列でつながない（消す表は、それぞれの Prisma のモデルの `deleteMany` で書く）。時刻は `CAST(${now} AS TIMESTAMP(3))`。interactive transaction は `{ maxWait, timeout }` を明示する。
- 種の決まり（参照 §13）：例のデータの時刻は「リセットの日本時間の日付の `day` 日前の `HH:MM`（日本時間）」、それが今より後なら今の 1 分前。単語はノートの 5 分後。会話の `updatedAt` は `createdAt` ＋ メッセージの数 × 1 分。練習は `startedAt` ＋ `elapsedSeconds` 秒が `createdAt`、`elapsedMs = elapsedSeconds × 1000`。復習は新しいカードに答えを FSRS で順に当て、`today` は今の 1 時間前、`later` は FSRS ですでに期日なら今の 48 時間後。
- 書き込み（参照 §13）：ノートごとに `ImportBatch`（`fileName = "demo:" + createdAt.toISOString()`、`rowCount = 1`、`importedAt = createdAt`）、`ReviewItem` と単語の `language = "zh"`、`ReviewItem."updatedAt" = lastReview ?? createdAt`、`ReviewLog` は答える前のカードから、練習の `questions` の `id` は空なら書かない、`firstTryCount` は外しの無い問題の数、`missCount` は外しの合計。
- ログ：`DEMO_RESET_DONE`、`DEMO_RESET_FAILED` とエラーの名前だけ。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && gofmt -l . && go vet ./... && go test ./...`（`store` の DB のテストは開発用 DB（Docker）で）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **種が Go と同じか。** → Task 1 の Go の `TestSeedGolden` と Web の `the seed is Go's (golden file)`。
2. **リセットが Go と同じものを消し、同じものを残すか。** 11 の表・`ImportBatch`・`Follow` を消し、`AiUsage`・`ApiRefreshToken`・`sessionVersion` を残す。ほかの人のデータに触らない。→ Task 2 の `every owner table is emptied or kept on purpose` と e2e `the reset replaces only the demo's data`。
3. **Go のログインが、Web の作ったデモのアカウントで「デモで試す」できるか。** → `e2e/demo.spec.ts` の今のテスト。
4. **Go からすべて消えたか、ログインに要るものを消していないか。** → Task 3 の grep。
5. **Web の秘密の確かめ。** → Task 2 の e2e `the demo reset needs the cron secret`。

---

### Task 1: 種を作る処理を Web に写し、Go の golden ファイルで固定する

**Files:**

- Create: `services/api/demo/golden_test.go`、`tests/fixtures/demo-seed-golden.json`（Go が書き出す）、`src/domain/demo/demo-fixture.json`（`services/api/demo/seed.json` の写し）、`src/domain/demo/demo-seed.ts`
- Test: `tests/demo-seed.test.ts`（新規）

**Interfaces:**

- Go（`package demo`、`var updateGolden = flag.Bool("update", false, "rewrite the demo seed golden file the web's tests read")`、`goldenPath = "../../../tests/fixtures/demo-seed-golden.json"`、`webFixturePath = "../../../src/domain/demo/demo-fixture.json"`）：
  - `TestSeedGolden`：`now` が `2026-11-10T19:00:00Z`（04:00 JST、夜のリセット）と `2026-11-10T15:30:00Z`（00:30 JST、UTC と日本時間で日付が違う）の 2 つ。`Seed(now)` を下の形にし、`json.MarshalIndent(…, "", "  ")` ＋ 改行を、`-update` なら書き、そうでなければファイルと比べる（違えば「`go test ./demo -run TestSeedGolden -update` を実行し、Web のテストを確かめる」と出す。`auth/password_golden_test.go` と同じ形）。
  - `TestWebFixtureIsTheSame`：`seedJSON`（埋め込み）と `webFixturePath` のバイトが同じ。
  - golden の形（時刻は `t.UTC().Format("2006-01-02T15:04:05.000Z")`、ゼロの時刻は `null`、UUID は書かない）：

    ```json
    {
      "cases": [
        {
          "now": "2026-11-10T19:00:00.000Z",
          "seed": {
            "displayName": "デモ",
            "notes": [
              {
                "kind": "…",
                "originalText": "…",
                "correctedText": "…",
                "pinyin": "…",
                "hints": ["…"],
                "createdAt": "…",
                "review": null
              }
            ],
            "words": [
              {
                "word": "…",
                "pinyin": "…",
                "meaning": "…",
                "sourceNote": 0,
                "createdAt": "…",
                "review": {
                  "card": {
                    "due": "…",
                    "stability": 0,
                    "difficulty": 0,
                    "scheduledDays": 0,
                    "reps": 0,
                    "lapses": 0,
                    "state": 0,
                    "remainingSteps": 0,
                    "lastReview": null
                  },
                  "answers": [
                    { "rating": 3, "at": "…", "before": { "…": "…" } }
                  ]
                }
              }
            ],
            "conversations": [
              {
                "title": "…",
                "modelName": "…",
                "ended": true,
                "createdAt": "…",
                "updatedAt": "…",
                "messages": [{ "role": "user", "text": "…" }]
              }
            ],
            "prepositionRecords": [
              {
                "elapsedMs": 96000,
                "startedAt": "…",
                "createdAt": "…",
                "questions": [
                  {
                    "id": "P001",
                    "answer": "在",
                    "noun": "学校",
                    "prompt": "（　）学校学习",
                    "misses": []
                  }
                ]
              }
            ],
            "complementRecords": [
              {
                "mode": "result",
                "elapsedMs": 81000,
                "startedAt": "…",
                "createdAt": "…",
                "questions": []
              }
            ]
          }
        }
      ]
    }
    ```

- Web：

  ```ts
  // src/domain/demo/demo-seed.ts
  export class DemoFixtureError extends Error {
    override name = "DemoFixtureError";
  }
  export type DemoCardHistory = {
    card: FsrsCard;
    // Each answer with the card as it stood just before (what ReviewLog keeps).
    answers: { rating: number; at: Date; before: FsrsCard }[];
  };
  export type DemoNote = {
    kind: "correction" | "translation";
    originalText: string;
    correctedText: string;
    pinyin: string;
    hints: string[];
    createdAt: Date;
    review: DemoCardHistory | null;
  };
  export type DemoWord = {
    id: string;
    word: string;
    pinyin: string;
    meaning: string;
    sourceNote: number; // index in DemoSeed.notes
    createdAt: Date;
    review: DemoCardHistory;
  };
  export type DemoConversation = {
    id: string;
    title: string;
    modelName: string;
    ended: true;
    createdAt: Date;
    updatedAt: Date;
    messages: { id: string; role: "user" | "assistant"; text: string }[];
  };
  export type DemoRound = {
    id: string;
    elapsedMs: number;
    startedAt: Date;
    createdAt: Date;
    questionCount: number;
    firstTryCount: number;
    missCount: number;
    questions: {
      id: string;
      answer: string;
      noun: string;
      prompt: string;
      misses: string[];
    }[];
  };
  export type DemoSeed = {
    displayName: string;
    notes: DemoNote[];
    words: DemoWord[];
    conversations: DemoConversation[];
    prepositionRecords: DemoRound[];
    complementRecords: (DemoRound & { mode: string })[];
  };
  // Go: wordDelay.
  export const DEMO_WORD_DELAY_MS = 300_000;
  // Go: builder.at. The JST date `day` days before now's JST date, at time
  // (HH:MM, JST); a moment after now becomes a minute before now. null when
  // day is negative or not an integer, or time is not HH:MM.
  export function demoFixtureTime(
    now: Date,
    day: number,
    time: string,
  ): Date | null;
  // Go: demo.Seed. Throws DemoFixtureError naming the first problem. UUIDs
  // are drawn in Go's order: words, each conversation then its messages,
  // preposition rounds, complement rounds.
  export function buildDemoSeed(
    fixture: unknown,
    now: Date,
    newUuid: () => string,
  ): DemoSeed;
  ```

  決まり（参照 §13）：

  - 例のデータは、Go と同じく知らないキーを断る（それぞれの階層で、決まったキーのほかがあれば `DemoFixtureError`）。型が違う・`notes`・`words` などが配列でない → `DemoFixtureError`。
  - 復習：`newFsrsCard(created)` から、答えごとに `demoFixtureTime`、`rating` は 1〜4 の整数、`at` が `created` より前でなく、前の答えより後（`lastReview` があれば `at > lastReview`）、`nextFsrsCard(card, rating, at)`。`due` が `"today"` → `card.due = now − 3_600_000 ms`、`"later"` → `card.due <= now` なら `now + 172_800_000 ms`、ほか → `DemoFixtureError`。
  - 単語：`note` がノートの範囲外 → `DemoFixtureError`。`review` が無ければ `{ card: newFsrsCard(createdAt), answers: [] }`。
  - 練習：`misses` が `null`・無い → `[]`。`questionCount = questions.length`、`firstTryCount` は `misses.length === 0` の数、`missCount` は `misses.length` の合計（Go の `demoScore`）。

- [ ] **Step 1: Go の golden を書き出す。** `cp services/api/demo/seed.json src/domain/demo/demo-fixture.json`。`cd services/api && go test ./demo -run 'TestSeedGolden|TestWebFixtureIsTheSame' -update && go test ./demo` → 成功し、`tests/fixtures/demo-seed-golden.json` ができる。中身が 2 つの `cases`、それぞれノート 12・単語 10・会話 2・介詞の練習 2・補語の練習 1 であることを目で確かめる。
- [ ] **Step 2: Web の失敗するテストを書く。** `tests/demo-seed.test.ts`：
  - `the seed is Go's (golden file)`：ファイルを読み、各 `case` で `buildDemoSeed(fixture, new Date(now), uuid)` を作り、Date を `toISOString()` に、`lastReview: null` はそのままにして、UUID（単語・会話・メッセージ・練習の `id`）を除き、`complementRecords` の `mode` と練習の数（`questionCount` など。golden には無いので除く）を合わせて `deepEqual`。
  - `ids are fresh v4 UUIDs drawn in Go's order`：`newUuid` を `"u1"`, `"u2"`, … を返す数え上げにすると、単語 10 個が `u1`〜`u10`、最初の会話が `u11`、そのメッセージが `u12` から、…、補語の練習が最後。`crypto.randomUUID` を渡すと、すべて `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` に合い、2 回作ると重ならない。
  - `a day later everything moves by a day`：`now` と `now + 24 h` で、最初のノートの `createdAt` の差がちょうど `86_400_000`。
  - `times follow Japan's calendar`：`demoFixtureTime(new Date("2026-11-10T15:30:00Z"), 1, "09:15")` が `2026-11-10T00:15:00.000Z`（JST の 11 日の 1 日前の 10 日 09:15）。`demoFixtureTime(new Date("2026-11-10T19:00:00Z"), 0, "21:00")` は今より後なので `2026-11-10T18:59:00.000Z`。`(now, -1, "09:15")`・`(now, 1.5, "09:15")`・`(now, 1, "9:15")`・`(now, 1, "24:00")`・`(now, 1, "x")` → `null`。
  - `practice rounds are counted as Go counted them`：例のデータの最初の介詞の練習で、`questionCount`・`firstTryCount`・`missCount` を数え直したものと同じ（テストの中で `misses` から数える）。`misses: null` の問題は `[]` になる。
  - `a broken fixture names its first problem`：小さな例のデータで、知らないキー（`{"displayName":"x","notes":[],"words":[],"conversations":[],"prepositionRecords":[],"complementRecords":[],"extra":1}`）、`day: -1`、`time: "25:00"`、`rating: 5`、答えが作る前、2 つの答えが同じ時刻、`due: "soon"`、単語の `note: 3`（ノートは 1 つ）→ どれも `DemoFixtureError`。
- [ ] **Step 3: 失敗を確かめる。** `node --import tsx --test tests/demo-seed.test.ts` → FAIL。
- [ ] **Step 4: 実装する。** 上のとおり。日本時間は `Date.UTC(y, m, d - day, hh - 9, mm)`（日本は夏時間が無い）。各関数の上に、Go の `demo/demo.go` のどの関数か（行）を英語のコメントで書く。
- [ ] **Step 5: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint`、`cd services/api && gofmt -l . && go vet ./demo && go test ./demo` → PASS。
- [ ] **Step 6: コミット。** `test: デモの種が Go と同じことを golden ファイルで固定する`

### Task 2: デモのリセットを Web の Route Handler で行う

**Files:**

- Create: `src/domain/identity/demo-account.ts`、`src/infrastructure/prisma/demo-reset-store.ts`、`src/application/demo/demo-reset.ts`、`src/composition/demo-container.ts`、`src/app/api/cron/demo-reset/route.ts`
- Modify: `src/infrastructure/identity/token-current-user-provider.ts`（`DEMO_PASSWORD_HASH` を domain から）、`e2e/demo.spec.ts`
- Test: `tests/demo-reset-store.test.ts`、`tests/demo-reset.test.ts`（どちらも新規）

**Interfaces:**

```ts
// src/domain/identity/demo-account.ts
// The demo account's password hash: not a scrypt hash, so no password ever
// signs in to it (Go: store.DemoPasswordHash).
export const DEMO_PASSWORD_HASH = "demo:no-password";

// src/infrastructure/prisma/demo-reset-store.ts
export const DEMO_RESET_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 25_000,
};
// Owner-scoped tables the reset empties (Go: demoOwnedTables with
// LearningEntry and ReviewLog). ImportBatch and Follow go too.
export const DEMO_OWNED_TABLES: readonly string[]; // 11 names, below
// Owner-scoped tables the reset keeps on purpose, with the reason.
export const DEMO_KEPT_TABLES: Readonly<Record<string, string>>;
// Pure: every row the seed inserts for owner.
export function demoSeedRows(
  ownerId: string,
  seed: DemoSeed,
  newRowId: () => string,
): {
  importBatches: {
    id: string;
    fileName: string;
    rowCount: number;
    importedAt: Date;
  }[];
  learningEntries: {
    id: string;
    kind: string;
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
  vocabularyEntries: {
    id: string;
    ownerId: string;
    language: "zh";
    word: string;
    pinyin: string;
    meaning: string;
    sourceEntryId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  reviewItems: {
    id: string;
    ownerId: string;
    language: "zh";
    kind: "entry" | "vocabulary";
    targetId: string;
    due: Date;
    stability: number;
    difficulty: number;
    scheduledDays: number;
    reps: number;
    lapses: number;
    state: number;
    remainingSteps: number;
    lastReview: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  reviewLogs: {
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
  }[];
  conversations: {
    id: string;
    ownerId: string;
    title: string;
    modelName: string;
    ended: boolean;
    messages: { id: string; role: string; text: string }[];
    createdAt: Date;
    updatedAt: Date;
  }[];
  prepositionRecords: {
    id: string;
    ownerId: string;
    questionCount: number;
    firstTryCount: number;
    missCount: number;
    elapsedMs: number;
    questions: object[];
    startedAt: Date;
    createdAt: Date;
  }[];
  complementRecords: {
    id: string;
    ownerId: string;
    mode: string;
    questionCount: number;
    firstTryCount: number;
    missCount: number;
    elapsedMs: number;
    questions: object[];
    startedAt: Date;
    createdAt: Date;
  }[];
};
export function createDemoResetStore(
  db: () => PrismaClient,
  newRowId?: () => string,
): {
  // Go: ResetDemo. The demo account's id.
  reset(loginId: string, seed: DemoSeed, now: Date): Promise<string>;
};

// src/application/demo/demo-reset.ts
export function createDemoReset(deps: {
  loginId: string | undefined; // DEMO_LOGIN_ID; undefined: no demo
  fixture: unknown;
  store: { reset(loginId: string, seed: DemoSeed, now: Date): Promise<string> };
  newUuid: () => string;
  now: () => Date;
}): {
  available: boolean;
  // Go: demo.Resetter.Reset.
  reset(): Promise<void>;
};

// src/app/api/cron/demo-reset/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request): Promise<Response>;
export async function POST(request: Request): Promise<Response>;
```

`DEMO_OWNED_TABLES` は `["LearningEntry", "ReviewItem", "ReviewLog", "VocabularyEntry", "ChatConversation", "QuickQuestion", "PrepositionPracticeRecord", "ComplementPracticeRecord", "LineLink", "LineLinkCode", "LineMessage"]`。`DEMO_KEPT_TABLES` は `{ ApiRefreshToken: "the demo's sessions survive the nightly reset", AiUsage: "the admin's record of OpenAI spend; the demo cannot call OpenAI" }`。

`reset` の中（`db().$transaction(async (tx) => …, DEMO_RESET_TRANSACTION_OPTIONS)`。`now` はミリ秒に切ったもの）：

```sql
INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
VALUES (${newRowId()}, ${loginId}, ${seed.displayName}, ${DEMO_PASSWORD_HASH}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
ON CONFLICT ("loginId") DO NOTHING

SELECT "id" FROM "PasswordAccount" WHERE "loginId" = ${loginId} FOR UPDATE

DELETE FROM "ImportBatch" WHERE "id" IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = ${owner})
```

そのあと `owner = "password:" + id` で、`DEMO_OWNED_TABLES` の順に、それぞれのモデルの `deleteMany({ where: { ownerId: owner } })`（`tx.learningEntry`、`tx.reviewItem`、…。表の名前の文字列から delegate を引かない）、`tx.follow.deleteMany({ where: { OR: [{ followerId: owner }, { followeeId: owner }] } })`。それから `demoSeedRows` の行を、`importBatch`・`learningEntry`・`hint`・`vocabularyEntry`・`reviewItem`・`reviewLog`・`chatConversation`・`prepositionPracticeRecord`・`complementPracticeRecord` の `createMany` で（空の配列なら呼ばない。外部キーの順）。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/demo-reset-store.test.ts`：
    - `every owner table is emptied or kept on purpose`：`prisma/schema.prisma` を読み、`model X {` から `}` までに `ownerId` のフィールドの行（`/^\s+ownerId\s/m`）があるモデルの集合が、`DEMO_OWNED_TABLES` と `DEMO_KEPT_TABLES` のキーの和と同じ。重なりは無い。並べたものはすべて `ownerId` を持つ。外れたら「add it to DEMO_OWNED_TABLES in src/infrastructure/prisma/demo-reset-store.ts (or, if the reset must keep it, to DEMO_KEPT_TABLES with the reason)」と出す（Go の `TestDemoResetCoversEveryOwnerTable` と同じ）。
    - `the reset empties exactly those tables, in one transaction`：偽の `tx` で、`deleteMany` が呼ばれたモデルが `DEMO_OWNED_TABLES` のすべて（`where: { ownerId: "password:cdemo" }`）、`follow.deleteMany` が `OR` の 2 つ、`aiUsage` と `apiRefreshToken` と `passwordAccount` の `deleteMany`・`update` は呼ばれない。`$transaction` に `{ maxWait: 5000, timeout: 25000 }`。最初の文が `ON CONFLICT ("loginId") DO NOTHING` を含み、値に `"demo:no-password"` と `"デモ"` がある。2 つ目が `FOR UPDATE`。答えは偽の `SELECT` の `id`（`"cdemo"`）。
    - `seed rows are Go's rows`：小さな種（ノート 2 つ（1 つに復習と 1 回の答え、ヒント 2 つ）、単語 1 つ（ノート 0 から、答え 2 回）、会話 1 つ、介詞の練習 1 つ（問題 2 つ、1 つに外し 2 つ、`id` が `""` の問題を含む）、補語の練習 1 つ）で `demoSeedRows("password:c1", seed, 数え上げ)`：`importBatches[0].fileName === "demo:" + notes[0].createdAt.toISOString()`・`rowCount === 1`・`importedAt` がノートの時刻、`learningEntries` の `createdAt` がノートの時刻・`batchId` がそのバッチ、ヒントの `position` が 0, 1、`reviewItems` が 2 つ（`entry` と `vocabulary`、`language: "zh"`、`updatedAt` は `lastReview` のあるものはそれ、無いものは `createdAt`）、`reviewLogs` が 3 つで、各行の `state`・`due` などが答える **前** のカード、`vocabularyEntries[0].sourceEntryId` がノート 0 の id・`updatedAt === createdAt`、練習の `firstTryCount === 1`・`missCount === 2`・`questionCount === 2`、`id` が `""` の問題は JSON に `id` が無い。
  - `tests/demo-reset.test.ts`：
    - `without DEMO_LOGIN_ID there is no reset`：`loginId: undefined` → `available === false`、`reset()` は投げ、store は呼ばれない。
    - `the reset builds the seed for now and stores it`：`now` が `2026-11-10T19:00:00Z` → store に `("demo", seed, now)`、`seed` は `buildDemoSeed(fixture, now, newUuid)` と同じ。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/demo-reset-store.test.ts tests/demo-reset.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `demo-container.ts`：`import fixture from "@/domain/demo/demo-fixture.json"`、`export const demoReset = createDemoReset({ loginId: demoLoginId(), fixture, store: createDemoResetStore(prisma), newUuid: () => globalThis.crypto.randomUUID(), now: () => new Date(Math.trunc(Date.now())) })`。
  - `route.ts`：`demoReset.available` でなければ 404 `not_found`（秘密より先。Go のルートが無いのと同じ）。あれば `handleCronRequest(request, { secret: cronSecret(), run: async () => { await demoReset.reset(); console.info("DEMO_RESET_DONE"); }, failureCode: "DEMO_RESET_FAILED" })`。`GET` と `POST` は同じ関数。
  - `token-current-user-provider.ts:34` の定数を消し、`@/domain/identity/demo-account` から import する。
  - ファイルの先頭のコメントに、Go のどこと同じか（参照 §13）、1 つのトランザクションにするわけ、残す表のわけを書く。
- [ ] **Step 4: e2e を直して足す。**（`e2e/demo.spec.ts`）
  - `resetDemo()` を `POST ${baseURL}/api/cron/demo-reset`（`authorization: Bearer ${cronSecret()}`）に。`the demo reset needs the cron secret` を Web のルートに：`Bearer wrong` → 401 で本文 `{"error":{"code":"unauthorized","message":"認証が必要です。"}}`。`GET` も同じ秘密で 204。
  - `the reset seeds the demo as Go did`（新規。Go の `TestResetWithTheFixture` を写す）：リセットのあと、DB で、デモの `LearningEntry`（`deletedAt IS NULL`）が 12、`VocabularyEntry` が 10、`ReviewItem` の `due <= now()` が 1 以上、ノートも単語も無い `ReviewItem` が 0、`ChatConversation` が 2、`PrepositionPracticeRecord` が 2、`ComplementPracticeRecord` が 1、ノート・単語・練習・`ReviewLog` の日時の日本時間の日付が、直近 8 日のうち 5 日以上。`PasswordAccount` の `passwordHash` が `demo:no-password`。
  - `the reset replaces only the demo's data`（新規。Go の `TestResetDemoReplacesEverythingTheDemoOwns` を写す）：リセット → DB にデモのノートを 1 件（`ImportBatch` と `LearningEntry`、日中に試した人が足したもの）とその `ReviewItem` を直接入れ、ほかの会員を作ってノートを 1 件（`seedNotes`）、デモとその会員のフォローを両方向、デモの `AiUsage` を 1 行、デモの `sessionVersion` を 4 に、デモの `LineLinkCode` を 1 行入れる → もう一度リセット → デモのノートは 12 に戻り、足したノートとその `ReviewItem` は無い（ノートも単語も無い `ReviewItem` は 0）、フォローと `LineLinkCode` は 0、`AiUsage` は 1 のまま、`sessionVersion` は 4 のまま、アカウントの `id` は同じ、ほかの会員のノートは残る。
  - `an existing account keeps its password`：同じ `loginId` の会員を `createMember` で先に作ってからリセット → その行の `passwordHash` も `displayName` も変わらず、ノートは 12。
  - 今の `anyone can try the members' pages in the demo, without AI`（Go のログインが Web の作ったアカウントでデモに入る）と、`the demo account cannot share` は、ほかを変えずに通ること。
- [ ] **Step 5: 確かめる。** `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。`docker ps` でほかの e2e がないことを確かめ、`pnpm exec playwright test e2e/demo.spec.ts`（`docker compose -f compose.e2e.yaml up -d --wait` のあと）→ PASS。
- [ ] **Step 6: コミット。** `feat(web): デモのリセットを Route Handler で行う`

### Task 3: Go の LINE・cron・デモのリセットを消す

**Files:**（参照 §18 の「none」のものすべて。消したあと `go vet` と `go build` で残りを探す）

- 消す（パッケージごと）：`services/api/line/`、`linebot/`、`learning/`、`openai/`、`aiusage/`、`demo/`（`seed.json`・`golden_test.go` も）、`jst/`、`review/`（`golden_test.go` も。`tests/fixtures/fsrs-golden.json` は残し、固定のファイルになる）。
- 消す（ファイル）：`httpapi/line_handlers.go`、`httpapi/line_handlers_test.go`、`httpapi/line_review_notify_test.go`、`store/line.go`、`store/line_test.go`、`store/line_review_notify.go`、`store/line_review_notify_test.go`、`store/ai_usage.go`、`store/ai_usage_test.go`、`store/demo.go`、`store/demo_test.go`、`store/members.go`、`store/members_test.go`、`store/practice_records.go`、`store/entry_reviews.go`、`store/vocabulary.go`、`store/vocabulary_test.go`、`store/review_orphans_test.go`、`store/entries_test.go`。
- `store/entries.go`：`dbTime` と `dbtx` を `store/store.go` に移し、ファイルを消す。`isoMillisLayout` を使う所が残れば一緒に移す。
- `store/accounts.go`：`DemoPasswordHash`（とコメント）を store/demo.go から移す。
- `store/testhelpers_test.go`：使われなくなった道具（`draft`・`createBatch`・`createTied`・`createEntries`・`readNotes`・`liveNotes`・`liveNote`・`trashNote`・`restoreNote`・`dueItems`・`reviewCard`・`answerItem`・`putEntryInReview`・`reviewOwner`・`newUUID` など）を消す。`go vet ./store` が通るまで。
- `httpapi/router.go`：`Deps.Line`・`LineChannelSecret`・`CronSecret`・`DemoReset` とそのコメント、`r.lineRoutes()` と関数、`demoRoutes` の `DemoReset` の部分、`notForDemo`、`route.closedToDemo`、`Auth.IsDemo` を消す。
- `httpapi/demo.go`：`demoResetPath`・`demoResetTimeout`・`DemoResetter`・`notDemo`・`demoReset` を消す（`demoStatus`・`loginDemo` は残す）。`httpapi/middleware.go`：`notActing` を消す。`httpapi/respond.go`：`msgLineNotLinked`・`msgNotWhileActing`・`msgDemoRestricted` を消す（`writeStoreError` は act-as が使うので残す）。
- `httpapi/testutil_test.go`：`fakeAuth.isDemo` と `IsDemo` を消す。`httpapi/demo_test.go`：`TestDemoIsRefusedExactlyTheClosedRoutes`・`TestDemoCheckErrorIsNotAPass`・`TestDemoResetNeedsTheCronSecret` を消し、`allRoutesDeps` から LINE とリセットを外す。`httpapi/router_test.go`：`TestPublicRouteSetIsExactlyTheKnownRoutes` の `want` と資格の表から `POST /v1/line/webhook`・`GET /v1/line/drain`・`GET`/`POST /v1/cron/demo-reset` を消し、`Deps` から LINE の値を外す。`httpapi/act_as_test.go`：`TestLinkRoutesClosedWhileActing` を消す。
- `auth/demo.go`：`IsDemo` を消す（コメントの「the one place that decides what the demo may not do」も）。`auth/demo_test.go`：`TestIsDemo` を消す。`isDemoAccount` を `LoginDemo` だけが使う形にする（使う所が 1 つなら畳んでよい）。
- `main.go`：`newLineService`・`memberChecker`・`ownerValid`、`deps.DemoReset`・`deps.Line`・`deps.LineChannelSecret`・`CronSecret` の行、`demo`・`learning`・`line`・`linebot` の import を消す。`newNoRedirectHTTPClient` は `newGitHubHTTPClient` だけが使うなら中に畳む。
- `main_test.go`：`TestOwnerValid`・`TestRunLineRoutesEndToEnd` を消す。`TestNewNoRedirectHTTPClientRefusesRedirects` は関数を畳んだら `TestNewGitHubHTTPClientRefusesRedirects` だけを残す。
- `config.go`：`LineChannelSecret`・`LineChannelAccessToken`・`OpenAIAPIKey`・`OpenAILearningModel`・`CronSecret`・`OpenAIBaseURL`・`LineAPIBaseURL`・`LineEnabled`・`baseURL`・`defaultOpenAIBaseURL`・`defaultLineAPIBaseURL`・`defaultLearningModel` と、それを読む行を消す（`DEMO_LOGIN_ID` は残す）。`config_test.go`：`TestLoadConfigLineAllOrNothing`・`TestLoadConfigBaseURLDefaults`・`TestLoadConfigBaseURLLoopbackOnly`・`TestLoadConfigCronSecretOptional`・`TestLoadConfigOpenAIAloneIsNotLine`・`TestLoadConfigLineWithoutOpenAIFails`・`TestLoadConfigLinePartialFails`・`TestLoadConfigLearningModelDefaultAndOverride` を消し、`TestLoadConfigDefaults` から消えた値を外す。
- `services/api/vercel.json`：`crons` を消す（`$schema` と `framework` だけ）。
- `go mod tidy`（`golang.org/x/text` などが不要になれば外れる）。
- Web：`e2e/server.ts` の Go の `env` から `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`LINE_API_BASE_URL`・`OPENAI_API_BASE_URL`・`CRON_SECRET` と、そのコメントを消す（`DEMO_LOGIN_ID` のコメントを「Go's demo sign-in (stage 11)」に）。`e2e/environment.ts` の `cronSecret` のコメントから Go を外す。`src/domain/review/fsrs.ts` の先頭のコメントの「the golden file Go writes」を「the golden file Go wrote before its review package was removed (stage 10b); it is now a fixed file」に。`tests/` の FSRS の golden のテストのコメントも同じ。
- docs-site（段階 1〜9b と同じ扱い）：`docs-site/reference/line.md` を消し、`.vuepress/config.ts` のナビから外す。`reference/README.md` の 7 行の LINE の文と 18〜24 行、`errors.md:34`、`guide/auth.md:82`、`README.md` の LINE・cron・`learning`・`line`・`linebot`・`demo`・`openai` の行（29・41〜43・54〜55・82〜87・96 行）、`operations/deploy.md` の LINE・cron の値（51〜72 行）と「7. LINE 連携」の節、`operations/local.md:48` を消すか、「LINE とデモのリセットは Web（段階 10）」に直す。

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go mod tidy && gofmt -l . && go vet ./... && go build ./... && go test ./...` → 成功（`store` の DB のテストは開発用 DB（Docker）で）。`TestScryptGolden` も通る。
  - `grep -rn "LineService\|linebot\|learning\.\|aiusage\|\bjst\.\|review\.\(Next\|NewCard\)\|MemberExists\|notDemo\|notForDemo\|closedToDemo\|IsDemo\|notActing\|bearerMatches\|CronSecret\|CRON_SECRET\|LINE_\|OPENAI_\|demo-reset\|/v1/line\|ResetDemo\|DemoReset" services/api` → 何も出ない。
  - `grep -rn "func (s \*Service) LoginDemo\|func (s \*Service) DemoEnabled\|DemoPasswordHash =\|func (s \*Store) \(ConsumeThrottle\|ResetThrottle\|FindPasswordAccountByLoginID\)\|func dbTime" services/api` で、それぞれ 1 つずつ残る。
- [ ] **Step 2: e2e と docs-site を直す。** 上のとおり。
- [ ] **Step 3: 全体を確かめる。** `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS（Go の起動に LINE の値が無くても動く。`e2e/line.spec.ts` と `e2e/demo.spec.ts` は Web だけで通る）。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go の LINE・cron・デモのリセットを消す`

### Task 4: ドキュメント

**Files:** `README.md`、`docs/architecture.md`、`docs/features.md`、`docs/roadmap.md`、`docs/api-deployment.md`、`docs/api-local.md`、`.env.example`、`docs-site/README.md`、`docs-site/operations/deploy.md`

段階 7〜10a の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、`grep` で探してすべて直す。

- [ ] **Step 1: 直す。**
  - `README.md`：33 行の API の行を「Go（標準の `net/http`）。ログインだけを受け持ちます（…LINE・デモのリセットは Web に移りました）」に。34 行の DB の行から「Go API は…デモのリセットでは練習の記録と復習の項目も書きます。LINE の通知は復習の項目を読みます」を消し、Web が書くものに「デモのリセット」を足す。
  - `docs/architecture.md`：mermaid から Go の cron の矢印と `DATA` を消し、Web の側に「Cron（`vercel.json`、段階 10c で登録）」を書く。§7「LINE」から Go を消す。会員として操作の 117 行はそのまま。
  - `docs/features.md`：14〜16 行のデモの箇条：リセットは Web の `GET`/`POST /api/cron/demo-reset`（`CRON_SECRET`）、例のデータは `src/domain/demo/demo-fixture.json`、本番で有効にする手順は `curl -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset -H "Authorization: Bearer $CRON_SECRET"`。LINE の節から Go を消す。
  - `docs/roadmap.md:28`：「移行中の Go API（ログイン・定期実行）」を「移行中の Go API（ログイン）」に。
  - `docs/api-deployment.md`：
    - §3 の表から Go の `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`OPENAI_LEARNING_MODEL`・`CRON_SECRET`・`OPENAI_API_BASE_URL`・`LINE_API_BASE_URL` の行と注を消す（「段階 10b で Go から外した。Go の Vercel プロジェクトからも消してよい」と 1 行）。
    - §7「LINE 連携」から Go の 5 つのルートの表と Go の最大実行時間の段落を消す（10a で Web の説明に直した部分は残す）。
    - §10「デモアカウント」：リセットを Web の `/api/cron/demo-reset` に、`services/api/demo/seed.json` を `src/domain/demo/demo-fixture.json` に、Cron は Web の `vercel.json`（10c）に、Hobby の Cron の 2 つは Web の 2 つになる、手でリセットする `curl` を Web の URL に。「やめるとき」は、Web と Go の両方から `DEMO_LOGIN_ID` を消すことに。
    - 「段階10（LINE とデモのリセットの cron）のマージの前と後」の **手順 3** を書き足す：
      - マージの前：10a が本番にあり、手順 2（webhook の URL の変更）が済み、自分の LINE で Web が返事をすることを確かめたこと。Web の Production に `CRON_SECRET` と `DEMO_LOGIN_ID` があること。マイグレーションは無い。
      - マージのあと：1. Web の Production のデプロイが Ready。2. `vercel promote`。3. `curl -i -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset -H "Authorization: Bearer $CRON_SECRET"` が `204` で、「デモで試す」で例のデータが出ること（Go のログインが Web の作ったアカウントを使う）。4. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで Go の LINE のルート・`/v1/cron/demo-reset`・Go の 2 つの Cron が消える。5. `curl -i -X POST https://ffpf-zhuelog-api.vercel.app/v1/line/webhook` が `404`、Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いことを確かめる。6. Go の Vercel プロジェクトから `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`OPENAI_LEARNING_MODEL`・`CRON_SECRET` を消してよい（`DEMO_LOGIN_ID` は残す。Go のログインが使う）。
      - 10c を出すまで、拾い直しとデモのリセットの Cron は動かない（拾い直しが 1 回飛ぶのは設計どおり。リセットは上の `curl` で手でできる）。
      - 戻すとき：Go だけを戻すと、Go の Cron がまた動く（Web に Cron が無いうちは害はない）。Go の webhook は使われない（URL は Web）。Web だけを戻すと、デモのリセットのルートが無くなり、Go にも無いので、リセットは手でもできなくなる。Web を戻すなら Go も戻す。
  - `docs/api-local.md`：Go の LINE の説明を消す。
  - `.env.example`：Go 用の LINE と cron の 55〜60 行を消す。
  - `docs-site/README.md`・`docs-site/operations/deploy.md`：Task 3 で消し残した LINE・cron・デモのリセットの記述が無いことを確かめる。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "/v1/line\|/v1/cron\|services/api/vercel.json\|services/api/demo\|linebot\|LINE_CHANNEL\|CRON_SECRET" README.md docs docs-site .env.example --include='*.md' --include='*.example' --include='*.ts' | grep -v "docs/superpowers\|docs/releases\|\.vuepress/dist"` の結果を 1 行ずつ読み、Go が LINE・cron・リセットを行うと書いた所が残っていないことを確かめる（「段階 10 のマージの前と後」の節の歴史の説明は残してよい）。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: Go から LINE と cron を消し、デモのリセットを Web に移したことを書く`
