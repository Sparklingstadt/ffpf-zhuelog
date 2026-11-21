# Go 廃止 段階 7（チャット・会話ノート）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「ChatGPT と話す」（`POST /v1/chat`。OpenAI へのストリーミング）と会話ノート（`GET/PUT/DELETE /v1/conversations(/{id})`）を、Go API から Next.js に移す。`/api/chat` は Go への中継をやめ、Route Handler が OpenAI を直接呼んで答えをストリームで返す。使った量は `AiUsage` に Web が `chat` として記録する。Go のチャットのコードを消す（デモのリセットが使う型は残す）。

**Architecture:** 段階 6 で作った部品をそのまま使い、段階 1〜6 と同じ形にする。

- チャットの本文の確かめ（Go の `chat.Validate`）と、保存する会話の確かめ（Go の `validConversation`）は、I/O の無い純粋な関数として `src/domain/chat/conversation.ts` に置く。
- OpenAI の呼び出しは段階 6 の `streamAnswer`（`requireComplete: false`）。指示文は `src/infrastructure/openai/chat.ts` の `CHAT_INSTRUCTIONS`。
- DB の読み書きは `src/infrastructure/prisma/conversation-store.ts` に置く。保存は Go と同じ 1 つの `INSERT … ON CONFLICT … WHERE` の SQL（段階 5 の `review-store.ts` と同じ理由）。
- 持ち主・払う人・デモ・OpenAI の有無の判断は `src/application/chat/conversation-notes.ts` に置く。クイック質問と同じ判断（`person`、利用量を記録しながら答えを流す generator、失敗のコード）は `src/application/chat/chat-user.ts` に出して、両方が使う。
- ブラウザへの NDJSON は段階 6 の `answerStreamResponse`。Route Handler の判定（origin・JSON・だれ・大きさ・本文）は、クイック質問と共通の `src/presentation/controllers/answer-request-controller.ts` に出し、`quick-question-controller.ts` と新しい `chat-controller.ts` が使う。保存・削除の Server Action の判定は `src/presentation/controllers/conversation-controller.ts`。
- `src/composition/chat-container.ts` の `conversationNotes` を新しい実装にする。`list`・`get`・`save`・`remove` の名前は変えないので、ページはほぼ変えない。
- 画面、Server Action の名前と引数、ブラウザ側のフック（`use-chat-conversation.ts`・`use-answer-stream.ts`・`chat-stream.ts`）、ブラウザに返す形（NDJSON とエラーの JSON）は変えない。

**Tech Stack:** Next.js 16.4（Route Handler・`maxDuration`・Server Action）、TypeScript、Prisma 7（`$executeRaw`）、zod、`node:test` + `tsx`、Playwright。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 7、決めたこと 7〜9・11）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage7-go-reference.md`（以下「参照」）。だれが使えるか、確かめの規則と文言、指示文の全文、OpenAI に送る本文、保存の SQL、Go に残すべきコードが file:line 付きで書いてある。ストリームの細部は段階 6 の参照 §1・§2。

## 設計者の判断（コントローラーが確かめること）

1. **`/api/chat` の中継をやめ、Route Handler が OpenAI を直接呼ぶ。** 段階 6 の `streamAnswer` と `answerStreamResponse` をそのまま使う。ブラウザに返す NDJSON の行・ヘッダー、502 と `error` 行の分かれ目は段階 6 の判断 1・2 と同じ。`src/composition/chat-relay.ts`・`chat-relay-controller.ts`・そのテストは消す（`limited-body.ts` は残る）。
2. **チャットは `requireComplete: false`。** Go と同じく、`response.incomplete`（トークンの上限で切れた）は成功で、ブラウザには `done` が届き、会話にそのまま保存される。クイック質問（切れた答えは保存しない）とはここだけが違う。
3. **指示文は Go の `SystemPrompt` を 1 文字も変えずに写す**（参照 §2 の 8 行）。モデルは段階 6 の `openAiConfig().chatModel`（`OPENAI_CHAT_MODEL`、無ければ `gpt-6.1-sol`）。`input` はすべての発言を順に、削らずに送る。
4. **だれが何をできるかは Go と同じにする。**
   - 管理者だけではない。admin と会員（`githubId` があるとき）。ゲストは使えない。
   - 話す（`POST /api/chat`）：デモは `403`「デモでは使えません。」。会員として操作している admin は話せる（会話は会員、利用量は admin）。
   - 一覧・1 件・保存・削除：admin と会員（デモを含む）。会員として操作している admin は会員の会話。デモが保存・削除できるのも Go の `private` のまま写す。
   - 利用量：`ownerId` は `actorId ?? githubId`、`feature` は `"chat"`（変えない）、`model` は `chatModel`。
5. **クイック質問と同じ判断は 1 か所にまとめる。** `person`（持ち主と払う人）、`AskRefusal`、利用量を `finally` で記録しながら答えを流す generator（失敗のログ、`signal.aborted` なら記録しない、5 秒の上限）を `src/application/chat/chat-user.ts` に移し、`question-notes.ts` もそれを使う。Route Handler の順番と返すエラーも `answer-request-controller.ts` にまとめ、`handleQuickQuestion` は本文の読み方（`quickQuestionText`）を渡すだけにする。今の `tests/question-notes.test.ts` と `tests/quick-question-controller.test.ts` は 1 行も変えずに通ること（まとめた確かめ）。チャットの失敗のログのコードは `CHAT_FAILED`。
6. **保存は今のまま、答えを受け取ったブラウザが会話全体を Server Action で送る。** サーバーが答えのあとに自分で保存する形にはしない（今のフックと e2e `a save that fails says so and is retried after the next answer` を変えないため）。そのため、送られた会話は形と上限だけを確かめる（OpenAI の答えと同じかは見ない。Go と同じ）。`modelName` も Go と同じくブラウザが送った値を保存する（質問ノートと違い、サーバーの値で上書きしない）。
7. **保存は Go と同じ 1 つの SQL にする。** `INSERT … ON CONFLICT ("id") DO UPDATE SET title, modelName, ended, messages, updatedAt … WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId"` を `$executeRaw` で流し、変わった行数が `1` なら `"saved"`、`0`（ほかの人の id）なら `"conflict"`。Prisma の `upsert` は更新に WHERE を付けられないため（段階 5 の `enqueueReviewItemsSql` と同じ理由。コメントに書く）。`createdAt` は最初の値のまま、`updatedAt` は `now`。
8. **読むのは Prisma のクエリ。** 一覧は `100` 件、`createdAt` の新しい順、同じなら `id` の大きい順、`messages` は読まない。1 件は `findUnique({ where: { id_ownerId } })`。`id` が `CONVERSATION_ID` に合わなければ DB を読まずに `null`。`messages`（JSON）は `readConversationMessages` で `{id, role, text}` の配列に読み、形が違えば投げる（Go の `json.Unmarshal` の失敗が 500 だったのと同じ）。
9. **削除は `deleteMany({ where: { id, ownerId } })`。** 消えた行が 0（無い・ほかの人の・形の違う id）なら `false` → 今と同じ一般的な文言（Go の `404` も一般的な文言だった）。成功したら今と同じく `revalidatePath` と `redirect`。
10. **OpenAI が無いときは、Go と同じく「話す」と「保存」だけが無い。** 一覧の `chatModel` は `""`（`/chat` は「ChatGPT が設定されていません」）、`POST /api/chat` は `404 {"error":{"code":"not_found","message":"見つかりません。"}}`、保存は `"unavailable"` → 一般的な文言。読む・消すはいつでもできる。
11. **`ChatUnavailableError` を消す。** 投げる所（Go のゲートウェイ）がなくなるため。`chat-guard.ts` の `loadConversationList` は配列を返すだけにし、`/conversations`・日付のページの「設定されていない」と `notFound()` の分岐（本番では出ない）も消す。`/chat` の EmptyState の説明だけは「Go API に OPENAI_API_KEY を設定すると、ここで会話できます。」が誤りになるので「Web に OPENAI_API_KEY を設定すると、ここで会話できます。」に直す（OpenAI の無い環境でしか出ない文言）。
12. **ブラウザに返すエラーの形は、段階 6 と同じ 2 種類を残す。** 中継が自分で返していたもの（同じ origin でない `403`・`415`・`413`・本文が読めない `400`）は `{"error": string}`。Go が返していたもの（`401`・`403`・`404`・`400`・`502`）は `{"error":{"code","message"}}`。未ログインの `401` は、中継の `{"error":"認証が必要です。"}` から Go の形に変わる（`chat-stream.ts` はどちらも読む。段階 6 と同じ）。
13. **Route Handler に `export const maxDuration = 90`。** 段階 6 のクイック質問と同じ（本番で 90 秒が通ることは段階 6 で確かめ済み）。
14. **Go に残るテストのうち、消えるルートを通っていたものは、残るルートで書き直す。**
    - `TestActAsWritesGoToTheMember` → `PUT /v1/follows/{ownerId}`（フォローする人が会員になる）。
    - `TestDemoKeepsItsOwnRecords` → `GET /v1/study-log`（デモが自分の学習ログを読める）。
    - `TestSavedNotesReadableWithoutOpenAI` は、Go に OpenAI を使うルートが LINE しか残らないので消す。
    - `store/demo_test.go` の会話の確かめは SQL で数える。
    - 使われ続けるテストの道具（`newUUID`・`jsonAuth`）は、残るファイルに移す。
