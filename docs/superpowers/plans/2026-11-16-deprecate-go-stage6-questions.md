# Go 廃止 段階 6（質問ノート・クイック質問）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クイック質問（`POST /v1/quick-question`。OpenAI へのストリーミング）と質問ノート（`GET /v1/questions`・`GET/PUT /v1/questions/{id}`）を、Go API から Next.js に移す。OpenAI は Next.js のサーバーから直接呼び、回答は Route Handler から直接ストリームで返す（Go への中継をやめる）。使った量は `AiUsage` に Web が記録する。Go の該当コードを消す（チャットが使う部分は残す）。

**Architecture:** 段階 1〜5 と同じ形にする。

- 質問の確かめ（1 つの `user` の発言、4000 文字）と、質問ノートの確かめ（前後の空白を削り、4000・20000 文字）は、I/O の無い純粋な関数として `src/domain/chat/question.ts` に置く。
- OpenAI のストリーム（SSE）の読み取りは、純粋な関数として `src/infrastructure/openai/response-events.ts` に置く。呼び出しは `src/infrastructure/openai/answer-stream.ts`（`streamAnswer`）に置く。段階 7（チャット）がそのまま使えるよう、指示文と `requireComplete` を引数にする。
- DB の読み書きは `src/infrastructure/prisma/question-store.ts` に置く。
- 持ち主・実際に操作している人（AI の利用量）・デモ・OpenAI の有無の判断は、`src/application/chat/question-notes.ts` に置く。
- ブラウザへの NDJSON（今の形のまま）は `src/presentation/http/answer-stream-response.ts` が作る。Route Handler の判定は `src/presentation/controllers/quick-question-controller.ts` に、保存の Server Action の判定は `src/presentation/controllers/question-save-controller.ts` に出して試す（段階 5 と同じ）。
- `src/composition/question-container.ts` の `questionNotes` を新しい実装にする。名前と `list`・`get`・`save` は変えないので、ページはほぼ変えない。
- 画面・Server Action の名前・ブラウザ側のフック（`use-quick-question.ts`・`chat-stream.ts`）と、ブラウザに返す形（NDJSON とエラーの JSON）は変えない。

