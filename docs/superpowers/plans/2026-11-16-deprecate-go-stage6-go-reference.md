# 段階 6 の参照：Go の質問ノートとクイック質問の今の動き（2026-11-16 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage6-questions.md. Stages 1–5 are merged into this branch (the web already calls OpenAI itself for vocabulary drafts and records `AiUsage`).

## 0. Routes, roles, act-as, demo

Registered in `questionRoutes` router.go:357-371 (called from `newMux` :168). `Deps.Questions` = `db` always (main.go:172-173); `Deps.QuickChat` and `Deps.ChatModel` only when `OPENAI_API_KEY` is set (`cfg.ChatEnabled()` main.go:190-203, config.go:76-78).

| Route                     | Registered                     | Wrapper                                        | Handler (question_handlers.go)                            |
| ------------------------- | ------------------------------ | ---------------------------------------------- | --------------------------------------------------------- |
| `GET /v1/questions`       | always (Questions non-nil)     | `private`                                      | `listQuestions` :40-56                                    |
| `GET /v1/questions/{id}`  | always                         | `private`                                      | `getQuestion` :57-70                                      |
| `POST /v1/quick-question` | only with OpenAI (`QuickChat`) | `notForDemo` + `trackAI(FeatureQuickQuestion)` | `streamMessages(QuickChat, true)` chat_handlers.go:68-132 |
| `PUT /v1/questions/{id}`  | only with OpenAI               | `private`                                      | `putQuestion` :71-99                                      |

- `private` (router.go:212-216) = `requireAuth` + `rejectUserParam`: no/invalid token **401** `unauthorized` 「認証が必要です。」 (middleware.go:145-148, respond.go:19); a revoked/disallowed principal 403 「このアカウントは利用できません。」 (`writeServiceError`); **guest 403** `forbidden` 「このアカウントは利用できません。」 (middleware.go:155-158, respond.go:20); `?user=` → 400 「リクエストが不正です。」.
- `notForDemo` (router.go:220-229, demo.go:59-72): after `requireAuth`, `auth.Service.IsDemo` (auth/demo.go:53-56: only a member, **never while an admin acts**) → **403 `forbidden` 「デモでは使えません。」** (respond.go:39). Only `POST /v1/quick-question` is closed; the demo **can list, read and PUT** its notes (`TestDemoKeepsItsOwnRecords` demo_test.go:99-113 reads them; closed list demo_test.go:56-69).
- **Act-as honoured** on all four (no `notActing`): notes are the **member's** (`Principal.OwnerID`); the AI usage is the **admin's** (`ActorID`, §5). `TestActAsWritesGoToTheMember` act_as_test.go:33-55 uses `PUT /v1/questions/{id}` (stage 5 moved it here).
- Without OpenAI: `POST /v1/quick-question` → mux **404** `not_found` 「見つかりません。」 (respond.go:27,159); `PUT /v1/questions/{id}` → **405** `method_not_allowed` (the GET exists); the lists answer `chatModel: ""` (`TestSavedNotesReadableWithoutOpenAI` router_test.go:159-198).
- Error envelope everywhere: `{"error":{"code","message"}}` (respond.go:78-86), `Cache-Control: no-store`.

## 1. Asking: `POST /v1/quick-question` (chat_handlers.go:68-132)

Order:

