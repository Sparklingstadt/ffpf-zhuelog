# Go 廃止 段階 1（単語帳）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 単語帳の一覧・保存・削除と AI の下書きを、Go API から Next.js（Prisma と OpenAI の直接呼び出し）に移し、Go の該当コードを消す。

**Architecture:** 画面と Server Action は今のまま使う。その下の `vocabulary`（`src/composition/vocabulary-container.ts`）を、Go を呼ぶアダプタから、Prisma のストアと OpenAI の下書きを組み合わせたものに差し替える。持ち主（ownerId）は段階 0 のログイン中の人から決める。復習（`ReviewItem` を読む・答える）はまだ Go のままなので、Web が作る復習カードは Go が読める形にする。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7、OpenAI Responses API（`fetch`。SDK は入れない）、`node:test` + `tsx`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（決めたこと 8〜11、段階 1、「各 PR の共通の進め方」）。段階 0 の計画：`docs/superpowers/plans/2026-11-16-deprecate-go-stage0-foundation.md`。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は、今出ている Go の日本語の文言を変えない。
- 依存を増やさない（OpenAI は `fetch` で呼ぶ）。
- Prisma を import してよいのは `src/infrastructure/prisma/` の中だけ（`tests/architecture.test.ts`）。
- 持ち主：単語帳の読み書きは、ログイン中の人の `githubId`（管理者が「メンバーとして見る」ときは、その会員の ownerId）で行う。`getCachedCurrentUser()`（`src/composition/current-user.ts`）から取る。
- 入力の決まり（Go と同じ）：
  - 語句：前後の空白を取って 1〜20 文字
  - ピンイン：0〜100 文字
  - 意味：1〜200 文字
  - 下書きの文：0〜300 文字
  - id：UUID
  - `sourceEntryId`：`^[a-z0-9]{1,64}$`
  - 文字数は、コードポイントで数える
- 言語は `"zh"`。復習カードの kind は `"vocabulary"`、targetId は単語の id。
- **復習カードの id は Go と同じ形**：`"c"` に続けて `[a-z0-9]` を 24 文字（合計 25 文字）。`crypto` の乱数で作る。Go の `POST /v1/reviews/{itemId}` は、この形以外を「見つからない」として弾く。
- Go の文言（`services/api/httpapi/respond.go`）：
  - 入力の誤り：`単語の形式が不正です。語句は1〜20文字、意味は1〜200文字、ピンインは100文字以内にしてください。`
  - 見つからない：`単語が見つかりません。`
  - 同じ語句がある：`この語句はすでに単語帳にあります。`
  - 下書きの失敗：`ピンインと意味の下書きを作れませんでした。自分で入力するか、もう一度お試しください。`
- OpenAI（Go の `learning/openai.go` と同じ）：
  - `POST {base}/v1/responses`、`Authorization: Bearer <OPENAI_API_KEY>`
  - 本文：`model`、`instructions`、`input`、`store: false`、`max_output_tokens: 4000`、`reasoning: {effort: "minimal"}`、`text.format = {type: "json_schema", name, strict: true, schema}`
  - 時間切れは 20 秒。応答の本文は 1 MiB まで。リダイレクトは追わない。
  - モデルは `OPENAI_LEARNING_MODEL`。無ければ `gpt-5-mini`。
  - `OPENAI_API_BASE_URL` は、ループバック（`127.0.0.1`・`::1`・`localhost`）の http(s) だけを受け付ける。無ければ `https://api.openai.com`。
- AI の利用量：`AiUsage` に `feature: "vocabulary_draft"` で 1 行書く。
  - 答えが使えなかったときも、`usage` があれば書く。
  - 書けなかったときは、ログ（feature と error だけ）にとどめ、下書きの結果は変えない。
  - ownerId は**操作した本人**にする（管理者が「メンバーとして見る」ときは、管理者自身の GitHub ID）。
- デモのアカウントは、下書きを使えない（Go の `notForDemo`）。
- テスト：
  - `node --import tsx --test tests/<name>.test.ts`
  - 全体は `pnpm test:regression`
  - e2e は 1 度に 1 本だけ（先に `docker ps` で、ほかの run がないか確かめる）
- `git commit` と `git push` は、サンドボックスの中では失敗する。サンドボックスを外して実行する。

## Review Focus