**Tech Stack:** Next.js 16.4（Route Handler・`maxDuration`・Server Action）、TypeScript、Prisma 7、zod、`node:test` + `tsx`、Playwright。依存は増やさない（OpenAI の SDK は使わず `fetch`）。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 6、決めたこと 7〜9・11）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage6-go-reference.md`（以下「参照」）。順番、文言、OpenAI に送る本文と指示文、SSE の読み方、502 と `error` 行の分かれ目、保存の SQL、Go に残すべきコードが、file:line 付きで書いてある。

## 設計者の判断（コントローラーが確かめること）

1. **Route Handler が OpenAI を直接呼び、今と同じ NDJSON を返す。** 行は `{"type":"delta","text"}`・`{"type":"done"}`・`{"type":"error","message"}`、ヘッダーは `Content-Type: application/x-ndjson; charset=utf-8`・`X-Accel-Buffering: no`・`Cache-Control: no-store`。ブラウザのコード（`chat-stream.ts`・`use-quick-question.ts`）は変えない。
2. **最初の断片が来るまで、応答を返さない。** Go は最初の行を書くときにヘッダーを書いた。そのため、テキストの前の失敗は `502`（`{"error":{"code":"chat_failed","message":"ChatGPTから応答を受信できませんでした。"}}`）、後の失敗は `error` 行になる。Web も同じにするため、`answerStreamResponse` は最初の `next()` を待ってから `Response` を作る。断片が 1 つも無いまま終わった答えは、Go と同じく `200` で `done` の行だけ（ブラウザが「切れた」と扱う）。
3. **OpenAI のストリームの読み手は 1 つにし、段階 7 でも使う。** `streamAnswer(config, { model, instructions, messages, requireComplete }, { signal, onUsage })` は断片を `yield` する async generator。クイック質問は `requireComplete: true`（`response.incomplete` は `OPENAI_INCOMPLETE_RESPONSE`）。チャットは段階 7 で `false` で使う。`OpenAiErrorCode` に `"OPENAI_INCOMPLETE_RESPONSE"` を足す。
4. **モデルは `OPENAI_CHAT_MODEL`（無ければ `gpt-6.1-sol`）を Web でも読む。** `OpenAiConfig` に `chatModel` を足す。OpenAI に送るモデル、`AiUsage` の `model`、保存する `modelName`、一覧の `chatModel` は、すべてこの値（Go と同じ）。本番の Go に `OPENAI_CHAT_MODEL` が入っていれば、マージの前に Web にも同じ値を入れる（Task 5。入っているかは、利用者に確かめる）。
5. **保存は今のまま、答えを受け取ったブラウザが Server Action で行う。** サーバーが答えのあとに自分で保存する形にはしない。保存だけを再試行できる今の動き（e2e `failed saves retry the same answer once without asking again`）と画面を変えないため。そのため、ブラウザが送る答えは、今と同じく形と上限だけを確かめる（OpenAI の答えと同じかは見ない。Go と同じ）。
6. **保存の重なりは Go と同じ結果にする。** `createMany({ skipDuplicates: true })` のあとに `findUnique({ where: { id } })` で読み、持ち主・質問・回答がすべて同じなら `"saved"`（最初の行のまま。`modelName`・`createdAt` も）、違えば `"conflict"`（何も変えない）。Go の「何もしない UPDATE で既存の行を返す」SQL は写さない（段階 5 の判断 4 と同じ）。`QuickQuestion` は `id` だけが一意なので、`findUnique` は `id` で引く。
7. **だれが何をできるかは Go と同じにする。**
   - 一覧・1 件・保存：admin と会員（デモを含む）。会員として操作している admin は会員のノート。
   - 質問する：admin と会員。デモは `403`「デモでは使えません。」。会員として操作している admin はできる（`IsDemo` は代理中を見ない）。
   - 利用量：`ownerId` は実際に操作している人（`actorId ?? githubId`）、`feature` は `"quick_question"`（変えない）。
   - デモが自分のノートを保存できる（Go の `PUT` は `private`）のも、そのまま写す。答えを得られないので、実際には起きない。
8. **利用量は、`done`・`error` の行を書く前に記録する（Go と同じ順）。** application の `ask` は generator を包み、`finally` で記録する。記録の失敗は `console.error("AI_USAGE_NOT_RECORDED", "quick_question", <エラーの名前>)` だけで、答えは変えない。Go の 5 秒の打ち切りは写さない（Prisma のプールに任せる）。
9. **ブラウザに返すエラーの形は、今と同じ 2 種類を残す。** 中継が自分で返していたもの（同じ origin でない `403`・`415`・`413`・本文が読めない `400`）は `{"error": string}`。Go が返していたもの（`401`・`403`・`404`・`400`・`502`）は `{"error":{"code","message"}}`。e2e `demo.spec.ts:96` が `body.error.message` を見ている。
10. **OpenAI が無いときは、Go と同じく「質問する」と「保存」だけが無い。** 一覧の `chatModel` は `""`（画面は「クイック質問を利用できません」）。`POST /api/quick-question` は `404 {"error":{"code":"not_found","message":"見つかりません。"}}`。保存は `"unavailable"` → 一般的な文言（Go は `405` → 一般的な文言だった）。読むのはいつでもできる。
11. **質問のページの `ChatUnavailableError` の catch は消す。** 新しい一覧は投げないため。`/questions` の「質問ノートを利用できません」の分岐も、本番では出ない（Go は `Questions` を常に持っていた）ので消す。`ChatUnavailableError` 自体は `/chat`・`chat-guard.ts` が使うので残す（段階 7）。
12. **Route Handler に `export const maxDuration = 90` を付ける。** OpenAI の 1 回の答えは 60 秒で打ち切る（Go の `requestTimeout`）。90 は Go の `chatWriteTimeout` と同じ。書く前に `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` を読む。
13. **Go のテストのうち、消えるルートを通っていた `act_as_test.go` と `demo_test.go` は、残るルート（`PUT /v1/conversations/{id}`・`GET /v1/conversations`）で書き直す。** 段階 5 の判断 9 と同じ。`fakeConversations` に一覧の持ち主を覚える欄を足す。
14. **e2e の OpenAI の偽物を少し広げる。** ストリームの `response.completed` に `usage`（`input_tokens: 21`・`output_tokens: 43`）を付ける。最後の発言に `[incomplete]` があれば 1 つの断片のあと `response.incomplete`、`[fail]` があれば `500` を返す。Go のチャットも同じ偽物を呼ぶが、利用量の行が増えるだけで、今の e2e は数を見ていない。

> **コントローラーの確認（2026-11-16）**：設計者の判断はすべてそのまま採用する。本番の Go のプロジェクトの環境変数には `OPENAI_CHAT_MODEL` が入っていない（Vercel で名前を見比べて確かめた）。そのため Web も既定の `gpt-6.1-sol` で同じになり、マージの前に入れる値は無い。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Route Handler のストリーム、`maxDuration`、Server Action）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は何も import しない（同じ domain の型と関数を除く）。
- 持ち主（参照 §0・§5）：
  - ノートは常に今の利用者の `githubId`（admin が会員として操作するときは会員の ownerId）。フォームの値は使わない。
  - 利用量は `actorId ?? githubId`。
  - 未ログイン → 質問は `401`、一覧・1 件・保存は `QuestionForbiddenError`。ゲスト・`githubId` なし → 質問は `403`「このアカウントは利用できません。」、ほかは `QuestionForbiddenError`。
- 質問の確かめ（参照 §1。満たさなければ `400 {"error":{"code":"invalid_request","message":"会話内容が上限を超えているか、形式が不正です。"}}`）：
  - 本文は JSON の 1 つのオブジェクトで、キーは `messages` だけ。`messages` は配列で、要素のキーは `role`・`text` だけ（どちらも文字列）。知らないキーは不正（Go の `DisallowUnknownFields`）。
  - 要素はちょうど 1 つ、`role` は `"user"`、`text.trim()` が空でない、`[...text].length <= 4000`（削る前の長さ）。
  - OpenAI には `text` を削らずに送る。
- 質問ノートの確かめ（参照 §3）：`question` と `answer` は `trim()` してから、1 文字以上、`question` は `4000`・`answer` は `20_000` コードポイント以下。保存するのは削ったもの。`id` は `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`（`QUESTION_ID`）。
- `POST /api/quick-question` の順番（参照 §1・§6）：
  1. 同じ origin でない → `403 {"error":"この画面から送信してください。"}`
  2. `content-type` が `application/json` でない → `415 {"error":"JSON形式で送信してください。"}`
  3. 未ログイン → `401 {"error":{"code":"unauthorized","message":"認証が必要です。"}}`
  4. ゲスト・`githubId` なし → `403 {"error":{"code":"forbidden","message":"このアカウントは利用できません。"}}`
  5. デモ → `403 {"error":{"code":"forbidden","message":"デモでは使えません。"}}`
  6. OpenAI なし → `404 {"error":{"code":"not_found","message":"見つかりません。"}}`
  7. 本文が `262_144` バイトを超える → `413 {"error":"会話が大きすぎます。"}`。読めない → `400 {"error":"リクエストを読み取れませんでした。"}`
  8. 質問の確かめ → 上の `400`
  9. ストリーム（設計者の判断 1・2）。失敗の文言は `ChatGPTから応答を受信できませんでした。`
  - すべての応答に `Cache-Control: no-store`。
- OpenAI への要求（参照 §2。値をそのまま）：
  - `POST {baseUrl から末尾の / を除いたもの}/v1/responses`
  - ヘッダー：`Content-Type: application/json`、`Accept: text/event-stream`、`Authorization: Bearer <key>`。`redirect: "manual"`。
  - 本文：`{ model: chatModel, instructions: QUICK_QUESTION_INSTRUCTIONS, input: [{ role: "user", content: text }], stream: true, store: false, max_output_tokens: 1600, reasoning: { effort: "medium" } }`。
  - `QUICK_QUESTION_INSTRUCTIONS` は参照 §2 の 6 行を 1 文字も変えずに写す。
  - 打ち切り：答え全体で `60_000` ms（`AbortSignal.any([signal, AbortSignal.timeout(60_000)])`）。再試行しない。
  - 状態：`200` 以外は本文を捨て、`401`・`403` → `OPENAI_AUTH_FAILED`、`429` → `OPENAI_RATE_LIMITED`、ほか（3xx を含む）→ `OPENAI_REQUEST_FAILED`。送れない・読めない → 打ち切り（`TimeoutError`）なら `OPENAI_TIMEOUT`、ほかは `OPENAI_REQUEST_FAILED`。
- SSE の読み方（参照 §2）：
  - 行は `\n` で分け、末尾の `\r` を除く。1 行が `1_048_576` バイトを超える → `OPENAI_INVALID_RESPONSE`。
  - `data:` で始まる行だけを読み、残りを `trim()` して JSON にする（読めない → `OPENAI_INVALID_RESPONSE`）。
  - 種類ごと：
    - `response.output_text.delta` → 空でない `delta` を出す。
    - `response.completed` → 利用量を報告して終わり。
    - `response.incomplete` → 利用量を報告。`requireComplete` なら `OPENAI_INCOMPLETE_RESPONSE`、でなければ終わり。
    - `response.failed`・`error` → 利用量を報告して `OPENAI_INVALID_RESPONSE`。
    - ほかは無視する。
  - 最後の出来事が無いまま終わる → 打ち切りか中断なら上の対応、ほかは `OPENAI_INVALID_RESPONSE`。
  - 利用量：その出来事の `response.usage.input_tokens`・`output_tokens`。`response` か `usage` が無ければ報告しない。負の数は `0`。`model` は設定のモデル。
- 保存（参照 §3・§4）：`createdAt` は `now`（1 回の処理で 1 度）。`modelName` は `chatModel`。結果は `"saved" | "invalid" | "conflict" | "unavailable"`。
- 読む（参照 §4）：一覧は `100` 件、`createdAt` の新しい順、同じなら `id` の大きい順、`answer` は読まない。1 件は `id` と持ち主で読み、`id` が `QUESTION_ID` に合わなければ DB を読まずに `null`。
- 文言（今のまま）：
  - 保存：権限 → `accountForbiddenMessage`、形 → `質問ノートの形式が不正です。`、`"conflict"`・`"unavailable"`・そのほか → `genericErrorMessage`（ログは `QUESTION_SAVE_FAILED` と結果かエラーの名前だけ）。
  - 質問の失敗のログは `console.error("QUICK_QUESTION_FAILED", <コード>)`。ブラウザが止めたとき（`signal.aborted`）は記録しない。質問と回答の本文は、どこにも記録しない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（DB のテストは Docker があれば）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **テキストの前の失敗は 502、後の失敗は `error` 行、切れた答えは `done` にしない。** → Task 3 のテスト `a failure before the first piece is a 502 and after it an error line`、Task 4 の e2e `an answer OpenAI cuts or refuses is not saved`。
2. **OpenAI に送るものが Go と同じか。** モデル、指示文の全文、`input` の形、`stream`・`store`・`max_output_tokens`・`reasoning`、`Accept`、60 秒。→ Task 2 のテスト `the request is the one Go sent`。
3. **だれが質問でき、だれの分になるか。** デモは `403`「デモでは使えません。」、ゲストは `403`、未ログインは `401`。会員として操作している admin が質問すると、ノートは会員、利用量は admin。→ Task 3 のテスト `quick questions follow the signed-in owner and bill the actor`、Task 4 の e2e `an admin acting as a member asks as the member and pays for it`、既存の `e2e/demo.spec.ts:86`。
4. **ノートは書き換わらない。** 同じ id・同じ内容の送り直しは 1 行のまま成功。同じ id で違う内容、またはほかの人の id は、何も変えずに一般的な文言。→ Task 3 のテスト `a note id saved with other content is a conflict`、Task 4 の e2e `a question note id cannot be overwritten`。
5. **確かめが Go と同じか。** 1 つの `user` の発言、空白だけは不可、4000 コードポイント（削る前）、知らないキーは不可。ノートは削ってから 4000・20000。4 バイトの文字。→ Task 1 のテスト `a quick question is checked as Go checked it` と `a question note is trimmed and bounded as Go did`。

---

### Task 1: 質問とノートの確かめ、SSE の読み取り（純粋な関数）

**Files:**

- Modify: `src/domain/chat/question.ts`
- Create: `src/infrastructure/openai/response-events.ts`
- Test: `tests/question.test.ts`（新規）、`tests/openai-response-events.test.ts`（新規）

**Interfaces:**

- Produces:

  ```ts
  // question.ts (MAX_QUESTION_CHARS, MAX_ANSWER_CHARS, the types stay)
  export const QUESTION_LIST_LIMIT = 100;
  // A lower-case UUID, as the browser's crypto.randomUUID() makes them.
  export const QUESTION_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // The question of a POST /api/quick-question body, untrimmed, or null when
  // Go would have answered 400 (Go's chat.Validate plus the quick rules).
  export function quickQuestionText(body: unknown): string | null;
  // The note as it is saved (trimmed), or null when Go would have answered
  // 400 or 404 (an id of the wrong shape).
  export function checkQuestionNote(
    input: SaveQuestionInput,
  ): SaveQuestionInput | null;

  // response-events.ts
  export type ResponseEvent =
    | { type: "delta"; text: string }
    | {
        type: "end";
        outcome: "completed" | "incomplete" | "failed";
        usage?: { inputTokens: number; outputTokens: number };
      };
  // Reads the Responses API's server-sent events. Throws OpenAiError
  // ("OPENAI_INVALID_RESPONSE") for a line over maxLineBytes or bad JSON in a
  // data line; read errors are rethrown as they are (the caller maps them).
  export function readResponseEvents(
    body: ReadableStream<Uint8Array>,
    maxLineBytes?: number, // default 1 << 20
  ): AsyncGenerator<ResponseEvent>;
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/question.test.ts`：
    - `a quick question is checked as Go checked it`：Go の `TestQuickQuestionAcceptsOnlyOneQuestion` と `chat.TestValidate` を写す。
      - `null`：`{messages:[]}`、`assistant` 1 つ、`user`・`assistant`・`user` の 3 つ、`"字"` × 4001、`" \n"` だけ、`role: "system"`、`messages` が無い・`null`・配列でない、`text` が数、知らないキー（上の段 `{messages, extra}`・要素の `{role, text, id}`）、本文が配列・文字列。
      - 通る：`"你好"` → `"你好"`、`"字"` × 4000、`"𠮷"` × 4000（`s.length` だと 8000 で落ちる）、前後に空白のある `"  了？ "` → 削らずに `"  了？ "`。
    - `a question note is trimmed and bounded as Go did`：Go の `TestQuestionSaveAndReadUsesAuthenticatedOwnerAndServerModel` の表を写す。
      - `" 了と过？ "`・`" 違いです。 "` → 削ったもの。
      - `null`：`answer` が空・空白だけ、`answer` 20001 文字、`question` 4001 文字、`id` が大文字の UUID・`not-a-uuid`。
      - 通る：ちょうど 4000・20000、`"𠮷"` × 4000。
  - `tests/openai-response-events.test.ts`（`new ReadableStream` に文字列を分けて入れる）：
    - `deltas, then the final event with its usage`：`event:` の行・空行・`: comment` を飛ばし、空の delta は出さない。`response.completed` の `usage` が `{inputTokens: 120, outputTokens: 45}`。`usage` が無ければ `usage` も無い。負の数は `0`。
    - `incomplete, failed and error end the stream`：それぞれ `outcome` が `incomplete`・`failed`・`failed`。
    - `a line split across chunks and CRLF line ends are read whole`：マルチバイト文字が 2 つの chunk にまたがっても 1 つの delta。
    - `bad JSON and an over-long line are OPENAI_INVALID_RESPONSE`：`maxLineBytes` を小さくして確かめる。
    - `a stream that ends without a final event ends the generator`（`end` を出さずに終わる。どう扱うかは Task 2）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/question.test.ts tests/openai-response-events.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 文字数は `[...s].length`（Go の rune と同じ）。`question.ts` の `MAX_ANSWER_CHARS` のコメントは「Go's chat.MaxAnswerChars」から、Web が決める上限の説明に直す。
  - `quickQuestionText` は `JSON.parse` 済みの値を受け取る（読むのと JSON にするのは controller）。キーを数えて知らないキーを落とす。
  - `readResponseEvents` は `TextDecoder` を `stream: true` で使い、バイト数は行ごとに `Buffer.byteLength` で数える。各関数の上に、Go のどこにあたるかを英語のコメントで 1 行書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): クイック質問と質問ノートの確かめ、OpenAI のストリームの読み取り`