1. `requireAuth` → `rejectUserParam` → `notDemo` → `trackAIUsage` (puts a usage recorder in the context, §5).
2. Body capped at `chatBodyLimit = 256 << 10` (:36) by `MaxBytesReader`; over → **413** `too_large` 「リクエストが大きすぎます。」 (respond.go:29,145).
3. `decodeBody` (respond.go:196-215): one JSON object, nothing after, **unknown fields rejected at every level** (also inside a message), keys case-insensitive. Any decode error → **400** `invalid_request` 「会話内容が上限を超えているか、形式が不正です。」 (`msgChatInvalid` respond.go:51). Body: `{"messages":[{"role","text"}]}`.
4. Same 400 when `chat.Validate` fails or, for quick, `len(messages) != 1` or `utf8.RuneCountInString(messages[0].Text) > 4000` (:84). `chat.Validate` (chat/chat.go:51-69): 1–40 messages, **last role `user`**, every role `user|assistant`, `strings.TrimSpace(text) != ""`, total ≤ 40 000 runes. So quick = exactly one `user` message, not blank, **≤ 4000 code points counted untrimmed**; the text is sent to OpenAI **as is** (not trimmed).
5. `extendChatDeadlines` (:56-60): write deadline now + `chatWriteTimeout = 90s` (:39; the server's own `WriteTimeout` is 30 s, main.go).
6. `c.Stream(r.Context(), msgs, emit)`; each piece → line `{"type":"delta","text":…}`.
   - Headers are written **with the first line**: `Content-Type: application/x-ndjson; charset=utf-8`, `X-Accel-Buffering: no`, 200 (:97-103). Every line is `json.Marshal(chatLine)` + `\n` (`chatLine` :50-54, `text`/`message` `omitempty`), then `Flush`.
   - Success → line `{"type":"done"}` (:116-118). An answer with **no** delta still gets 200 + only `done` (the browser then treats it as cut, §6).
   - Failure, logged as `Warn("chat failed", "code", code)` for `*chat.Error`, else `Info("chat stream stopped")` (client went away) (:120-125) — never the text.
     - **nothing written yet → 502** `chat_failed` 「ChatGPTから応答を受信できませんでした。」 (`msgChatFailed` respond.go:52, `codeChatFailed` :75);
     - **after a delta → line `{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}`**, status stays 200.
   - Client disconnect cancels `r.Context()` → the OpenAI request is cancelled.

## 2. The OpenAI call (chat/openai.go, openai/openai.go)

`deps.QuickChat = &chat.Streamer{HTTP: newNoRedirectHTTPClient(65 * time.Second), BaseURL: cfg.OpenAIBaseURL, APIKey: cfg.OpenAIAPIKey, Model: cfg.OpenAIChatModel, Instructions: chat.QuickQuestionPrompt, RequireComplete: true}` (main.go:198-201).

- Model: `OPENAI_CHAT_MODEL`, default **`gpt-6.1-sol`** (config.go:18-20,170-172) — the same model as the chat; `ChatModel` in the lists is this value.
- Base URL `OPENAI_API_BASE_URL` (default `https://api.openai.com`, loopback-only override, config.go:189); the web's `openAiConfig()` (`src/infrastructure/config/environment.ts:109-133`) applies the same rule but has **no chat model yet** (only `learningModel`, default `gpt-5-mini`).
- Request (`Stream` chat/openai.go:46-72 → `openai.Request.Post` openai/openai.go:63-98): `POST {base without trailing /}/v1/responses`, headers `Content-Type: application/json`, **`Accept: text/event-stream`**, `Authorization: Bearer <key>`; redirects never followed. Body (a Go map, keys marshalled sorted):

  ```json
  {
    "input": [{ "role": "user", "content": "<text>" }],
    "instructions": "<QuickQuestionPrompt>",
    "max_output_tokens": 1600,
    "model": "gpt-6.1-sol",
    "reasoning": { "effort": "medium" },
    "store": false,
    "stream": true
  }
  ```

  `maxOutputTokens = 1600` (chat/chat.go:20). No `text.format`, no tools, **no retries** (one attempt; `Retryable` is set but nobody retries).

- `QuickQuestionPrompt` (chat/chat.go:35-40), exactly:

  ```text
  あなたは中国語学習アプリ「学习録」の質問アシスタントです。
  中国語学習についての1回だけの質問に、まず要点から簡潔に答えてください。
  - ユーザーが使った言語に合わせて答える。
  - 必要に応じて中国語の例文、ピンイン、自然な日本語訳、短い理由を添える。
  - 会話の続きや追加の練習を促す質問で締めくくらない。
  - 不明点があれば前提を示し、確信がない内容は断定しない。
  ```

- Timeout: `requestTimeout = 60s` for the **whole answer** (chat/openai.go:18, :47-52; context deadline). The HTTP client's own 65 s sits above it.
- Status mapping (openai.go:86-97): 200 → stream; 401/403 → `OPENAI_AUTH_FAILED`; 429 → `OPENAI_RATE_LIMITED`; other (incl. 3xx) → `OPENAI_REQUEST_FAILED`. Transport failure → `OPENAI_TIMEOUT` if any deadline, else `OPENAI_REQUEST_FAILED` (:103-110). The error string is only the code (no key/body).
- Reading (chat/openai.go:78-125): `bufio.Scanner` lines (strips `\r\n`), max line **1 MiB** (`maxEventBytes` :20; longer → `OPENAI_INVALID_RESPONSE`). Only lines starting `data:` count (event names, comments, blanks skipped); payload = `TrimSpace(after "data:")`, JSON-decoded (bad JSON → `OPENAI_INVALID_RESPONSE`):
  - `response.output_text.delta` → `emit(delta)` unless `delta == ""`; an emit error is returned as is;
  - `response.completed` → report usage, **success**;
  - `response.incomplete` → report usage; with `RequireComplete` (quick) → **`OPENAI_INCOMPLETE_RESPONSE`** (the chat treats it as done);
  - `response.failed` or `error` → report usage (when the event has `response`), `OPENAI_INVALID_RESPONSE`;
  - other types ignored.
  - Scanner ends without a final event → `OPENAI_TIMEOUT`/`OPENAI_REQUEST_FAILED` if the context ended or the read failed, else `OPENAI_INVALID_RESPONSE`.
- Usage: `response.usage.{input_tokens,output_tokens}` of the final event (chat/openai.go:130-141 → openai.go:112-125); no `response` or no `usage` → nothing; negatives → 0 (aiusage.go:42-50). Model reported = the **configured** model, not the response's.

## 3. Saving: `PUT /v1/questions/{id}` (question_handlers.go:71-99)

The browser sends it after a complete answer (§6). Order:

1. `{id}` must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`validUUID` respond.go:167-172) else **404** 「質問ノートが見つかりません。」.
2. `decodeBody` into `{question, answer}` (unknown fields, bad JSON → 400 「リクエストが不正です。」 via `writeBodyError` respond.go:215-222; > 1 MiB → 413).
3. `question, answer := strings.TrimSpace(...)`; **400 `invalid_request` 「質問または回答の形式・上限を確認してください。」** when either is empty, `question` > **4000** runes or `answer` > **`chat.MaxAnswerChars` = 20 000** runes (chat/chat.go:16-18). The trimmed values are stored.
4. `PutQuestion(owner, {ID, Question, ModelName: ChatModel (server's), Answer}, now())`; `ErrNotFound` → **404 「質問ノートが見つからないか、すでに保存されています。」**; other → 500.
5. 200 = note JSON.