1. **Web が作った復習カードを Go が扱えない。** id の形が違うと、復習の画面で答えられない。→ Task 2 のテスト `review item ids look like Go's`、Task 4 の e2e（既存の `vocabulary.spec.ts` は、単語を足して復習で答える）。
2. **同じ語句を 2 回足す。** 「この語句はすでに単語帳にあります。」と出て、2 つ目はできない。→ Task 4 の e2e `the same word twice is refused with Go's message`。
3. **ほかの人の id で保存・削除する。** 「単語が見つかりません。」になり、相手の単語は変わらない。→ Task 2 のテスト `another owner's id is not found`（ストアの判定を、偽の Prisma でなく純粋な関数として確かめる）。
4. **OpenAI が壊れた JSON・拒否・時間切れを返す。** 下書きの失敗の文言を出し、利用量は記録される。→ Task 1 のテスト群。
5. **管理者が「メンバーとして見る」ときの下書き。** 単語はその会員のもの、AI の利用量は管理者自身のもの。→ Task 3 のテスト `usage is recorded under the actor`。

---

### Task 1: OpenAI の呼び出しと、単語の下書き

**Files:**

- Create: `src/infrastructure/openai/responses.ts`、`src/infrastructure/openai/vocabulary-draft.ts`
- Modify: `src/infrastructure/config/environment.ts`
- Test: `tests/openai-responses.test.ts`、`tests/vocabulary-draft.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // environment.ts
  export type OpenAiConfig = { apiKey: string; baseUrl: string; learningModel: string };
  export function openAiConfig(): OpenAiConfig | undefined; // undefined without OPENAI_API_KEY or with a non-loopback OPENAI_API_BASE_URL
  // responses.ts
  export type OpenAiUsage = { model: string; inputTokens: number; outputTokens: number };
  export class OpenAiError extends Error { constructor(readonly code: "OPENAI_REQUEST_FAILED" | "OPENAI_AUTH_FAILED" | "OPENAI_RATE_LIMITED" | "OPENAI_TIMEOUT" | "OPENAI_INVALID_RESPONSE") }
  export function respondJson(
    config: OpenAiConfig,
    request: { instructions: string; schemaName: string; schema: object; input: string },
    onUsage: (usage: OpenAiUsage) => void,
    fetchImpl?: typeof fetch,
  ): Promise<string>; // the model's JSON text; failures are OpenAiError
  // vocabulary-draft.ts
  export function draftVocabulary(
    respond: (request: { instructions: string; schemaName: string; schema: object; input: string }) => Promise<string>,
    word: string,
    sentence: string,
  ): Promise<VocabularyDraft>; // OpenAiError("OPENAI_INVALID_RESPONSE") when the JSON is not exactly {pinyin, meaning} within limits
  ```

- [ ] **Step 1: 失敗するテストを書く。** `respondJson` は、偽の `fetch` で確かめる。
  - `posts the Responses request Go sends`：URL・ヘッダー・本文の各項目が Global Constraints のとおり。
  - `joins output_text parts of a completed response`：`status: "completed"` で、`message` の `output_text` を 2 つ → つないだ文字列を返す。
  - `reports usage even when the answer is unusable`：`status: "incomplete"` と `usage` → `OPENAI_INVALID_RESPONSE`。それでも `onUsage` が `{model, inputTokens, outputTokens}` で 1 回呼ばれる。
  - `a refusal is invalid` → `OPENAI_INVALID_RESPONSE`。
  - `maps HTTP errors`：401 と 403 → `OPENAI_AUTH_FAILED`、429 → `OPENAI_RATE_LIMITED`、500 → `OPENAI_REQUEST_FAILED`、fetch の失敗 → `OPENAI_REQUEST_FAILED`、中断（AbortError・TimeoutError）→ `OPENAI_TIMEOUT`。
  - `a body over 1 MiB is invalid`。
  - `does not follow redirects`：`redirect: "manual"` を渡す。

  `draftVocabulary` のテスト：
  - `sends the word and sentence as JSON input`：`input` が `{"word":"图书馆","sentence":"我去图书馆。"}`、`schemaName` が `vocabulary_card_draft`。`instructions` は Go の `vocabularyInstructions` と 1 文字も違わない。
  - `trims the answer`：`{"pinyin":" túshūguǎn ","meaning":" 図書館 "}` → `{pinyin:"túshūguǎn", meaning:"図書館"}`。
  - `rejects extra keys, missing keys, empty or overlong values`：次の 3 つ → `OPENAI_INVALID_RESPONSE`。
    - 3 つ目のキーがある
    - `meaning` がない
    - `pinyin` が 101 文字
  - `openAiConfig` のテスト（`tests/identity-environment.test.ts` と同じく `process.env` を戻す）：
    - キーが無ければ `undefined`
    - モデルの既定は `gpt-5-mini`
    - `OPENAI_API_BASE_URL=https://evil.example` は `undefined`
    - `http://127.0.0.1:3109` は受け付ける

- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/openai-responses.test.ts tests/vocabulary-draft.test.ts` → FAIL。
- [ ] **Step 3: 実装する。** 時間切れは `AbortSignal.timeout(20_000)`。本文は読み取りながら 1 MiB を超えたら打ち切る。`instructions` と `schema` は、Go の `learning/vocabulary.go` から写す。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。
- [ ] **Step 5: コミット。** `feat(web): 単語の下書きを Web から OpenAI に頼む`

### Task 2: 単語帳と AI の利用量を Prisma で読み書きする

**Files:**

- Create: `src/infrastructure/prisma/vocabulary-store.ts`、`src/infrastructure/prisma/ai-usage-store.ts`、`src/infrastructure/prisma/new-id.ts`
- Test: `tests/vocabulary-store.test.ts`、`tests/new-id.test.ts`

**Interfaces:**

- Consumes: `prisma()`（段階 0）、`VocabularyEntry`（`src/domain/vocabulary/vocabulary-entry.ts`）。
- Produces:

  ```ts
  // new-id.ts
  export function newId(): string; // "c" + 24 of [a-z0-9], from crypto random bytes without modulo bias
  // vocabulary-store.ts
  export class VocabularyNotFoundError extends Error {}
  export class VocabularyExistsError extends Error {}
  export type VocabularyInput = {
    id: string;
    word: string;
    pinyin: string;
    meaning: string;
    sourceEntryId?: string;
  };
  export function createVocabularyStore(
    db: () => PrismaClient,
    now: () => Date = () => new Date(),
  ): {
    list(ownerId: string): Promise<VocabularyEntry[]>; // newest first (createdAt desc, id desc), at most 1000, with nextReview from the owner's ReviewItem (kind "vocabulary")
    save(ownerId: string, input: VocabularyInput): Promise<VocabularyEntry>;
    remove(ownerId: string, id: string): Promise<void>;
  };
  export function decideSave(
    existingOwnerId: string | null,
    ownerId: string,
  ): "create" | "update" | "not-found"; // pure; the store uses it
  // ai-usage-store.ts
  export function recordAiUsage(
    db: () => PrismaClient,
    entry: {
      ownerId: string;
      feature: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    },
    now?: Date,
  ): Promise<void>;
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `review item ids look like Go's`：`newId()` を 1000 回 → すべて `/^c[a-z0-9]{24}$/` に合い、重ならない。
  - `another owner's id is not found`：`decideSave("password:other", "password:me")` → `"not-found"`、`decideSave(null, …)` → `"create"`、`decideSave("password:me", "password:me")` → `"update"`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/new-id.test.ts tests/vocabulary-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。** Go の `store/vocabulary.go` と同じ動きにする。
  - `save` は 1 つのトランザクションで行う。
    - 新しい単語：`VocabularyEntry` を作り、`ReviewItem`（`id: newId()`、`due` と `createdAt` と `updatedAt` は `now`、`state: 0`）を作る。同じカードがすでにあれば作らない。
    - 自分の単語：`pinyin`・`meaning`・`updatedAt` だけを書き換える。語句と `sourceEntryId` は変えず、カードにもさわらない。
    - ほかの人の id：`VocabularyNotFoundError`。
    - `(ownerId, language, word)` の一意制約の違反（Prisma の `P2002`）：`VocabularyExistsError`。
  - `remove` も 1 つのトランザクションで行う。単語を消し（無ければ、またはほかの人のものなら `VocabularyNotFoundError`）、その持ち主の kind `"vocabulary"`・targetId がその id の `ReviewItem` を消す。`ReviewLog` は、スキーマの `onDelete` に任せる（`prisma/schema.prisma` を確かめ、Go と同じく消えることを確かめる）。
  - `nextReview` は、単語ごとの `ReviewItem.due` を 1 回の問い合わせでまとめて取る（単語の数だけ問い合わせない）。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。`pnpm typecheck` も PASS。