15. **Go は、チャットのためだけのコードをすべて消す。** `chat` パッケージ全体、`chat_handlers.go`、`store/conversations.go`（デモのリセットが使う 3 つの型は `store/demo.go` に移して残す）、`trackAIUsage`・`recordTimeout`・`trackAI`、`httpapi.AIUsage` の `RecordAIUsage`、`aiusage.FeatureChat`、`openai.Request.Accept`、`config` の `OpenAIChatModel`・`ChatEnabled`、`respond.go` のチャットの文言と `validUUID`。Go の `OPENAI_API_KEY` は LINE のためだけになる。
16. **e2e の足りない所を足す**（参照 §6 の Gaps）。OpenAI の偽物は段階 6 で広げたので変えない。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（Route Handler のストリーム、`maxDuration`、Server Action、`revalidatePath`・`redirect`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない（判断 11 の 1 つを除く）。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は何も import しない（同じ domain の型と関数を除く）。
- 持ち主（参照 §0）：
  - 会話は常に今の利用者の `githubId`（admin が会員として操作するときは会員の ownerId）。フォームの値は使わない。
  - 利用量は `actorId ?? githubId`、`feature: "chat"`。
  - 未ログイン → 話すのは `401`、一覧・1 件・保存・削除は `ConversationForbiddenError`。ゲスト・`githubId` なし → 話すのは `403`「このアカウントは利用できません。」、ほかは `ConversationForbiddenError`。
- チャットの本文の確かめ（参照 §1。満たさなければ `400 {"error":{"code":"invalid_request","message":"会話内容が上限を超えているか、形式が不正です。"}}`）：
  - 本文は JSON の 1 つのオブジェクトで、キーは `messages` だけ。`messages` は配列で、要素のキーは `role`・`text` だけ（どちらも文字列）。知らないキーは不正。
  - 要素は `1`〜`40` 個。どの `role` も `"user"` か `"assistant"`、最後は `"user"`。どの `text` も `trim()` が空でない。
  - すべての `text` の `[...text].length` の合計が `40_000` 以下（削る前）。1 つの発言の上限は無い（`4000` は入力欄だけ）。
  - OpenAI には削らずに、順に送る。
- 保存する会話の確かめ（参照 §3。`checkConversation`）：
  - `id` は `CONVERSATION_ID` = `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`。
  - `title.trim()` が `1`〜`100` コードポイント。保存するのは削ったもの。
  - `modelName` は空でなく `150` コードポイント以下（削らない）。
  - `createdAt` は `z.iso.datetime()` に合い、`new Date(createdAt)` が有効な日時。
  - `messages` は `1`〜`40` 個。各 `id` は空でなく `200` コードポイント以下で、会話の中で重ならない。`role` は `"user"`・`"assistant"`。`text.trim()` が空でない。
  - `text` のコードポイントの合計が `40_000` 以下。ただし最後の発言が `"assistant"` なら、それは合計から除き、それ自体が `MAX_ANSWER_CHARS`（`20_000`）以下。
  - 知らないキーは zod が落とす（Go は 400 だったが、ブラウザは送らない）。
- `POST /api/chat` の順番（参照 §1・§6。段階 6 のクイック質問と同じ）：
  1. 同じ origin でない → `403 {"error":"この画面から送信してください。"}`
  2. `content-type` が `application/json` でない → `415 {"error":"JSON形式で送信してください。"}`
  3. 未ログイン → `401 {"error":{"code":"unauthorized","message":"認証が必要です。"}}`
  4. ゲスト・`githubId` なし → `403 {"error":{"code":"forbidden","message":"このアカウントは利用できません。"}}`
  5. デモ → `403 {"error":{"code":"forbidden","message":"デモでは使えません。"}}`
  6. OpenAI なし → `404 {"error":{"code":"not_found","message":"見つかりません。"}}`
  7. 本文が `262_144` バイトを超える → `413 {"error":"会話が大きすぎます。"}`。読めない → `400 {"error":"リクエストを読み取れませんでした。"}`
  8. JSON にならない・本文の確かめ → 上の `400`
  9. ストリーム（判断 1・2）。失敗の文言は `ChatGPTから応答を受信できませんでした。`
  - すべての応答に `Cache-Control: no-store`。