### Task 2: OpenAI のストリームの呼び出しと、質問ノートの読み書き（Prisma）

**Files:**

- Create: `src/infrastructure/openai/answer-stream.ts`、`src/infrastructure/openai/quick-question.ts`（`QUICK_QUESTION_INSTRUCTIONS` だけ）、`src/infrastructure/prisma/question-store.ts`
- Modify: `src/infrastructure/openai/responses.ts`（`OpenAiErrorCode` に `"OPENAI_INCOMPLETE_RESPONSE"`、`transportError` を export）、`src/infrastructure/config/environment.ts`（`OpenAiConfig.chatModel`）
- Test: `tests/openai-answer-stream.test.ts`（新規）、`tests/question-store.test.ts`（新規。純粋な部分だけ）、`tests/identity-environment.test.ts` か `openAiConfig` を試している所（`chatModel` の既定と上書き）

**Interfaces:**

- Consumes: Task 1 の `readResponseEvents`、`OpenAiError`、`OpenAiConfig`、`newId`、`prisma()`。
- Produces:

  ```ts
  // environment.ts
  export type OpenAiConfig = {
    apiKey: string;
    baseUrl: string;
    learningModel: string;
    chatModel: string;
  };
  // OPENAI_CHAT_MODEL, default "gpt-6.1-sol" (Go's defaultChatModel)

  // answer-stream.ts
  export type AnswerTurn = { role: "user" | "assistant"; text: string };
  export type AnswerRequest = {
    model: string;
    instructions: string;
    messages: readonly AnswerTurn[];
    // true: response.incomplete is OPENAI_INCOMPLETE_RESPONSE (quick
    // questions); false: it ends the answer (the chat, stage 7).
    requireComplete: boolean;
  };
  // Streams the answer's text pieces. Throws OpenAiError; reports usage
  // through onUsage before it returns or throws. Cancelling signal, or
  // returning early from the iteration, aborts the request.
  export function streamAnswer(
    config: OpenAiConfig,
    request: AnswerRequest,
    options: {
      signal: AbortSignal;
      onUsage: (usage: OpenAiUsage) => void;
      fetchImpl?: typeof fetch;
      timeoutMs?: number; /* default 60_000 */
    },
  ): AsyncGenerator<string>;

  // question-store.ts
  export function questionNoteRow(
    ownerId: string,
    note: SaveQuestionInput,
    modelName: string,
    now: Date,
  ): {
    id: string;
    ownerId: string;
    question: string;
    answer: string;
    modelName: string;
    createdAt: Date;
  };
  export function createQuestionStore(db: () => PrismaClient): {
    list(ownerId: string, limit: number): Promise<QuestionSummary[]>;
    get(ownerId: string, id: string): Promise<QuestionNote | null>;
    // false: the id is taken by another owner or by other content (nothing changed).
    save(
      ownerId: string,
      note: SaveQuestionInput,
      modelName: string,
      now: Date,
    ): Promise<boolean>;
  };
  ```