- [ ] **Step 5: コミット。** `feat(web): 単語帳を Prisma で読み書きする`

### Task 3: 単語帳を差し替える（と、操作した本人を覚える）

**Files:**

- Modify: `src/domain/identity/entities/authenticated-user.ts`（`actorId?: string` を足す。管理者が会員として見ているときだけ、管理者自身の GitHub ID）
- Modify: `src/infrastructure/identity/token-current-user-provider.ts`、`tests/token-current-user-provider.test.ts`
- Modify: `src/composition/vocabulary-container.ts`
- Create: `src/application/vocabulary/vocabulary-book.ts`（持ち主の決定・デモの制限・下書きの可否をまとめる）
- Modify: `src/presentation/actions/vocabulary-actions.ts`、`src/app/vocabulary/page.tsx`
- Delete: `src/infrastructure/go-api/vocabulary-gateway.ts`、`tests/go-api-vocabulary-gateway.test.ts`
- Test: `tests/vocabulary-book.test.ts`

**Interfaces:**

- Consumes: Task 1 の `openAiConfig`・`respondJson`・`draftVocabulary`・`OpenAiError`。Task 2 の `createVocabularyStore`・`recordAiUsage`・2 つのエラー。`getCachedCurrentUser`。
- Produces（`src/application/vocabulary/vocabulary-book.ts`。依存は引数で受け取り、Prisma や fetch を import しない）：

  ```ts
  export type VocabularyBookDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: {
      list(ownerId: string): Promise<VocabularyEntry[]>;
      save(ownerId: string, input: VocabularyInput): Promise<VocabularyEntry>;
      remove(ownerId: string, id: string): Promise<void>;
    };
    draft:
      | ((
          word: string,
          sentence: string,
          onUsage: (u: OpenAiUsage) => void,
        ) => Promise<VocabularyDraft>)
      | undefined; // undefined without OpenAI
    recordUsage: (entry: {
      ownerId: string;
      feature: "vocabulary_draft";
      model: string;
      inputTokens: number;
      outputTokens: number;
    }) => Promise<void>;
  };
  export type DraftOutcome =
    | { ok: true; draft: VocabularyDraft }
    | { ok: false; reason: "unavailable" | "forbidden" | "failed" };
  export function createVocabularyBook(deps: VocabularyBookDeps): {
    list(): Promise<VocabularyEntry[]>;
    save(input: VocabularyInput): Promise<VocabularyEntry>;
    remove(id: string): Promise<void>;
    draft(word: string, sentence: string): Promise<DraftOutcome>;
  };
  ```

  型（`VocabularyInput`・`OpenAiUsage`）は、application から infrastructure を import しないよう、`src/domain/vocabulary/vocabulary-entry.ts` に置いて、両方から使う。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/token-current-user-provider.test.ts`：`an admin acts as an existing member` の期待に `actorId: "10001"` を足す。ほかの役割には `actorId` のキーがないこと。
  - `tests/vocabulary-book.test.ts`：
    - `reads and writes as the signed-in owner`：会員 → `store` に `password:abc` が渡る。
    - 管理者が会員として見ている → 会員の ownerId が渡る。
    - `refuses without a member or admin`：未ログイン・ゲスト・revoked → エラー（`VocabularyForbiddenError` を export）。
    - `the demo account cannot draft` → `{ok:false, reason:"forbidden"}`、`draft` は呼ばれない。
    - `without OpenAI the draft is unavailable` → `{ok:false, reason:"unavailable"}`。
    - `usage is recorded under the actor`：管理者が会員として見て下書き → `recordUsage` の ownerId は管理者の `actorId`。会員自身なら会員の ownerId。
    - `a failed draft still records usage and reports failed`：`draft` が `onUsage` を呼んでから `OpenAiError` を投げる → 記録は 1 回、`{ok:false, reason:"failed"}`。
    - `a usage write failure does not change the draft`：`recordUsage` が reject → 下書きは `ok: true`。`console.error` は feature と error の名前だけ。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/vocabulary-book.test.ts tests/token-current-user-provider.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `vocabulary-container.ts`：`createVocabularyBook` に次の 4 つを渡し、`vocabulary` として export する（名前は今と同じ）。
    - `getCachedCurrentUser`
    - `createVocabularyStore(prisma)`
    - `openAiConfig()` があるときだけの `draft`
    - `recordAiUsage`
  - `vocabulary-actions.ts`：`GoApiError` での分岐をやめる。Global Constraints の文言をそのまま使う。
    - `VocabularyExistsError` → 同じ語句の文言
    - `VocabularyNotFoundError` → 見つからない文言
    - `VocabularyForbiddenError` → `accountForbiddenMessage`（削除は `actionUnauthorized`）
    - 下書きの `unavailable` → 今の「AIの下書きは今は使えません。…」
    - `failed` → 下書きの失敗の文言
    - `forbidden` → `accountForbiddenMessage`
    - それ以外の例外は、ログに残して `genericErrorMessage`（Next の redirect は投げ直す）
  - `page.tsx`：`loadOr`（`GoApiError` だけを拾う）の代わりに、DB の失敗を拾ってお知らせを出す。お知らせの文言は今と同じ。ログは `VOCABULARY_UNAVAILABLE` と error の名前だけ。
- [ ] **Step 4: 単体テストを確かめる。** `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
- [ ] **Step 5: コミット。** `refactor(web): 単語帳を Go に頼まずに読み書きする`