- OpenAI への要求（参照 §2）：段階 6 の Global Constraints の「OpenAI への要求」と同じ。違うのは、`instructions: CHAT_INSTRUCTIONS`、`input` がすべての発言（`[{ role, content: text }, …]`）、`requireComplete: false` だけ。
- 保存（参照 §3・§4）：`now` は 1 回の処理で 1 度。結果は `"saved" | "invalid" | "conflict" | "unavailable"`。`messages` は `{id, role, text}` だけにして `JSON.stringify` し、`::jsonb` で渡す。
- 読む（参照 §4）：一覧は `CONVERSATION_LIST_LIMIT = 100` 件、`[{ createdAt: "desc" }, { id: "desc" }]`、`id`・`title`・`modelName`・`ended`・`createdAt`・`updatedAt` だけ。
- 文言（今のまま）：
  - 保存：権限 → `accountForbiddenMessage`、形・`"invalid"` → `会話の形式または上限を確認してください。`、`"conflict"`・`"unavailable"`・そのほか → `genericErrorMessage`（ログは `CONVERSATION_SAVE_FAILED` と結果かエラーの名前だけ）。フックはこの文言を出さず「保存できませんでした。…」を出す（変えない）。
  - 削除：権限 → `actionUnauthorized`、形 → `会話の形式または上限を確認してください。`、`false` → `genericErrorMessage`（ログ `CONVERSATION_DELETE_FAILED`, `"not-found"`）、成功 → `revalidatePath("/conversations", "layout")` と `redirect("/conversations")`。
  - チャットの失敗のログは `CHAT_FAILED` と OpenAI のコード（なければエラーの名前）。利用量の記録の失敗は `AI_USAGE_NOT_RECORDED`, `"chat"`, エラーの名前。ブラウザが止めたとき（`signal.aborted`）は失敗を記録しない。発言の本文は、どこにも記録しない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（DB のテストは Docker があれば）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **チャットの答えの終わり方が Go と同じか。** テキストの前の失敗は 502、後の失敗は `error` 行、トークンの上限で切れた答えは `done` で保存される。→ Task 3 のテスト `a chat answer cut at the token limit still ends with done`、Task 4 の e2e `an answer OpenAI cuts at its limit is kept, a refused one is not`。
2. **OpenAI に送るものが Go と同じか。** モデル、`SystemPrompt` の全文、すべての発言を削らずに順に、`stream`・`store`・`max_output_tokens`・`reasoning`。→ Task 1 のテスト `the chat request is the one Go sent`。
3. **だれが話せ、だれの会話・だれの払いになるか。** デモは `403`「デモでは使えません。」でも会話は読める・消せる。ゲストは `403`、未ログインは `401`。会員として操作している admin が話すと、会話は会員、利用量は admin。→ Task 3 のテスト `conversations follow the signed-in owner and chats bill the actor`、Task 4 の e2e `an admin acting as a member saves the conversation as the member's`（利用量を足す）と `e2e/demo.spec.ts:28`（`/api/chat` を足す）。
4. **ほかの人の会話は読めず、書き換わらない。最初の `createdAt` は残る。** → Task 2 のテスト `saveConversationSql updates only the owner's row and keeps createdAt`、Task 4 の e2e `another owner's conversation cannot be read or overwritten`。
5. **確かめが Go と同じか。** 本文：1〜40 個、最後は `user`、空白だけは不可、合計 40 000（削る前）、知らないキーは不可。保存：題 100、モデル名 150、id 200 と重複、最後の答えは合計から除いて 20 000。4 バイトの文字。→ Task 1 のテスト `chat messages are checked as Go checked them` と `a saved conversation is checked as Go checked it`。

---

### Task 1: チャットの本文と会話の確かめ、指示文（純粋な部分）

**Files:**

- Modify: `src/domain/chat/conversation.ts`
- Create: `src/infrastructure/openai/chat.ts`（`CHAT_INSTRUCTIONS` だけ）
- Test: `tests/conversation.test.ts`（足す）、`tests/openai-answer-stream.test.ts`（1 本足す）

**Interfaces:**

- Produces:

  ```ts
  // conversation.ts (the existing types, MAX_MESSAGES, MAX_TOTAL_CHARS,
  // MAX_INPUT_CHARS, conversationTitle and fitsLimits stay)
  export type ChatTurn = { role: ChatRole; text: string };
  export const CONVERSATION_LIST_LIMIT = 100;
  // A lower-case UUID, as the browser's crypto.randomUUID() makes them.
  export const CONVERSATION_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  export const MAX_SAVED_TITLE_CHARS = 100;
  export const MAX_MODEL_NAME_CHARS = 150;
  export const MAX_MESSAGE_ID_CHARS = 200;
  // What the browser sends to save a conversation (createdAt is ISO 8601).
  export type SaveConversationInput = {
    id: string;
    title: string;
    modelName: string;
    ended: boolean;
    createdAt: string;
    messages: ConversationMessage[];
  };
  // A conversation as it is saved: title trimmed, createdAt a Date.
  export type CheckedConversation = Omit<Conversation, "updatedAt">;
  // The turns of a POST /api/chat body, untrimmed, or null when Go would
  // have answered 400 (decodeBody plus chat.Validate).
  export function chatTurns(body: unknown): ChatTurn[] | null;
  // The conversation as it is saved, or null when Go would have answered
  // 400 or 404 (an id of the wrong shape). Go: validConversation.
  export function checkConversation(
    input: SaveConversationInput,
  ): CheckedConversation | null;

  // chat.ts
  // Go: chat/chat.go SystemPrompt, byte for byte.
  export const CHAT_INSTRUCTIONS: string;
  ```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/conversation.test.ts`：
    - `chat messages are checked as Go checked them`：Go の `chat.TestValidate`（参照 §1）の 9 行を写し、本文の形を足す。
      - `null`：`{messages:[]}`、41 個、最後が `assistant`、`role: "system"`、`" \n\t"` だけ、`"字"` × 39 999 + `"好"` + `"你"`（合計 40 001）、`messages` が無い・`null`・配列でない、`text` が数、知らないキー（上の段 `{messages, extra}`・要素の `{role, text, id}`）、本文が配列・文字列。
      - 通る：`user` 1 つ、`user`/`assistant` が交互の 40 個（最後は `user`）、`"字"` × 40 000、`"𠮷"` × 40 000（`s.length` だと 80 000 で落ちる）、前後に空白のある `"  再见 "` → 削らずにそのまま。
    - `a saved conversation is checked as Go checked it`：Go の `TestConversationCRUD` の表と `TestConversationPutAllowsTheLastAnswerOverTheLimit`（参照 §3）を写す。
      - 基準は `{ id: <小文字の UUID>, title: "你好", modelName: "gpt-test", ended: false, createdAt: "2026-10-20T11:00:00.000Z", messages: [m1 user 你好, m2 assistant 你好！] }` → `title` は `"你好"`、`createdAt` は `new Date(...)`、ほかはそのまま。
      - `null`：題 `"字"` × 101、題 `" "`、id の重複、`createdAt: "yesterday"`、`role: "system"`、`messages: []`、空白だけの `text`、モデル名 `"m"` × 151、モデル名 `""`、発言の id `""`・201 文字、41 個、大文字の UUID・`not-a-uuid`。
      - 通る：題 `" 你好 "` → `"你好"`、題 `"字"` × 100、モデル名 150 文字、発言の id 200 文字。
      - 最後の答え：`"字"` × 40 000 + 答え `"答"` × 1500 → 通る。`"字"` × 40 001 + 答え `"答"` → `null`。`"你好"` + 答え `"答"` × 20 001 → `null`。`user` だけの `"字"` × 40 001 → `null`。
  - `tests/openai-answer-stream.test.ts`：`the chat request is the one Go sent`（Go の `TestStreamSendsModelPromptAndStoreFalse`）。`CHAT_INSTRUCTIONS` と 3 つの発言（`你好`・`你好！`・`谢谢`）、`requireComplete: false`、`baseUrl` の末尾に `/` で `streamAnswer` を呼び、偽物の fetch が受け取った本文を `JSON.parse` して `deepEqual`：`{ model, instructions: CHAT_INSTRUCTIONS, input: [3 つの {role, content}], stream: true, store: false, max_output_tokens: 1600, reasoning: { effort: "medium" } }`。`CHAT_INSTRUCTIONS` が参照 §2 の全文と同じ（テストに全文を書く）。偽物が `response.incomplete` で終えても投げない。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/conversation.test.ts tests/openai-answer-stream.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 文字数は `[...s].length`。`MAX_ANSWER_CHARS` は `./question` から import する（同じ domain）。
  - キーの数え方と `isRecord` は `question.ts` と同じ書き方にする（2 つの小さな関数は `conversation.ts` に写してよい。共通の 1 か所に出すなら `src/domain/chat/json-shape.ts`）。
  - 先頭のコメント「An admin's practice conversation … The Go API checks the same limits」を、会員と管理者の会話で、Web が上限を確かめる、に直す。
  - `CHAT_INSTRUCTIONS` はテンプレート文字列で、Go と同じ改行（行頭に空白を入れない、最後に改行を付けない）。
  - 各関数の上に、Go のどこにあたるかを英語のコメントで 1 行書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): チャットの本文と会話ノートの確かめ、チャットの指示文`