- [ ] **Step 1: 失敗するテストを書く。** `tests/openai-answer-stream.test.ts`（`fetchImpl` を偽物にする。Go の `chat/openai_test.go`・`usage_test.go` を写す）：
  - `the request is the one Go sent`：URL は `http://127.0.0.1:1/v1/responses`（`baseUrl` の末尾に `/` があっても）。ヘッダー 3 つ、`redirect: "manual"`。本文を `JSON.parse` すると、`QUICK_QUESTION_INSTRUCTIONS` と `requireComplete: true` で「Global Constraints」の本文と `deepEqual`。`QUICK_QUESTION_INSTRUCTIONS` が参照 §2 の全文と同じ（テストに全文を書く）。
  - `only text deltas are yielded`：`["你", "好"]`。
  - `incomplete is an error only when the answer must be complete`：`requireComplete: true` → 1 つ出したあと `OPENAI_INCOMPLETE_RESPONSE`。`false` → 終わり。
  - `failed events and statuses`：Go の `TestStreamFailedEventsAndStatuses` の 8 行（error 行、failed、最後の出来事なし、401・403・429・500・400）。エラーの `message` に API キーが無い。
  - `usage of the final event is reported once`：completed・incomplete・failed のそれぞれで `{ model: chatModel, inputTokens: 120, outputTokens: 45 }` が 1 回。`usage` が無ければ 0 回。
  - `stopping the iteration or the signal aborts the request`：途中で `return()` すると、偽物の fetch に渡った `signal` が `aborted`。外の `signal` を止めると `OPENAI_REQUEST_FAILED`。
  - `the whole answer times out`：`timeoutMs: 20` で、送り続けない偽物 → `OPENAI_TIMEOUT`。
  - `tests/question-store.test.ts`：`questionNoteRow keeps the trimmed note, the server's model and now`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/openai-answer-stream.test.ts tests/question-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `streamAnswer`：`respondJson` と同じく、`try` の中で `fetch`、`200` 以外は `response.body?.cancel()` してから状態で分ける。`for await (const event of readResponseEvents(body))` で、`end` のときは `usage` を `onUsage` に渡してから終わるか投げる。読み取りの失敗は `transportError`（`signal` が打ち切りなら `OPENAI_TIMEOUT`）。`finally` で `controller.abort()` と `reader` の `cancel` をする（途中で止めたとき OpenAI の生成も止まる）。
  - `QUICK_QUESTION_INSTRUCTIONS` はテンプレート文字列で、Go と同じ改行（行頭に空白を入れない）。
  - `question-store.ts`：
    - 一覧：`findMany({ where: { ownerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: { id, question, modelName, createdAt } })`。
    - 1 件：`findFirst({ where: { id, ownerId } })`（`id_ownerId` の一意は無い）。
    - 保存：`createMany({ data: [questionNoteRow(…)], skipDuplicates: true })` のあと `findUnique({ where: { id } })`。行があり、`ownerId`・`question`・`answer` が同じなら `true`。Go の SQL を写さないわけ（設計者の判断 6）をコメントに書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): OpenAI の回答をストリームで受け取り、質問ノートを Prisma で読み書きする`

### Task 3: application・応答・controller・container・呼ぶ側を差し替える

**Files:**

- Create: `src/application/chat/question-notes.ts`、`src/presentation/http/answer-stream-response.ts`、`src/presentation/http/limited-body.ts`（`readLimitedBody`・`BodyTooLarge` を `chat-relay-controller.ts` から移す）、`src/presentation/controllers/quick-question-controller.ts`、`src/presentation/controllers/question-save-controller.ts`
- Modify: `src/composition/question-container.ts`、`src/app/api/quick-question/route.ts`、`src/presentation/actions/question-actions.ts`（controller を呼ぶだけ）、`src/presentation/controllers/action-state.ts`（`isForbidden` に `QuestionForbiddenError`、コメント）、`src/presentation/controllers/chat-relay-controller.ts` と `src/composition/chat-relay.ts`（`upstreamPath` を消し、`/v1/chat` だけにする。`limited-body.ts` を使う）、`src/app/quick-question/page.tsx`・`src/app/questions/page.tsx`・`src/app/questions/[id]/page.tsx`（設計者の判断 11。`[id]` の手元の正規表現を `QUESTION_ID` に替える）、`src/presentation/components/chat/chat-stream.ts`（先頭のコメントの「Go's」を外すだけ）
- Delete: `src/infrastructure/go-api/question-gateway.ts`、`tests/go-api-question-gateway.test.ts`、`tests/chat-relay-controller.test.ts:138-155`（クイック質問の中継のテスト）
- Test: `tests/question-notes.test.ts`、`tests/answer-stream-response.test.ts`、`tests/quick-question-controller.test.ts`、`tests/question-save-controller.test.ts`（すべて新規）

**Interfaces:**

- Consumes: Task 1 の `quickQuestionText`・`checkQuestionNote`・`QUESTION_ID`・`QUESTION_LIST_LIMIT`、Task 2 の `streamAnswer`・`QUICK_QUESTION_INSTRUCTIONS`・`createQuestionStore`・`recordAiUsage`。
- Produces:

  ```ts
  // question-notes.ts
  export class QuestionForbiddenError extends Error { override name = "QuestionForbiddenError"; }
  export type SaveQuestionResult = "saved" | "invalid" | "conflict" | "unavailable";
  export type AskRefusal = "signed-out" | "forbidden" | "demo" | "unavailable";
  export type Asker = { ask(text: string, signal: AbortSignal): AsyncIterable<string> };
  export type QuestionNotesDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: { list…; get…; save… }; // Task 2's methods (a structural type)
    chatModel: string | undefined; // undefined without OpenAI
    answer: ((text: string, signal: AbortSignal, onUsage: (u: OpenAiUsage) => void) => AsyncIterable<string>) | undefined;
    recordUsage: (entry: OpenAiUsage & { ownerId: string; feature: "quick_question" }) => Promise<void>;
    logError: (code: string, ...details: string[]) => void;
    now: () => Date;
  };
  export function createQuestionNotes(deps: QuestionNotesDeps): {
    list(): Promise<{ chatModel: string; questions: QuestionSummary[] }>;
    get(id: string): Promise<QuestionNote | null>;
    save(input: SaveQuestionInput): Promise<SaveQuestionResult>;
    asker(): Promise<{ ok: true; asker: Asker } | { ok: false; reason: AskRefusal }>;
  };

  // answer-stream-response.ts
  // Waits for the first piece: a failure before it is a 502 JSON error, after
  // it an "error" line; "done" ends a finished answer (see 設計者の判断 2).
  export async function answerStreamResponse(pieces: AsyncIterable<string>): Promise<Response>;

  // quick-question-controller.ts
  export async function handleQuickQuestion(
    request: Request,
    deps: { asker: () => ReturnType<QuestionNotes["asker"]> },
  ): Promise<Response>;

  // question-save-controller.ts
  export async function handleQuestionSave(
    input: unknown,
    deps: { getViewer: () => Promise<{ role: AppRole } | null>; save: (note: SaveQuestionInput) => Promise<SaveQuestionResult> },
  ): Promise<ActionResult>;
  ```

  `createQuestionNotes` の決まり：
  - 持ち主は `user.githubId`（`isMemberRole` で `githubId` があるときだけ）、払う人は `user.actorId ?? user.githubId`。
  - `list`：持ち主が無ければ `QuestionForbiddenError`。`{ chatModel: deps.chatModel ?? "", questions: store.list(owner, QUESTION_LIST_LIMIT) }`。
  - `get`：持ち主 → `id` が `QUESTION_ID` に合わなければ store を呼ばずに `null`。
  - `save`：持ち主 → `checkQuestionNote` が `null` なら `"invalid"` → `chatModel` が無ければ `"unavailable"` → `now` を 1 回取り `store.save` → `true` なら `"saved"`、`false` なら `"conflict"`。
  - `asker`：`null` → `"signed-out"`、役割か `githubId` が無い → `"forbidden"`、`user.demo` → `"demo"`、`answer` か `chatModel` が無い → `"unavailable"`。
  - `ask` は `deps.answer` を包む generator。失敗は `signal.aborted` でなければ `logError("QUICK_QUESTION_FAILED", <OpenAI のコード、なければエラーの名前>)` してから投げ直す。`finally` で、報告された利用量を `recordUsage({ ownerId: actorId, feature: "quick_question", … })` する（失敗は `logError("AI_USAGE_NOT_RECORDED", "quick_question", <名前>)`）。
  - コードを取り出すときは、`error.message` が `/^OPENAI_[A-Z_]+$/` に合うときだけそれを使う（application は infrastructure を import しない）。

  `handleQuickQuestion` は「Global Constraints」の順に行う。本文は `readLimitedBody(request, 262_144)`、`TextDecoder` で読んで `JSON.parse`（失敗は `400` の Go の形）、`quickQuestionText`、`asker.ask(text, request.signal)` を `answerStreamResponse` に渡す。

  `handleQuestionSave` は次の順に行う。
  1. viewer が admin・member でない → `accountForbiddenMessage`。
  2. zod（今の `inputSchema`。`id` は `z.string().regex(QUESTION_ID)` にする）が合わない → `質問ノートの形式が不正です。`
  3. `attemptGo("QUESTION_SAVE_FAILED", () => save(…))`。失敗はそのまま返す。
  4. `"invalid"` → `質問ノートの形式が不正です。`、`"conflict"`・`"unavailable"` → `console.error("QUESTION_SAVE_FAILED", <結果>)` と `genericErrorMessage`、`"saved"` → `{ ok: true }`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/question-notes.test.ts`（`tests/practice-records.test.ts` の利用者の作り方にならう）：
    - `quick questions follow the signed-in owner and bill the actor`：
      - 会員 → 一覧・1 件・保存の持ち主は会員、質問の利用量の `ownerId` も会員。
      - 会員として操作している admin → ノートは会員、利用量は admin（`actorId`）。`feature` は `"quick_question"`、`model` は `chatModel`。
      - デモ → 一覧・1 件・保存はできる。`asker` は `"demo"`（`answer` は呼ばれない）。
      - 未ログイン → `asker` は `"signed-out"`、ほかは `QuestionForbiddenError`。ゲスト・`githubId` なし → `"forbidden"`・`QuestionForbiddenError`。store は呼ばれない。
    - `without OpenAI the notes stay readable`：`chatModel: undefined` → 一覧の `chatModel` は `""`、`asker` は `"unavailable"`、正しいノートの保存は `"unavailable"`（store は呼ばれない）。
    - `get of an id of the wrong shape is null without asking the store`。
    - `a note id saved with other content is a conflict`：不正 → `"invalid"`（store なし）。store が `false` → `"conflict"`、`true` → `"saved"`。store に渡るのは削ったノート・`chatModel`・`deps.now()` の値。
    - `usage is recorded before the answer ends, even when it fails`：`answer` が利用量を報告してから投げる → 投げ直す前に `recordUsage` が 1 回。`recordUsage` が投げても答えは変わらず、`AI_USAGE_NOT_RECORDED` のログ。止めた `signal` の失敗は `QUICK_QUESTION_FAILED` を記録しない。
  - `tests/answer-stream-response.test.ts`：
    - `pieces become delta lines and done`：本文が `{"type":"delta","text":"你"}\n{"type":"delta","text":"好"}\n{"type":"done"}\n`、3 つのヘッダー、`200`。
    - `a failure before the first piece is a 502 and after it an error line`：前 → `502`、`{"error":{"code":"chat_failed","message":"ChatGPTから応答を受信できませんでした。"}}`。後 → `200`、最後の行が `{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}`。
    - `an answer without pieces is only done`。
    - `cancelling the response returns the iterator`（`response.body.cancel()` で generator の `finally` が走る）。
  - `tests/quick-question-controller.test.ts`（`tests/chat-relay-controller.test.ts` の `request()` を写す）：「Global Constraints」の 1〜8 の各行の状態と本文。順番も確かめる（同じ origin でないゲストは `403` の `{"error":"この画面から送信してください。"}`、デモの不正な本文は `403` の「デモでは使えません。」）。通った本文では `ask` に削らない `text` と `request.signal` が渡る。
  - `tests/question-save-controller.test.ts`：権限なし（`null`・guest）→ `accountForbiddenMessage`（`save` なし）。大文字の UUID・空の `answer` → `質問ノートの形式が不正です。`。`"invalid"`・`"conflict"`・`"unavailable"`・`"saved"` の 4 つ。`save` が `QuestionForbiddenError` → `accountForbiddenMessage`、ふつうの `Error` → `genericErrorMessage`（ログはコードとエラーの名前だけ）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/question-notes.test.ts tests/answer-stream-response.test.ts tests/quick-question-controller.test.ts tests/question-save-controller.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `question-container.ts`（`vocabulary-container.ts` と同じく、`openAiConfig()` はモジュールを読むときに 1 回だけ）：
    ```ts
    const openAi = openAiConfig();
    export const questionNotes = createQuestionNotes({
      currentUser: getCachedCurrentUser,
      store: createQuestionStore(prisma),
      chatModel: openAi?.chatModel,
      answer: openAi
        ? (text, signal, onUsage) =>
            streamAnswer(
              openAi,
              {
                model: openAi.chatModel,
                instructions: QUICK_QUESTION_INSTRUCTIONS,
                messages: [{ role: "user", text }],
                requireComplete: true,
              },
              { signal, onUsage },
            )
        : undefined,
      recordUsage: (entry) => recordAiUsage(prisma, entry),
      logError: (code, ...details) => console.error(code, ...details),
      now: () => new Date(),
    });
    ```
  - `route.ts`：`export const dynamic = "force-dynamic"; export const maxDuration = 90; export async function POST(request: Request) { return handleQuickQuestion(request, { asker: () => questionNotes.asker() }); }`
  - `question-actions.ts`：`saveQuestionAction` の名前と引数の型は変えず、`handleQuestionSave(input, { getViewer: getCurrentViewerUser, save: (note) => questionNotes.save(note) })` を返すだけにする。revalidate しない（今のまま）。
  - ページ：`questionNotes.list()`・`get()` の呼び方は変えない。`ChatUnavailableError` の import と catch、`/questions` の `questions === null` の分岐を消す。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
  - `grep -rn "question-gateway\|/v1/questions\|/v1/quick-question\|upstreamPath" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): クイック質問と質問ノートを Go に頼まずに行う`