### Task 4: Go の単語帳を消し、e2e で確かめる

**Files:**

- Delete:
  - `services/api/httpapi/vocabulary_handlers.go` と `_test.go`
  - `services/api/learning/vocabulary.go` と `_test.go`
  - `services/api/store/vocabulary.go` の `ListVocabulary`・`PutVocabulary`・`DeleteVocabulary` と、そのテスト
  - `services/api/learning/usage_test.go` のうち、単語の下書きの部分
- Modify:
  - `services/api/httpapi/router.go`：`vocabularyRoutes` と、`Deps` の `Vocabulary`・`VocabularyDrafter`
  - `services/api/main.go`
  - `services/api/httpapi/respond.go`：使わなくなった文言とコード
  - `services/api/aiusage/aiusage.go`：`FeatureVocabularyDraft`
- Keep: `store/vocabulary.go` の `VocabularyEntry`・`ReviewKindVocabulary`・`scanVocabulary`・`vocabularyByID`（復習が使う。段階 4 で移す）。
- Modify: `e2e/server.ts`（Web の env に `OPENAI_API_KEY: "e2e-openai-api-key"`、`OPENAI_API_BASE_URL: openAiStubURL` を足す）
- Create: `e2e/vocabulary.spec.ts` にテストを 1 つ足す

- [ ] **Step 1: Go を消す。** 消したあと `cd services/api && go vet ./... && go build ./...` → 成功。`grep -rn "vocabularyRoutes\|DraftVocabulary\|PutVocabulary\|ListVocabulary\|DeleteVocabulary" services/api` → 何も出ない。
- [ ] **Step 2: e2e を足す。** `the same word twice is refused with Go's message`：同じ語句を 2 回足す → 2 回目に「この語句はすでに単語帳にあります。」が出て、一覧には 1 つだけ。
- [ ] **Step 3: 下書きの e2e が Web から stub に届くことを確かめる。** `e2e/openai-stub.ts` が `vocabulary_card_draft` に答えることを確かめ、無ければ足す。
- [ ] **Step 4: 全体を確かめる。** `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS（`vocabulary.spec.ts`・`demo.spec.ts`・`review.spec.ts`・`review-schedule.spec.ts` を含む）。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 5: コミット。** `refactor: Go の単語帳を消す`

### Task 5: ドキュメント

**Files:**

- Modify: `docs/api-deployment.md`（Web の Production に `OPENAI_API_KEY` を入れること。Go と同じ値でよい。`OPENAI_LEARNING_MODEL` は任意。入れないと、単語帳の「AI で下書き」が「今は使えません」になる）、`.env.example`、`docs/architecture.md`（単語帳は Web が DB と OpenAI を直接使う。図に Web→DB と Web→OpenAI の矢印）、`docs/development.md:69`（Preview の DB の古い 1 文。段階 0 で後回しにした分）
- Modify: `README.md`（「Web が DB に触るのは…だけ」の 1 文を、単語帳も含む形に直す）

- [ ] **Step 1: 直す。** 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** `node_modules/.bin/prettier --check` で、変えたファイルが通る。
- [ ] **Step 3: コミット。** `docs: 単語帳を Web に移したことを書く`

---

## このあとの段階

段階 2（学習ノート・ゴミ箱・共有・カレンダー・検索）の計画は、この段階のマージの後に書く。