### Task 2: 会話ノートの読み書き（Prisma）

**Files:**

- Create: `src/infrastructure/prisma/conversation-store.ts`
- Test: `tests/conversation-store.test.ts`（新規。純粋な部分だけ）

**Interfaces:**

- Consumes: Task 1 の `CheckedConversation`・`CONVERSATION_ID`・型、`prisma()`、`Prisma`（`src/generated/prisma/client`）。
- Produces:

  ```ts
  // Pure: the one statement that saves a conversation (see 設計者の判断 7).
  export function saveConversationSql(
    ownerId: string,
    conversation: CheckedConversation,
    now: Date,
  ): Prisma.Sql;
  // Pure: the messages column as the domain's messages; throws when a row
  // holds anything else.
  export function readConversationMessages(
    json: unknown,
  ): ConversationMessage[];
  export function createConversationStore(db: () => PrismaClient): {
    list(ownerId: string, limit: number): Promise<ConversationSummary[]>;
    get(ownerId: string, id: string): Promise<Conversation | null>;
    // false: the id is another owner's (nothing changed).
    save(
      ownerId: string,
      conversation: CheckedConversation,
      now: Date,
    ): Promise<boolean>;
    // false: no such conversation of the owner.
    remove(ownerId: string, id: string): Promise<boolean>;
  };
  ```