### Task 4: Go の質問のコードを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §8 の「Becomes dead」と §7 の「keep」に従う）：
  - 消す：`httpapi/question_handlers.go`、`httpapi/question_handlers_test.go`、`store/questions.go`、`store/questions_test.go`。
  - `router.go`：`Deps.QuickChat`・`Questions`（とコメントの「and Questions」「QuickChat」「asking a question」「question notes」）、`r.questionRoutes()` と `questionRoutes` を消す。
  - `main.go`：`Questions: db`、`deps.QuickChat = …`、コメントの「question notes」を消す。
  - `chat_handlers.go`：`streamMessages` を `streamChat` にまとめ、`quick` と 4000 の確かめを消す。
  - `chat/chat.go`：`QuickQuestionPrompt` を消す。`chat/openai.go`：`Instructions`・`RequireComplete` を消し、指示文はいつも `SystemPrompt`、`response.incomplete` はいつも終わり。`openai/openai.go`：`CodeIncompleteResponse` を消す。`aiusage/aiusage.go`：`FeatureQuickQuestion` を消す（「never rename」のコメントの下に、`"quick_question"` は Web が書くと 1 行足す）。
  - `chat/openai_test.go`：`TestQuickQuestionPromptAndIncompleteAnswer` を消す。`httpapi/ai_usage_handlers_test.go`：`TestQuickQuestionRecordsItsFeature` を消す。