## 4. Reading and storage

- `GET /v1/questions` (:40-56): `ListQuestions(owner, 100)` → 200 `{"chatModel": ChatModel, "questions":[{"id","question","modelName","createdAt"}]}` (no `answer`; `[]` when none). Times `YYYY-MM-DDTHH:MM:SS.sssZ` (`formatTime`).
- `GET /v1/questions/{id}` (:57-70): same UUID check → 404 「質問ノートが見つかりません。」; none / another owner's → 404 same text; 200 summary + `"answer"`.
- Table `QuickQuestion` (prisma/schema.prisma:211-220, migration `20261029000000_quick_questions`): `id` TEXT **PK** (browser UUID), `ownerId`, `question`, `answer`, `modelName`, `createdAt` (default now). `@@index([ownerId, createdAt])`. **No `@@unique([id, ownerId])`**, no FK, no `updatedAt`.
- store/questions.go:
  - list :28-45 `WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2`;
  - get :47-49 `WHERE "id" = $1 AND "ownerId" = $2`, none → `ErrNotFound`;
  - put :51-60, one statement: `INSERT … VALUES (id, owner, question, answer, modelName, dbTime(now)) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id" WHERE "QuickQuestion"."ownerId" = EXCLUDED."ownerId" AND "QuickQuestion"."question" = EXCLUDED."question" AND "QuickQuestion"."answer" = EXCLUDED."answer" RETURNING …`.
    - New id → inserted.
    - **Identical retry** (same owner, question, answer) → returns the **original** row (original `modelName`, `createdAt`).
    - Same id with other content, or another owner's id → no row → `ErrNotFound` → 404; nothing changed.
- `TestQuestionsAreSeparatePrivateImmutableAndRetryable` store/questions_test.go:10 (own list only, retry returns original, changed answer refused, other owner refused and cannot read).

## 5. AI usage

`trackAIUsage` (ai_usage_handlers.go:31-54): owner = `p.ActorID` if acting, else `p.OwnerID`; feature **`"quick_question"`** (`aiusage.FeatureQuickQuestion` aiusage.go:16, "never rename"); model = configured chat model; tokens from §2; `createdAt = now()`. Recorded **synchronously inside the stream** (before the `done`/`error` line is written), with `context.WithoutCancel` and a **5 s** timeout (`recordTimeout` :26); a failure is only logged `Warn("ai usage not recorded", feature, error)` and never changes the answer (`TestUsageFailureDoesNotBreakTheAnswer` ai_usage_handlers_test.go:130). Row via store/ai_usage.go into `AiUsage` (schema.prisma:317-328) — the web's `recordAiUsage` (`src/infrastructure/prisma/ai-usage-store.ts`) writes the same row. The admin summary label 「クイック質問」 is the web's (`src/domain/ai-usage/monthly-usage.ts:33`).

## 6. The web today