- [ ] **Step 1: 失敗するテストを書く。** `tests/conversation-store.test.ts`（`tests/review-store.test.ts:74` の `sql.sql`・`sql.values` の見方にならう）：
  - `saveConversationSql updates only the owner's row and keeps createdAt`：空白をつぶした `sql.sql` が `INSERT INTO "ChatConversation" ("id", "ownerId", "title", "modelName", "ended", "messages", "createdAt", "updatedAt")`、`::jsonb`、`ON CONFLICT ("id") DO UPDATE SET "title" = EXCLUDED."title", "modelName" = EXCLUDED."modelName", "ended" = EXCLUDED."ended", "messages" = EXCLUDED."messages", "updatedAt" = EXCLUDED."updatedAt" WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId"` を含み、`SET` に `"createdAt"` が無い。`sql.values` は順に `id`・`ownerId`・削った題・`modelName`・`ended`・`messages` の JSON・`createdAt`・`now`。
  - `the saved messages are only id, role and text`：余分なキーの付いた発言（型を外して渡す）でも、JSON は `[{"id","role","text"}]` だけ。
  - `readConversationMessages reads Go's rows and refuses others`：Go の形の配列 → そのまま。配列でない・`role` が `system`・`text` が数 → 投げる。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/conversation-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - 一覧：`findMany({ where: { ownerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, select: { id, title, modelName, ended, createdAt, updatedAt } })`。
  - 1 件：`id` が `CONVERSATION_ID` に合わなければ `null`。`findUnique({ where: { id_ownerId: { id, ownerId } } })` → `{ …summary, messages: readConversationMessages(row.messages) }`。
  - 保存：`(await db().$executeRaw(saveConversationSql(…))) === 1`。Prisma の `upsert` を使わないわけと、Go の store/conversations.go:84-106 と同じ結果であることをコメントに書く。
  - 削除：`(await db().chatConversation.deleteMany({ where: { id, ownerId } })).count > 0`。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): 会話ノートを Prisma で読み書きする`

### Task 3: application・controller・container・呼ぶ側を差し替える

**Files:**

- Create: `src/application/chat/chat-user.ts`、`src/application/chat/conversation-notes.ts`、`src/presentation/controllers/answer-request-controller.ts`、`src/presentation/controllers/chat-controller.ts`、`src/presentation/controllers/conversation-controller.ts`
- Modify: `src/application/chat/question-notes.ts`（`chat-user.ts` を使う。export する名前と動きは変えない）、`src/presentation/controllers/quick-question-controller.ts`（`handleAnswerRequest` を呼ぶだけ）、`src/composition/chat-container.ts`、`src/app/api/chat/route.ts`、`src/presentation/actions/conversation-actions.ts`（controller を呼ぶだけ。`SaveConversationInput` は domain の型を re-export）、`src/presentation/controllers/action-state.ts`（`isForbidden` に `ConversationForbiddenError`、コメント）、`src/presentation/guards/chat-guard.ts`、`src/app/chat/page.tsx`、`src/app/conversations/page.tsx`、`src/app/conversations/[year]/[month]/[day]/page.tsx`、`src/app/conversations/[year]/[month]/[day]/[number]/page.tsx`、`src/presentation/components/chat/use-chat-conversation.ts`（コメントの「Go accepts it」を外すだけ）
- Delete: `src/composition/chat-relay.ts`、`src/presentation/controllers/chat-relay-controller.ts`、`tests/chat-relay-controller.test.ts`、`src/infrastructure/go-api/conversation-gateway.ts`、`tests/go-api-conversation-gateway.test.ts`、`src/domain/chat/chat-unavailable.ts`
- Test: `tests/conversation-notes.test.ts`、`tests/chat-controller.test.ts`、`tests/conversation-controller.test.ts`（すべて新規）。`tests/question-notes.test.ts`・`tests/quick-question-controller.test.ts` は変えない。

**Interfaces:**

- Consumes: Task 1 の `chatTurns`・`checkConversation`・`CONVERSATION_ID`・`CONVERSATION_LIST_LIMIT`・`CHAT_INSTRUCTIONS`、Task 2 の `createConversationStore`、段階 6 の `streamAnswer`・`answerStreamResponse`・`readLimitedBody`・`recordWithin`・`recordAiUsage`。
- Produces:

  ```ts
  // chat-user.ts (moved out of question-notes.ts)
  export type ChatPerson = { ownerId: string; actorId: string; demo: boolean };
  // null: signed out, a guest or no githubId.
  export function chatPerson(user: AuthenticatedUser | null): ChatPerson | null;
  export type AskRefusal = "signed-out" | "forbidden" | "demo" | "unavailable";
  // Signed in, a member or admin, not the demo (Go's order); null: may ask.
  export function askRefusal(user: AuthenticatedUser | null): Exclude<AskRefusal, "unavailable"> | null;
  // The answer's pieces. A failure is logged as failureCode with OpenAI's
  // code (not when signal was aborted) and rethrown; every reported usage is
  // recorded in finally, each bounded by recordWithin.
  export function meteredAnswer(
    answer: (onUsage: (usage: OpenAiUsage) => void) => AsyncIterable<string>,
    options: {
      signal: AbortSignal;
      failureCode: string;
      feature: string;
      record: (usage: OpenAiUsage) => Promise<void>;
      recordTimeoutMs: number;
      logError: (code: string, ...details: string[]) => void;
    },
  ): AsyncGenerator<string>;

  // conversation-notes.ts
  export class ConversationForbiddenError extends Error { override name = "ConversationForbiddenError"; }
  export type SaveConversationResult = "saved" | "invalid" | "conflict" | "unavailable";
  export type Chatter = { ask(turns: readonly ChatTurn[], signal: AbortSignal): AsyncIterable<string> };
  export type ConversationNotesDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: { list…; get…; save…; remove… }; // Task 2's methods (a structural type)
    chatModel: string | undefined; // undefined without OpenAI
    answer: ((turns: readonly ChatTurn[], signal: AbortSignal, onUsage: (u: OpenAiUsage) => void) => AsyncIterable<string>) | undefined;
    recordUsage: (entry: OpenAiUsage & { ownerId: string; feature: "chat" }) => Promise<void>;
    recordTimeoutMs?: number; // RECORD_TIMEOUT_MS when unset
    logError: (code: string, ...details: string[]) => void;
    now: () => Date;
  };
  export function createConversationNotes(deps: ConversationNotesDeps): {
    list(): Promise<{ chatModel: string; conversations: ConversationSummary[] }>;
    get(id: string): Promise<Conversation | null>;
    save(input: SaveConversationInput): Promise<SaveConversationResult>;
    remove(id: string): Promise<boolean>;
    chatter(): Promise<{ ok: true; asker: Chatter } | { ok: false; reason: AskRefusal }>;
  };

  // answer-request-controller.ts
  // The checks of POST /api/quick-question and /api/chat, in the order the
  // relay and Go made them, then the answer as NDJSON.
  export async function handleAnswerRequest<T>(
    request: Request,
    deps: {
      asker: () => Promise<
        | { ok: true; asker: { ask(input: T, signal: AbortSignal): AsyncIterable<string> } }
        | { ok: false; reason: AskRefusal }
      >;
      read: (body: unknown) => T | null; // null: the 400 of Go's msgChatInvalid
    },
  ): Promise<Response>;

  // chat-controller.ts
  export async function handleChat(
    request: Request,
    deps: { chatter: () => ReturnType<ConversationNotes["chatter"]> },
  ): Promise<Response>; // handleAnswerRequest with read: chatTurns

  // conversation-controller.ts
  export async function handleConversationSave(
    input: unknown,
    deps: { getViewer: () => Promise<{ role: AppRole } | null>; save: (c: SaveConversationInput) => Promise<SaveConversationResult> },
  ): Promise<ActionResult>;
  // actionSuccess when deleted; the action then revalidates and redirects.
  export async function handleConversationDelete(
    formData: FormData,
    deps: { getViewer: () => Promise<{ role: AppRole } | null>; remove: (id: string) => Promise<boolean> },
  ): Promise<ActionState>;
  ```

  `createConversationNotes` の決まり：
  - `list`：持ち主が無ければ `ConversationForbiddenError`。`{ chatModel: deps.chatModel ?? "", conversations: store.list(owner, CONVERSATION_LIST_LIMIT) }`。
  - `get`：持ち主 → `id` が `CONVERSATION_ID` に合わなければ store を呼ばずに `null`。
  - `save`：持ち主 → `checkConversation` が `null` なら `"invalid"` → `chatModel` が無ければ `"unavailable"` → `now` を 1 回取り `store.save` → `true` なら `"saved"`、`false` なら `"conflict"`。
  - `remove`：持ち主 → `id` が `CONVERSATION_ID` に合わなければ store を呼ばずに `false` → `store.remove`。
  - `chatter`：`askRefusal(user)` があればそれ → `answer` か `chatModel` が無ければ `"unavailable"` → `{ ask: (turns, signal) => meteredAnswer((onUsage) => deps.answer(turns, signal, onUsage), { signal, failureCode: "CHAT_FAILED", feature: "chat", record: (u) => deps.recordUsage({ ownerId: actorId, feature: "chat", …u }), … }) }`。

  `handleAnswerRequest` は段階 6 の `handleQuickQuestion` の中身をそのまま移したもの（「Global Constraints」の 1〜9）。`JSON.parse` の失敗と `read` の `null` は同じ `400`。

  `handleConversationSave` は次の順に行う。
  1. viewer が admin・member でない → `accountForbiddenMessage`。
  2. zod（今の `conversationInput`。`id` は `z.string().regex(CONVERSATION_ID)` にする）が合わない → `会話の形式または上限を確認してください。`
  3. `attemptGo("CONVERSATION_SAVE_FAILED", () => save(…))`。失敗はそのまま返す。
  4. `"invalid"` → `会話の形式または上限を確認してください。`、`"conflict"`・`"unavailable"` → `console.error("CONVERSATION_SAVE_FAILED", <結果>)` と `genericErrorMessage`、`"saved"` → `{ ok: true }`。

  `handleConversationDelete`：viewer が admin・member でない → `actionUnauthorized` → `z.uuid()`（今のまま）が合わない → `{ status: "error", message: 会話の形式または上限を確認してください。 }` → `attemptGoAction("CONVERSATION_DELETE_FAILED", …)` で `remove` → `false` なら `console.error("CONVERSATION_DELETE_FAILED", "not-found")` と `genericErrorMessage` → `true` なら `actionSuccess`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/conversation-notes.test.ts`（`tests/question-notes.test.ts` の利用者・store の作り方を写す）：
    - `conversations follow the signed-in owner and chats bill the actor`：
      - 会員 → 一覧・1 件・保存・削除の持ち主は会員、話した利用量の `ownerId` も会員。
      - 会員として操作している admin → 会話は会員、利用量は admin（`actorId`）。`feature` は `"chat"`、`model` は `chatModel`。
      - デモ → 一覧・1 件・保存・削除はできる。`chatter` は `"demo"`（`answer` は呼ばれない）。
      - 未ログイン → `chatter` は `"signed-out"`、ほかは `ConversationForbiddenError`。ゲスト・`githubId` なし → `"forbidden"`・`ConversationForbiddenError`。store は呼ばれない。
    - `without OpenAI the conversations stay readable and removable`：`chatModel: undefined` → 一覧の `chatModel` は `""`、`chatter` は `"unavailable"`、正しい会話の保存は `"unavailable"`（store なし）、削除は store を呼ぶ。
    - `ids of the wrong shape never reach the store`：`get` は `null`、`remove` は `false`。
    - `another owner's conversation id is a conflict`：不正 → `"invalid"`（store なし）。store が `false` → `"conflict"`、`true` → `"saved"`。store に渡るのは `checkConversation` の結果（削った題・`Date` の `createdAt`）と `deps.now()` の値。
    - `the turns go to OpenAI untrimmed with the caller's signal`。
    - `chat usage is recorded before the answer ends, even when it fails`：`answer` が利用量を報告してから投げる → 投げ直す前に `recordUsage` が 1 回、ログは `CHAT_FAILED` と OpenAI のコード。`recordUsage` が投げても答えは変わらず、`AI_USAGE_NOT_RECORDED`, `"chat"` のログ。止めた `signal` の失敗は `CHAT_FAILED` を記録しない。
  - `tests/chat-controller.test.ts`（`tests/quick-question-controller.test.ts` の `request()` を写す）：「Global Constraints」の 1〜8 の各行の状態と本文、順番（同じ origin でないゲストは `{"error":"この画面から送信してください。"}`、デモの不正な本文は「デモでは使えません。」）。通った本文では `ask` に削らない 3 つの発言と `request.signal` が渡る。`a chat answer cut at the token limit still ends with done`：`ask` が 1 つの断片を出して普通に終わる（`requireComplete: false` の `streamAnswer` が incomplete で返る形）→ `200`、`delta` と `done` の 2 行。テキストの前に投げる → `502` の `chat_failed`。
  - `tests/conversation-controller.test.ts`：保存は、権限なし（`null`・guest）→ `accountForbiddenMessage`（`save` なし）。大文字の UUID・`createdAt: "yesterday"`・`ended` が文字列 → 形の文言。`"invalid"`・`"conflict"`・`"unavailable"`・`"saved"` の 4 つ。`save` が `ConversationForbiddenError` → `accountForbiddenMessage`、ふつうの `Error` → `genericErrorMessage`（ログはコードとエラーの名前だけ）。削除は、権限なし → `actionUnauthorized`、`id` が UUID でない → 形の文言、`false` → `genericErrorMessage`、`true` → `actionSuccess`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/conversation-notes.test.ts tests/chat-controller.test.ts tests/conversation-controller.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `chat-user.ts` に `question-notes.ts` の `person`・`failureCode`・`errorName`・`askerFor` の中身を移し、`question-notes.ts` は `AskRefusal` を `export type { AskRefusal } from "./chat-user"` で出し続ける。`tests/question-notes.test.ts` を変えずに通す。
  - `quick-question-controller.ts`：`return handleAnswerRequest(request, { asker: deps.asker, read: quickQuestionText })`。`tests/quick-question-controller.test.ts` を変えずに通す。
  - `chat-container.ts`（`question-container.ts` と同じく、`openAiConfig()` はモジュールを読むときに 1 回だけ）：

    ```ts
    const openAi = openAiConfig();
    export const conversationNotes = createConversationNotes({
      currentUser: getCachedCurrentUser,
      store: createConversationStore(prisma),
      chatModel: openAi?.chatModel,
      answer: openAi
        ? (turns, signal, onUsage) =>
            streamAnswer(
              openAi,
              {
                model: openAi.chatModel,
                instructions: CHAT_INSTRUCTIONS,
                messages: turns,
                requireComplete: false,
              },
              { signal, onUsage },
            )
        : undefined,
      recordUsage: (entry) => recordAiUsage(prisma, entry),
      logError: (code, ...details) => console.error(code, ...details),
      now: () => new Date(),
    });
    ```

  - `route.ts`：`export const dynamic = "force-dynamic"; export const maxDuration = 90; export async function POST(request: Request) { return handleChat(request, { chatter: () => conversationNotes.chatter() }); }`
  - `conversation-actions.ts`：`saveConversationAction` と `deleteConversationAction` の名前と引数の型は変えない。保存は `handleConversationSave(input, { getViewer: getCurrentViewerUser, save: (c) => conversationNotes.save(c) })` を返すだけ（revalidate しない。今のまま）。削除は `handleConversationDelete(formData, { …, remove: (id) => conversationNotes.remove(id) })` のあと、`status === "success"` なら今と同じく `revalidatePath` と `redirect`。
  - `chat-guard.ts`：`loadConversationList(): Promise<ConversationSummary[]>` を `(await conversationNotes.list()).conversations` にし、`ChatUnavailableError` の import と catch を消す。
  - ページ（判断 11）：
    - `/chat`：手元の `UUID` を `CONVERSATION_ID` に替え、`loadChat` の try/catch を消す（`chatModel` は `""` か値）。EmptyState の説明を「Web に OPENAI_API_KEY を設定すると、ここで会話できます。」に。
    - `/conversations`：`conversations` が `null` の分岐と EmptyState を消し、「ChatGPT と話す」は `!user.demo` だけで出す。
    - 日付のページ：`if (!conversations) notFound();` を消す。1 件のページ：`conversations ?` の分岐を消す。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS。
  - `grep -rn "chat-relay\|conversation-gateway\|ChatUnavailableError\|/v1/chat\|/v1/conversations" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): チャットと会話ノートを Go に頼まずに行う`