- テストの書き直し（設計者の判断 13）：
  - `httpapi/chat_handlers_test.go`：`fakeConversations` に `listOwner string` を足し、`ListConversations` で覚える。
  - `httpapi/act_as_test.go:33-55`：`TestActAsWritesGoToTheMember` を `PUT /v1/conversations/{testConversationID}`（`Chat: &fakeChat{}`、`Conversations: conv`、本文は `chat_handlers_test.go` の `TestConversationCRUD` の正しい会話）で書き直す。`conv.putOwner == actedMember` と「acting as member」のログを確かめる。`:98` の deps から `QuickChat`・`Questions` を消す。
  - `httpapi/demo_test.go`：`allRoutesDeps`（:45）から 2 つの欄を消し、閉じたルートの表（:56-69）から `"POST /v1/quick-question"` を消す。`TestDemoKeepsItsOwnRecords`（:99-113）を `GET /v1/conversations` と `conv.listOwner == testOwner` で書き直す。
  - `httpapi/router_test.go`：`:26,61,134` の 2 つの欄を消す。`TestSavedNotesReadableWithoutOpenAI`（:159-198）から質問ノートの部分を消し、コメントを会話ノートだけにする。
- Modify（docs-site。段階 1〜5 と同じ扱い）：
  - `docs-site/reference/quick-questions.md` を消し、`docs-site/.vuepress/config.ts:34` のナビから外す。
  - `docs-site/reference/README.md:7` から `POST /v1/quick-question` と「質問ノートの `PUT`」を外す。
  - `docs-site/reference/admin.md:140` を「クイック質問（Web の `POST /api/quick-question`。Web が記録）」にする。
  - `docs-site/README.md:27` の「Web が Prisma で直接扱うため」の列に「質問ノートとクイック質問」を足す。