- Route `src/app/api/quick-question/route.ts` = `chatRelayRoute("/v1/quick-question")` (`src/composition/chat-relay.ts`): `handleChatRelay` (`src/presentation/controllers/chat-relay-controller.ts:53-94`), in order:
  1. not same-origin → **403 `{"error":"この画面から送信してください。"}`**;
  2. content type not `application/json` → **415 「JSON形式で送信してください。」**;
  3. no `zl_access` token → **401 「認証が必要です。」**;
  4. body > 256 KiB (`content-length` or while reading) → **413 「会話が大きすぎます。」**; unreadable → 400 「リクエストを読み取れませんでした。」;
  5. `fetch(GO_API_URL + path, {redirect: "error", signal: request.signal})`, failure → **502 「ChatGPTから応答を受信できませんでした。」**;
  6. Go's status, `content-type` and body passed through, plus `Cache-Control: no-store`.

  The relay's own errors are `{"error": string}`; Go's are `{"error":{code,message}}`.

- Client: `use-quick-question.ts:58-93` trims the input, refuses > 4000 code points locally (「質問は4,000文字以内で入力してください。」), sends `{messages:[{role:"user",text}]}` via `streamChat` (`chat-stream.ts:83-130`, reads NDJSON :6-45; non-2xx → `readFailureText` :49-64 shows either error shape's message; `done` with non-blank text → ok; `error` line → its message; ended without `done` → cut).
  - Texts: failure and cut 「回答を受信できませんでした。質問を確認して、もう一度送信してください。」; stop 「回答を停止しました。途中の回答は保存されません。もう一度送信できます。」 (:16-19).
  - On ok: `crypto.randomUUID()` + `saveQuestionAction({id, question, answer})`; 「質問ノートに保存しました。」 or retry 「質問ノートに保存できませんでした。…保存を再試行してください。」 (the retry resends the **same** id and answer, no new generation).
- Save action `src/presentation/actions/question-actions.ts:19-48`:
  1. `getCurrentViewerUser()` not admin/member → `accountForbiddenMessage`;
  2. zod (`id: z.uuid()`; `question`/`answer` trimmed, ≥ 1, ≤ 4000 / 20 000 code points) fails → 「質問ノートの形式が不正です。」;
  3. `attemptGoResult("QUESTION_SAVE_FAILED", () => questionNotes.save(...))` — Go 400 `invalid_request` message passes through; Go 404 (conflict) and 405 → generic 「処理できませんでした。時間をおいてもう一度お試しください。」 + log; no revalidate (the hook calls `router.refresh()`).
- Gateway `src/infrastructure/go-api/question-gateway.ts` (`list` → `{chatModel, questions}`, 404 → `ChatUnavailableError`; `get` 404 → null; `save` PUT); container `src/composition/question-container.ts` exports `questionNotes`. `ChatUnavailableError` (`src/domain/chat/chat-unavailable.ts`) is also used by `/chat` and `chat-guard.ts` (stage 7).
- Pages (all `requireChatUser`: signed out → sign-in, guest → 404; demo allowed):
  - `/quick-question` (`src/app/quick-question/page.tsx`): list → `chatModel` (`""` → EmptyState 「クイック質問を利用できません」) + 8 recent;
  - `/questions` (`src/app/questions/page.tsx`): list (`ChatUnavailableError` → 「質問ノートを利用できません」, unreachable in production since Go always has `Questions`);
  - `/questions/[id]` (`src/app/questions/[id]/page.tsx`): local UUID regex → 404, `get` null → 404, + recent list.
- Domain `src/domain/chat/question.ts`: types, `MAX_QUESTION_CHARS = 4000`, `MAX_ANSWER_CHARS = 20_000`.
- Unit tests: `tests/go-api-question-gateway.test.ts` (dies), `tests/chat-relay-controller.test.ts:138` (quick relay; the rest stays for `/api/chat`), `tests/chat-stream.test.ts`, `tests/ai-usage.test.ts:66` (label).
- E2E (`e2e/quick-question.spec.ts`): `:10` admin asks, note saved (owner `10001`), no `ChatConversation`, 390 px no overflow, note page, second question, body shape; `:68` failed save retried without a second generation; `:109` cut NDJSON (route-fulfilled) not saved; `:133` another member's note 404, member asks and saves, guest 404 on 3 pages. `e2e/demo.spec.ts:86-97` POST `/api/quick-question` as demo → 403, `body.error.message === "デモでは使えません。"`. Menus: `e2e/demo.spec.ts:76-83`, `e2e/bottom-navigation.spec.ts:66`.
- OpenAI stub `e2e/openai-stub.ts`: every non-vocabulary POST is streamed (`response.created`, 3 deltas echoing the last user message, `response.completed` **without usage**). The web already has `OPENAI_API_KEY`/`OPENAI_API_BASE_URL` pointing at it (`e2e/server.ts:49-52`), as does Go (:134-136). No `OPENAI_CHAT_MODEL` is set (default model in both).
- **Gaps:** act-as asking (note → member, usage → admin), usage recorded at all for quick questions, an incomplete / failed OpenAI answer (502 before text, error line after), a save retried with the same id but other content or by another owner not overwriting.

## 7. What remaining Go still needs after stage 6 (keep)

- **Chat (stage 7):** chat/chat.go `SystemPrompt`, `Message`, `Validate`, `MaxMessages`, `MaxTotalChars`, **`MaxAnswerChars`** (also `validConversation` chat_handlers.go:239-269), `maxOutputTokens`; chat/openai.go `Streamer` (without `Instructions`/`RequireComplete`), `Error`, `reportUsage`; chat_handlers.go `ChatStreamer`, `chatLine`, `extendChatDeadlines`, `streamChat` (body of `streamMessages` without the `quick` branch), `chatBodyLimit`, `chatWriteTimeout`; respond.go `msgChatInvalid`, `msgChatFailed`, `codeChatFailed`; `aiusage.FeatureChat`; `Deps.Chat`, `ChatModel`, `Conversations`.
- **LINE (stage 10):** `learning` package + `openai` package (`Request`, codes except `CodeIncompleteResponse`, `ReportBodyUsage`), `aiusage.FeatureLine`.
- **Demo reset (stage 10):** store/demo.go:67 deletes `"QuickQuestion"` rows by table name (no question code); store/demo_test.go:201 counts them.
- `validUUID` (conversations), `formatTime`, `decodeBody`, `writeStoreError`, `pathValueMsg`: still used.
- Go tests now leaning on question code: httpapi/act_as_test.go:33-55 (`TestActAsWritesGoToTheMember`, `fakeQuestions`), :98 (member-refused-everywhere deps), httpapi/demo_test.go:45 (`allRoutesDeps`), :56-69 (closed list names `POST /v1/quick-question`), :99-113 (`TestDemoKeepsItsOwnRecords` on `GET /v1/questions`), httpapi/router_test.go:26,61,134 (deps), :159-198 (`TestSavedNotesReadableWithoutOpenAI`), httpapi/ai_usage_handlers_test.go:107-116 (`TestQuickQuestionRecordsItsFeature`), chat/openai_test.go:220-240 (`TestQuickQuestionPromptAndIncompleteAnswer`). `fakeConversations` (chat_handlers_test.go:41-53) records `putOwner` but not the list owner.

## 8. Becomes dead when the web owns questions

- Go: httpapi/question_handlers.go (whole), httpapi/question_handlers_test.go (whole: `TestQuestionRoutesRejectGuestsAndAnonymous` :40, `TestQuickQuestionAcceptsOnlyOneQuestion` :52, `TestQuestionSaveAndReadUsesAuthenticatedOwnerAndServerModel` :63, `TestQuickQuestionRoutesMissingWithoutConfiguration` :87), store/questions.go, store/questions_test.go, router.go:95-105 (`QuickChat`, `Questions` and their comment), :168, :357-371; main.go:172-174 (`Questions: db` and the comment), :198-201; chat_handlers.go `streamMessages`'s `quick` parameter and the 4000 check (:66-68, :84); chat/chat.go:33-40 `QuickQuestionPrompt`; chat/openai.go `Instructions`, `RequireComplete` (:36-37, :58-61, :104-109 → incomplete is always done); openai/openai.go:30 `CodeIncompleteResponse`; aiusage.go:16 `FeatureQuickQuestion`.
- Web: `src/infrastructure/go-api/question-gateway.ts`, `tests/go-api-question-gateway.test.ts`, the `upstreamPath` option of `chat-relay-controller.ts`/`chat-relay.ts` and its test `:138`, the `ChatUnavailableError` catches in the three question pages.
- Docs: `docs-site/reference/quick-questions.md`, its nav entry `docs-site/.vuepress/config.ts:34`, `docs-site/reference/README.md:7` (the quick-question 404 and question-note 405 remarks), `docs-site/reference/admin.md:140` (`quick_question` row points at `POST /v1/quick-question`), `docs-site/README.md:27` (list of what the web handles), `docs/architecture.md:172-182` (§8 table), `docs/features.md:7,14`, `docs/api-deployment.md:167,399`.