### Task 4: Go のチャットのコードを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §8 の「Becomes dead」と §7 の「keep」に従う）：
  - 消す：`chat/`（パッケージ全体）、`httpapi/chat_handlers.go`、`httpapi/chat_handlers_test.go`、`store/conversations.go`、`store/conversations_test.go`。
  - `store/demo.go`：`ConversationMessage`（json の `id`・`role`・`text`）・`ConversationSummary`・`Conversation` を移す。コメントは「デモの見本の会話。会話は段階 7 から Web が読み書きする」。
  - `store/testhelpers_test.go`：`newUUID` を移す。`store/demo_test.go:124-130`：`countRows(t, s, `SELECT count(*) FROM "ChatConversation" WHERE "ownerId" = $1`, owner) == 1` と `SELECT jsonb_array_length("messages") FROM "ChatConversation" WHERE "ownerId" = $1` が `2` にする。
  - `router.go`：`Deps.Chat`・`Conversations`・`ChatModel` とそのコメント（:95-102）、`r.conversationRoutes()`（:164）と `conversationRoutes`（:332-351）、`trackAI`（:228-231）を消す。
  - `ai_usage_handlers.go`：`recordTimeout`・`trackAIUsage`（:24-54）を消し、`AIUsage` を `AIUsageMonth` だけにする（コメントも）。
  - `respond.go`：`msgChatInvalid`・`msgChatFailed`・`msgConversationNotFound`（:51-53）、`codeChatFailed`（:75）、`uuidPattern`・`validUUID`（:167-172）を消す。
  - `main.go`：`chat` の import、`Conversations: db` とコメント（:171-173）、`ChatEnabled` の塊（:189-198）を消す。
  - `config.go`：`defaultChatModel`（:18-20）、`OpenAIChatModel`（:53, :170-172）、`ChatEnabled`（:76-78）を消す。コメント :49 を「OpenAIAPIKey is set with the two LINE values; alone it does nothing」に、:165 を「OPENAI_API_KEY alone is allowed (only LINE uses it)」にする。
  - `openai/openai.go`：`Request.Accept` とその使用（:48, :54, :76-78）を消す。`aiusage/aiusage.go`：`FeatureChat` を消し、コメントを `"quick_question", "vocabulary_draft" and "chat" rows are written by the web now.` にする。