- Modify：`e2e/openai-stub.ts`、`e2e/quick-question.spec.ts`、`e2e/act-as.spec.ts`、`e2e/demo.spec.ts`（`:86` のコメントの「Go refuses」を「The web refuses」にするだけ）

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
  - `grep -rn "quick-question\|/v1/questions\|QuickChat\|fakeQuestions\|QuickQuestionPrompt\|RequireComplete\|FeatureQuickQuestion\|CodeIncompleteResponse\|PutQuestion\|ListQuestions" services/api` → 何も出ない（`store/demo.go:67` と `store/demo_test.go:201` の表の名前 `"QuickQuestion"` は残る）。
- [ ] **Step 2: e2e の偽物と、足りない e2e を足す（設計者の判断 14）。**
  - `e2e/openai-stub.ts`：`response.completed` に `usage: { input_tokens: 21, output_tokens: 43, total_tokens: 64 }`。`[incomplete]` → `你好！` の 1 つの断片と、`usage` の付いた `response.incomplete`。`[fail]` → `500`。先頭のコメントを直す。
  - `e2e/quick-question.spec.ts`：`an answer OpenAI cuts or refuses is not saved`
    - admin で `[incomplete] 了？` を送る → 「ChatGPTから応答を受信できませんでした。」が出る。`你好！` は画面に残る。入力欄は送った文のまま。
    - `[fail] 了？` → 同じ文言（`502` の本文から）。
    - DB：`QuickQuestion` は 0 行。`AiUsage` は `feature 'quick_question'` で 1 行（incomplete の分。`[fail]` は利用量が無い）、`ownerId` は `10001`、`model` は `gpt-6.1-sol`、`21`・`43`。
  - `e2e/quick-question.spec.ts`：`a question note id cannot be overwritten`
    - admin で 1 回質問し、保存の POST を捕まえる（`page.on("request")` で `method() === "POST"`・`pathname === "/quick-question"`・`headers()["next-action"]` があるもの。`e2e/prepositions.spec.ts:93` と同じ）。
    - 同じ本文を `page.request.fetch(captured)` で送り直す → `200`、本文に `{"ok":true}`。`QuickQuestion` は 1 行。
    - 本文の回答の文字列を `"書き換え"` に置き換えて送る → 本文に `処理できませんでした。時間をおいてもう一度お試しください。`。行の `answer`・`createdAt` は変わらない。
    - 別の context で会員としてログインし、その `page.request.post(captured.url(), { headers: next-action ほか, data: captured.postData() })` で同じ本文を送る → 一般的な文言。行は 1 つで、`ownerId` は `10001` のまま。
  - `e2e/act-as.spec.ts`：`an admin acting as a member asks as the member and pays for it`
    - 会員を作り、管理者が「この会員として操作」してから `/quick-question` で質問し、「質問ノートに保存しました。」まで待つ。
    - DB：`QuickQuestion` は 1 行で `ownerId` は会員。`AiUsage` の `quick_question` は 1 行で `ownerId` は `adminOwnerId`（会員の行は 0）。
  - 既存の `quick-question.spec.ts` の 4 本・`demo.spec.ts:86`・`bottom-navigation.spec.ts` は変えずに通ること（ブラウザに返す形を変えていない確かめ）。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。`quick-question`・`demo`・`act-as`・`chat`（偽物の変更が Go のチャットを壊していない）・`bottom-navigation`・`security` を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go のクイック質問と質問ノートのルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`README.md`（変える必要があれば）