- テストの書き直し（判断 14）：
  - `httpapi/testutil_test.go`：`jsonAuth` を移す。
  - `httpapi/act_as_test.go:33-55`：`TestActAsWritesGoToTheMember` を `PUT /v1/follows/password:x`（`Follows: &fakeFollows{memberExists: …true, follow: …followerID を覚える}`）で書き直す。`follower == actedMember` と「acting as member」のログを確かめる。`:98` の deps から `Chat`・`Conversations` を消し、`Follows: &fakeFollows{}` を足す。
  - `httpapi/demo_test.go`：`allRoutesDeps`（:45）から 2 つの欄を消す。閉じたルートの表（:56-67）から `"POST /v1/chat"` を消す。`:68` の `testConversationID` を `"abc"` にする。`TestDemoKeepsItsOwnRecords`（:98-124）を `GET /v1/study-log?from=2026-11-01&to=2026-11-30`（`StudyLog: sl`）と `sl.owner == testOwner` で書き直す。
  - `httpapi/router_test.go`：`:26,61,134` の 2 つの欄を消す。`TestSavedNotesReadableWithoutOpenAI`（:159-189）を消す。
  - `httpapi/ai_usage_handlers_test.go`：`fakeAIUsage` の記録の部分（`rows`・`at`・`recordErr`・`RecordAIUsage`）と `:94-131` の 3 本を消す。
  - `config_test.go`：`TestLoadConfigOpenAIAloneEnablesChatNotLine`（:331-349）を `TestLoadConfigOpenAIAloneIsNotLine`（`LineEnabled()` が false）にし、`TestLoadConfigChatModelDefaultAndOverride`（:369-382）を消す。
- Modify（docs-site。段階 1〜6 と同じ扱い）：
  - `docs-site/reference/chat.md` を消し、`docs-site/.vuepress/config.ts:33` のナビから外す。
  - `docs-site/reference/README.md:7` から `POST /v1/chat` の `404` と「会話ノートの `PUT` が `405`」「会話ノートの削除」を外し、`:30-34` の 5 行を消す。
  - `docs-site/reference/admin.md:139` を「会話練習（Web の `POST /api/chat`。Web が記録）」にする。
  - `docs-site/README.md:26` の「Web が Prisma で直接扱い」の列に「会話ノート」を、「Web が OpenAI を直接呼ぶ」に「ChatGPT と話す」を足し、「会話練習などを扱えます」から会話練習を外す。`:51` の例のパスを `PUT /v1/follows/{ownerId}` にする。
  - `docs-site/operations/deploy.md`：`:54` の `OPENAI_CHAT_MODEL` の行を消し、「8. 会話練習（ChatGPT）」（:205-220）の中身を「Web に移りました。設定は Web の `OPENAI_API_KEY`・`OPENAI_CHAT_MODEL`（`docs/api-deployment.md` の 8.）」の 1 行にする（見出しの番号は変えない）。
- Modify：`e2e/chat.spec.ts`、`e2e/act-as.spec.ts`、`e2e/demo.spec.ts`、`e2e/server.ts`（:128-132 のコメントから「and the chat routes when OpenAI is」を外すだけ）

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go vet ./... && go build ./... && go test ./...` → 成功（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
  - `grep -rn "/v1/chat\|/v1/conversations\|ChatStreamer\|fakeChat\|fakeConversations\|FeatureChat\|trackAI\|ChatEnabled\|OpenAIChatModel\|validUUID\|msgChat\|PutConversation\|ListConversations\|GetConversation\|DeleteConversation\|services/api/chat" services/api` → 何も出ない（`store/demo.go` の表の名前 `"ChatConversation"` と SQL、`demo/` の型の使用は残る）。
- [ ] **Step 2: 足りない e2e を足す（判断 16）。**
  - `e2e/chat.spec.ts`：`an answer OpenAI cuts at its limit is kept, a refused one is not`
    - admin で `/chat` から `[incomplete] 你好` を送る → 答えは `["你好！"]`、URL に `id` が付く。
    - DB：`ChatConversation` は 1 行で `jsonb_array_length("messages") = 2`、最後の発言は `assistant` の `你好！`。`AiUsage` の `feature 'chat'` は 1 行で、`ownerId` は `10001`、`model` は `gpt-6.1-sol`、`21`・`43`。
    - 続けて `[fail] 再见` を送る → 「ChatGPTから応答を受信できませんでした。」が出る。入力欄は `[fail] 再见` のまま。`messages` は 2 のまま、`AiUsage` も 1 行のまま。
  - `e2e/chat.spec.ts`：`another owner's conversation cannot be read or overwritten`
    - admin で 1 回話し、保存の POST を捕まえる（`page.on("request")` で `method() === "POST"`・`pathname === "/chat"`・`headers()["next-action"]` があるもの。`e2e/quick-question.spec.ts:246` と同じ）。行の `title`・`updatedAt` を覚える。
    - 別の context で会員としてログインし、`/chat?id=<その id>` → `404`、`/conversations` に「まだ会話ノートがありません」。
    - その context の `page.request.post(captured.url(), { headers: next-action ほか, data: captured.postData() の題を "書き換え" に置き換えたもの })` → 本文に `処理できませんでした。時間をおいてもう一度お試しください。`。行は 1 つで、`ownerId` は `10001`、`title`・`updatedAt` は変わらない。
  - `e2e/chat.spec.ts:185`（`stopping an answer does not send the message again`）：送る文を `` `[hang] ${randomUUID()}` `` にし、停止のあと、偽物の `GET /e2e/streams` が `"closed"` になるまで `expect.poll` で待つ（`e2e/quick-question.spec.ts:308` と同じ）。名前は `stopping an answer stops OpenAI and does not send the message again` にする。
  - `e2e/act-as.spec.ts:13`：`:32` のコメント「the chat is admin-only」を「The chat is the member's; the admin pays for it.」にし、最後に、`AiUsage` の `feature = 'chat'` の行が 1 つで `ownerId` は `adminOwnerId`、会員の `ownerId` の行は 0 を足す。
  - `e2e/demo.spec.ts:86-97`：`/api/quick-question` と同じ形で `/api/chat`（`{messages:[{role:"user",text:"你好"}]}`）にも送り、`403` と `body.error.message === "デモでは使えません。"` を確かめる。
  - 既存の `e2e/chat.spec.ts` の 5 本・`demo.spec.ts:28`（デモの見本の会話が読める）・`bottom-navigation.spec.ts`・`quick-question.spec.ts`（まとめた controller）は、ほかを変えずに通ること。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。`chat`・`demo`・`act-as`・`quick-question`・`bottom-navigation`・`security` を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go のチャットと会話ノートのルートを消す`

### Task 5: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`README.md`、`.env.example`

- [ ] **Step 1: 直す。**
  - `docs/features.md`：
    - `:7`：利用量は、単語帳の下書き・クイック質問・ChatGPT と話すは Web、LINE は Go が記録する。
    - `:14`：デモを断るのは、AI は Web、LINE 連携・フォローと共有・パスワード変更は Go。
    - `:92`：Web の `POST /api/chat`（OpenAI を直接呼ぶ）と、会話ノートを Prisma で読み書きすることを書き、Go を外す。`:97`：設定は Web の `OPENAI_API_KEY`（と任意の `OPENAI_CHAT_MODEL`）。
  - `docs/architecture.md`：
    - `:15` の Route Handlers の「チャットの中継」を「チャット・クイック質問の答え」にする。
    - 「8. AI と費用」：OpenAI を呼ぶ 4 か所のうち、LINE の添削・翻訳だけが Go、ほかは Web（`src/infrastructure/openai/`）。表の ChatGPT と話すの「返し方」を「ストリーミング（Web の Route Handler から NDJSON で直接）」にする。テキストの前の失敗は 502、後は `error` 行で、ChatGPT と話すはトークンの上限で切れた答えもそのまま保存し、クイック質問は保存しない、と書く。
    - `:209`：「チャットの本文の上限」を Go と 2 か所で持つ、の例から外す（Web だけになった）。
  - `docs/api-deployment.md`：
    - 「3. 環境変数」の Go の表 `:50` の `OPENAI_CHAT_MODEL` を消し、`:72` の「`OPENAI_API_KEY` だけを設定すると、「ChatGPT と話す」だけが有効になります」を「`OPENAI_API_KEY` は LINE のためだけに使います」にする。
    - Web の表 `:162` の `OPENAI_CHAT_MODEL` を「クイック質問と ChatGPT と話すのモデル」にする。`:168` の「Go API にも、LINE と ChatGPT と話すために」を「LINE のために」にする。
    - 「8. ChatGPT と話す（会話ノート）」（:386-399）を Web の設定に書き直す：Web に `OPENAI_API_KEY` があれば話せる（無ければ「ChatGPT が設定されていません」、会話ノートは読める・消せる）、モデルは Web の `OPENAI_CHAT_MODEL`、使えるのは会員と管理者（デモは読むだけ）。マイグレーションの手順は歴史として 1 行残す。
    - `:426` のデモの使えないものの「Go の `POST /v1/chat`」を Web の `POST /api/chat` にし、Web の AI のルートに「ChatGPT と話す」を足す。
    - 「段階6（質問）のマージの前と後」のあとに、「段階7（チャット）のマージの前と後」を足す（段階 6 と同じ形）。
      - はじめの段落：何を移したか（Web の Route Handler が OpenAI を直接呼び、`chat` として操作している人の `AiUsage` に記録し、会話ノートを Prisma で読み書きする。止めると OpenAI への要求も中断する）。Go の `/v1/chat` と `/v1/conversations*` はなくなり、Go に残るのは LINE、フォローとタイムライン、学習ログ、管理、ログイン、Cron。
      - マージの前：
        - マイグレーションも、新しい環境変数もない（`ChatConversation` はある。Web の `OPENAI_API_KEY` は段階 1 から、`OPENAI_CHAT_MODEL` はどちらにも入っていない）。
        - `/api/chat` も `maxDuration = 90`。段階 6 で 90 秒が通っているので、そのままでよい。
      - マージのあと：
        1. Web の Production のデプロイが Ready になったことを確かめる。
        2. `vercel promote` で切り替える。
        3. main から Go を再デプロイする（実行の前に、使う人に確かめる）。これで `/v1/chat` と `/v1/conversations*` が本番の Go から消える。
        4. Go の `OPENAI_API_KEY` は LINE が使うので残す。
      - 切り替えのあいだ：古い Go と新しい Web が同じ `ChatConversation` に書いても問題ない。行の形と「ほかの人の id は書き換えない」決まりが同じだから。開いたままの画面も同じ `/api/chat` を呼ぶ。利用量も同じ `feature`（`chat`）で同じ表に入る。
      - 戻すとき：
        - Go だけを戻しても害はない。
        - Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/chat` と `/v1/conversations*` を呼んで `404` になる。
          - 話すと「見つかりません。」になる。
          - `/chat` は「ChatGPT が設定されていません」、`/conversations` は設定されていない表示、日付のページは `404` になり、削除は一般的な文言になる。
        - Web を戻すなら Go も戻す。いっしょに戻すのがいちばん安全。
  - `README.md:33`：Go の受け持ちから「ChatGPT と話す（チャット）」を外し、括弧を「（クイック質問・質問ノート・ChatGPT と話す・会話ノートは Web に移りました）」にする。
  - `.env.example`：`:56` の Go の `OPENAI_API_KEY` の説明を「LINE 用」にし、`:57` の `OPENAI_CHAT_MODEL` を Web の `OPENAI_LEARNING_MODEL` の行（`:29`・`:32`）の下に移して「クイック質問と ChatGPT と話すのモデル（任意。無ければ gpt-6.1-sol）」にする。
  - 秘密の値は書かない。
- [ ] **Step 2: 確かめる。** 変えたファイルで `node_modules/.bin/prettier --check` が通る。`grep -rn "/v1/chat\|/v1/conversations" docs README.md docs-site .env.example --include='*.md' --include='*.ts' --include='.env.example'`（`docs/releases/` と `docs/superpowers/` を除く）で、残っているのが歴史の記録（段階 6 までの節）だけであることを確かめる。
- [ ] **Step 3: コミット。** `docs: チャットと会話ノートを Web に移したことを書く`