- [ ] **Step 1: 直す。**
  - `docs/features.md:7`：利用量は「Go API が」ではなく、単語帳の下書きとクイック質問は Web、ほかは Go が記録する、と書く。`:14`：デモを断るのは Go と Web（クイック質問は Web）にする。
  - `docs/architecture.md` の「8. AI と費用」：OpenAI を呼ぶ 4 か所のうち、単語帳の下書きとクイック質問が Web（`src/infrastructure/openai/`）。表のクイック質問の「返し方」を「ストリーミング（Web の Route Handler から NDJSON で直接）」にする。テキストの前の失敗は 502、後は `error` 行、切れた答えは保存しないことを 1〜2 行で足す。
  - `docs/api-deployment.md`：
    - 「3. 環境変数」の Web の表（`:160` あたり）に `OPENAI_CHAT_MODEL`（クイック質問のモデル。任意。無ければ `gpt-6.1-sol`。Go と同じ値にする）を足す。`:167` の「Go API にも、LINE・ChatGPT と話す・クイック質問のために」から「クイック質問」を外す。
    - `:399` のデモの使えないものの `POST /v1/quick-question` を、Web の `POST /api/quick-question` にする。
    - 「段階5（練習の記録）のマージの前と後」のあとに、「段階6（質問）のマージの前と後」を足す。
    - マージの前：
      - マイグレーションはない。Web の Production の `OPENAI_API_KEY` は段階 1 で入っている。
      - Go の Production に `OPENAI_CHAT_MODEL` が入っているかを利用者に確かめ、入っていれば Web の Production にも同じ値を入れる（入っていなければ、両方とも既定の `gpt-6.1-sol` で同じ）。
    - マージのあと：
      1. Web の Production のデプロイが Ready になったことを確かめる。
      2. `vercel promote` で切り替える。
      3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/quick-question` と `/v1/questions*` が本番の Go から消える。
    - 切り替えのあいだ：古い Go と新しい Web が同じ `QuickQuestion` の表に書いても問題ない。行の形と「同じ id は同じ内容のときだけ成功」の決まりが同じだから。利用量も同じ `feature`（`quick_question`）で同じ表に入る。
    - 戻すとき：
      - Go だけを戻しても害はない。
      - Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/quick-question` と `/v1/questions*` を呼んで `404` になる。
        - 質問すると「見つかりません。」になる。
        - 質問ノートのページはエラーの表示になる。
        - `/quick-question` は「クイック質問を利用できません」になる。
      - Web を戻すなら Go も戻す。いっしょに戻すのがいちばん安全。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。`grep -rn "quick-question\|/v1/questions" docs README.md docs-site --include='*.md'`（`docs/releases/` と `docs/superpowers/` を除く）で、残っているのが Web のルート（`/api/quick-question`・`/quick-question` のページ）と歴史の記録だけであることを確かめる。
- [ ] **Step 3: コミット。** `docs: クイック質問と質問ノートを Web に移したことを書く`
