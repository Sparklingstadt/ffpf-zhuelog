# 段階 7 の参照：Go のチャットと会話ノートの今の動き（2026-11-17 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage7-chat.md. Stages 1–6 are merged into this branch: the web already streams quick questions itself (`streamAnswer`, `answerStreamResponse`, `recordWithin`), so most of the chat's machinery exists. Stage 6's reference (`…-stage6-go-reference.md` §1–§2) describes the NDJSON lines and the OpenAI stream; only the differences are repeated here.

## 0. Routes, roles, act-as, demo

Registered in `conversationRoutes` router.go:332-351 (called from `newMux` :164). `Deps.Conversations` = `db` **always** (main.go:171-173); `Deps.Chat` and `Deps.ChatModel` only when `OPENAI_API_KEY` is set (`cfg.ChatEnabled()` main.go:189-198, config.go:76-78). `Deps` fields and comment router.go:95-102.

| Route                           | Registered       | Wrapper                               | Handler (chat_handlers.go)    |
| ------------------------------- | ---------------- | ------------------------------------- | ----------------------------- |
| `GET /v1/conversations`         | always           | `private`                             | `listConversations` :157-174  |
| `GET /v1/conversations/{id}`    | always           | `private`                             | `getConversation` :176-189    |
| `DELETE /v1/conversations/{id}` | always           | `private`                             | `deleteConversation` :269-282 |
| `POST /v1/chat`                 | only with OpenAI | `notForDemo` + `trackAI(FeatureChat)` | `streamChat` :66-130          |
| `PUT /v1/conversations/{id}`    | only with OpenAI | `private`                             | `putConversation` :193-229    |

- **Not admin-only.** Admins and members (`private`, router.go:208-211). Some docs still say 「管理者だけ」 (`docs/api-deployment.md:388-392`, `docs-site/operations/deploy.md:205-211`, comment in `e2e/act-as.spec.ts:32`) — stale.
- `private`: no/invalid token **401** `unauthorized` 「認証が必要です。」; **guest 403** `forbidden` 「このアカウントは利用できません。」; `?user=` → 400 (as stage 6 §0). `TestChatRoutesRejectGuests` chat_handlers_test.go:110-121.
- `notForDemo` → demo **403 `forbidden` 「デモでは使えません。」** on `POST /v1/chat` only (`IsDemo` never true while an admin acts). The demo **can list, read, PUT and DELETE** its conversations (closed list demo_test.go:56-67; `TestDemoKeepsItsOwnRecords` :98-124 reads `GET /v1/conversations`).
- **Act-as honoured** on all five (no `notActing`): conversations are the **member's** (`Principal.OwnerID`); the AI usage is the **admin's** (`ActorID`, §5). `TestActAsWritesGoToTheMember` act_as_test.go:33-55 uses `PUT /v1/conversations/{id}`.
- Without OpenAI: `POST /v1/chat` → mux **404** `not_found` 「見つかりません。」; `PUT /v1/conversations/{id}` → **405** `method_not_allowed` 「このメソッドは使用できません。」 (the GET exists); list → `chatModel: ""`; GET/DELETE work (`TestSavedNotesReadableWithoutOpenAI` router_test.go:160-189).
- Error envelope `{"error":{"code","message"}}`, `Cache-Control: no-store` (respond.go:78-104).

## 1. Chatting: `POST /v1/chat` (streamChat chat_handlers.go:66-130)

Order:

1. `requireAuth` → `rejectUserParam` → `notDemo` → `trackAIUsage` (§5).
2. `MaxBytesReader(chatBodyLimit = 256 << 10)` (:36, :71). `decodeBody` (respond.go:193-213: one JSON object, nothing after, **unknown fields rejected at every level**, keys matched case-insensitively). Over the limit → `writeBodyError` → **413** `too_large` 「リクエストが大きすぎます。」 (:74-77); any other decode error → **400** `invalid_request` 「会話内容が上限を超えているか、形式が不正です。」 (`msgChatInvalid` respond.go:51).
3. Same 400 when `chat.Validate` fails (chat/chat.go:42-60):
   - 1 to **40** messages (`MaxMessages` :14);
   - the **last** role is `user`; every role `user` or `assistant`;
   - `strings.TrimSpace(text) != ""` for every message;
   - total `utf8.RuneCountInString(text)` over all messages ≤ **40 000** (`MaxTotalChars` :15), counted **untrimmed**.
   - `chat.TestValidate` chat_test.go:9-48: none; one user; 40 ending with user ok; 41 no; last assistant no; `system` no; `" \n\t"` no; 40 000 `字` ok; 39 999 + `好` + `你` (40 001) no.
   - No per-message limit (the quick question's 4000 / exactly-one rules are not here). Messages go to OpenAI **as sent** (untrimmed).
4. `extendChatDeadlines` write deadline now + `chatWriteTimeout = 90s` (:39, :56-60).
5. Streaming, identical to the quick question (stage 6 ref §1.6): headers with the first line (`application/x-ndjson; charset=utf-8`, `X-Accel-Buffering: no`, 200), `{"type":"delta","text"}` per piece, `{"type":"done"}`; failure before any line → **502** `chat_failed` 「ChatGPTから応答を受信できませんでした。」; after → `{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}`. No pieces + success → 200 with only `done`. Logged `Warn("chat failed","code",…)` / `Info("chat stream stopped")`, never the text.
   - Tests chat_handlers_test.go:145-211 (`TestChatStreamsNDJSONAndDone`, `…BeforeWritingIs502`, `…AfterWritingIsErrorLine`, `TestChatRejectsInvalidAndLarge`, `TestChatPassesRequestContext`).

## 2. The OpenAI call (chat/openai.go)

`deps.Chat = &chat.Streamer{HTTP: newNoRedirectHTTPClient(65 * time.Second), BaseURL: cfg.OpenAIBaseURL, APIKey: cfg.OpenAIAPIKey, Model: cfg.OpenAIChatModel}` (main.go:189-198). `Stream` chat/openai.go:44-114.

- Model `OPENAI_CHAT_MODEL`, default **`gpt-6.1-sol`** (config.go:18-20,170-172) — the web's `openAiConfig().chatModel` already reads the same variable and default (stage 6). The production Go project has no `OPENAI_CHAT_MODEL` (stage 6 controller check).
- Request = stage 6 ref §2 exactly, except `instructions` = **`SystemPrompt`** and `input` = **every message** in order, `{"role": m.Role, "content": m.Text}` (:52-55). `max_output_tokens: 1600`, `reasoning: {effort: "medium"}`, `stream: true`, `store: false`, `Accept: text/event-stream`, no redirects, no retries, 60 s for the whole answer (`requestTimeout` :18). `TestStreamSendsModelPromptAndStoreFalse` openai_test.go:59-92 (3 turns, base URL with trailing `/`).
- `SystemPrompt` (chat/chat.go:24-31), exactly (8 lines, no trailing newline):

  ```text
  あなたは中国語学習アプリ「学习録」の会話パートナーです。
  ユーザーの中国語学習を支援してください。
  - 原則として、ユーザーが使った言語に合わせて答える。
  - 中国語の例文には、必要に応じてピンインと自然な日本語訳を添える。
  - 間違いを直すときは、自然な修正文と短い理由を示す。
  - 会話練習では細かい訂正で流れを止めすぎず、会話を続けてから要点を整理する。
  - 確信がない内容を断定しない。
  - 回答は学習しやすい長さにまとめる。
  ```

- **`response.incomplete` is success** (:95-97; `TestStreamIncompleteCountsAsDone` openai_test.go:111-121): the browser gets `done`, and the answer cut at the token limit is saved like any other. This is the only stream difference from the quick question (web: `streamAnswer(…, { requireComplete: false })`).
- Status mapping, SSE reading (1 MiB lines, `data:` only), `response.failed`/`error` → `OPENAI_INVALID_RESPONSE`, ended without a final event, usage of the final event (negatives → 0, model = configured model): as stage 6 ref §2 (`TestStreamFailedEventsAndStatuses` :123, `TestStreamStopsWhenContextCancelled` :171, `TestStreamTimesOut` :201, usage_test.go:12-50).

## 3. Saving: `PUT /v1/conversations/{id}` (putConversation chat_handlers.go:193-229)

The browser sends the **whole** conversation after each complete answer (§6). Order:

1. `{id}` must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`validUUID` respond.go:167-172) else **404** `not_found` 「会話が見つかりません。」 (`msgConversationNotFound` respond.go:53).
2. `decodeBody` into `{title, modelName, ended, createdAt, messages:[{id, role, text}]}` (1 MiB `limitBody` middleware.go:18,129-133). Unknown keys / bad JSON → **400** `invalid_request` 「リクエストが不正です。」 (`writeBodyError` respond.go:215-223); > 1 MiB → 413.
3. `time.Parse(time.RFC3339Nano, createdAt)` fails, or `validConversation` (:237-267) fails → **400** `invalid_request` 「会話内容が上限を超えているか、形式が不正です。」. `validConversation`:
   - `strings.TrimSpace(title)`: 1 to **100** runes (`maxConversationTitle` :43);
   - `modelName` (not trimmed): non-empty, ≤ **150** runes (:44);
   - 1 to **40** messages;
   - every message: `id` non-empty, ≤ **200** runes (:45), **unique** in the conversation; role `user`|`assistant`; `TrimSpace(text) != ""`;
   - total runes ≤ **40 000**, where a **last message with role `assistant`** is left out of the total and must itself be ≤ **20 000** runes (`chat.MaxAnswerChars` chat/chat.go:16-18). A conversation ending with `user` gets no allowance.
   - Table test `TestConversationCRUD` chat_handlers_test.go:223-284 (long title 101 `字`, title `" "`, duplicate ids, `yesterday`, role `system`, no messages, blank text, model 151 `m`, unknown key `updatedAt`); `TestConversationPutAllowsTheLastAnswerOverTheLimit` :285-313 (40 000 `字` + 1500 `答` ok; 40 001 + `答` no; answer 20 001 no; one user message of 40 001 no).
4. Stored: `id`, owner = `Principal.OwnerID`, **trimmed** title, `modelName` **as the browser sent it** (not the server's model, unlike question notes), `ended` as sent, `createdAt` as sent, messages as sent; `now()` for `updatedAt`.
5. Another owner's id → store `ErrNotFound` → **404** 「会話が見つかりません。」; 200 = the saved conversation (the web ignores it).

## 4. Reading, deleting and storage

- `GET /v1/conversations` (:157-174): `ListConversations(owner, conversationListLimit = 100)` (:41) → 200 `{"chatModel": ChatModel, "conversations":[{"id","title","modelName","ended","createdAt","updatedAt"}]}` (no messages; `[]` when none; times `YYYY-MM-DDTHH:MM:SS.sssZ`).
- `GET /v1/conversations/{id}` (:176-189): `validUUID` else 404 「会話が見つかりません。」; none / another owner's → 404 same; 200 summary + `"messages"`.
- `DELETE /v1/conversations/{id}` (:269-282): `validUUID` else 404; no row (none / other owner's) → **404** 「会話が見つかりません。」; **204**.
- Table `ChatConversation` (prisma/schema.prisma:174-187; migrations `20261001100000_chat_conversations`, `20261004090000_chat_conversation_created_at`, `20261024090000_add_chat_conversations`): `id` TEXT **PK**, `ownerId`, `title`, `modelName`, `ended` BOOLEAN, `messages` JSONB `[{id, role, text}]`, `createdAt` (default now), `updatedAt` (`@updatedAt`). **`@@unique([id, ownerId])`** (Prisma `id_ownerId`), `@@index([ownerId, updatedAt])`, `@@index([ownerId, createdAt])`. No FK.
- store/conversations.go:
  - types `ConversationMessage` :15-19 (json `id`,`role`,`text`), `ConversationSummary` :22-29, `Conversation` :32-35;
  - list :45-66 `WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2`;
  - get :70-78 `WHERE "id" = $1 AND "ownerId" = $2`, none → `ErrNotFound`;
  - put :84-106, one statement: `INSERT … ("id","ownerId","title","modelName","ended","messages","createdAt","updatedAt") VALUES (…, $6::jsonb, dbTime(createdAt), dbTime(now)) ON CONFLICT ("id") DO UPDATE SET "title","modelName","ended","messages","updatedAt" = EXCLUDED.… WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId" RETURNING …`.
    - New id → inserted with the browser's `createdAt`.
    - Own id → title, model, ended, messages, `updatedAt` replaced; **`createdAt` kept**.
    - Another owner's id → no row → `ErrNotFound`; nothing changed.
  - delete :110-120 `DELETE … WHERE "id" = $1 AND "ownerId" = $2`, 0 rows → `ErrNotFound`.
  - Tests store/conversations_test.go:49-182 (create then update keeping createdAt; other owner not found and unchanged; newest first, owner only, `[]` not nil; get/delete of other owner, delete twice).

## 5. AI usage

`trackAIUsage` (ai_usage_handlers.go:24-54): owner = `p.ActorID` if acting, else `p.OwnerID`; feature **`"chat"`** (`aiusage.FeatureChat` aiusage.go:16, "never rename"); model = configured chat model; tokens of the final event; recorded **synchronously before the `done`/`error` line**, `context.WithoutCancel` + **5 s** (`recordTimeout` :26); a failure is only logged `Warn("ai usage not recorded", feature, error)`. Tests ai_usage_handlers_test.go:94-131 (`TestChatRecordsUsageForTheCaller`, `TestActingAdminPaysForTheUsage`, `TestUsageFailureDoesNotBreakTheAnswer`). The web's `recordAiUsage` (`src/infrastructure/prisma/ai-usage-store.ts`) writes the same row; `recordWithin` (`src/application/ai-usage/record-within.ts`) is the 5 s bound. Admin label 「ChatGPT と話す」 (`src/domain/ai-usage/monthly-usage.ts:32`).

## 6. The web today

- `src/app/api/chat/route.ts` = `chatRelayRoute()` (`src/composition/chat-relay.ts:7-26` → `handleChatRelay` `src/presentation/controllers/chat-relay-controller.ts:24-62`), in order: not same-origin → **403 `{"error":"この画面から送信してください。"}`**; not `application/json` → **415 「JSON形式で送信してください。」**; no `zl_access` → **401 `{"error":"認証が必要です。"}`** (relay shape); body > 256 KiB → **413 「会話が大きすぎます。」**, unreadable → 400 「リクエストを読み取れませんでした。」; `fetch(GO + "/v1/chat")` fails → **502 `{"error":"ChatGPTから応答を受信できませんでした。"}`**; else Go's status, content type and body + `Cache-Control: no-store`. No `maxDuration`.
- Browser: `use-chat-conversation.ts` (title `conversationTitle` = squeezed first message cut at **80** code points or 「新しい会話」; `fitsLimits` 40 messages / 40 000 chars; an answer crossing the limits sets `ended`; saves the whole conversation after each complete answer via `saveConversationAction`, skipping an unchanged JSON; a failed save → 「保存できませんでした。次の回答のときにもう一度保存します。」 and is retried after the next answer; the message of a failed save is ignored). Stream texts (`useAnswerStream`/`chat-stream.ts`): failure 「ChatGPTから応答を受信できませんでした。」 (or the server's message), cut 「応答が途中で切れました。」, stopped 「応答を停止しました。」; a failed/cut answer puts the question back in the input.
- Actions `src/presentation/actions/conversation-actions.ts`:
  - save :48-64: `getCurrentViewerUser()` not admin/member → `accountForbiddenMessage`; zod (`id: z.uuid()`, strings, `ended` boolean, `createdAt: z.iso.datetime()`, messages `{id, role enum, text}`; unknown keys dropped) fails → 「会話の形式または上限を確認してください。」; `attemptGoResult("CONVERSATION_SAVE_FAILED")`: Go 400 `invalid_request` message passes through, 403 → `accountForbiddenMessage`, 404/405/other → generic 「処理できませんでした。時間をおいてもう一度お試しください。」 + log. No revalidate.
  - delete :66-83: not admin/member → `actionUnauthorized` 「ログインし直してください。」; `z.uuid()` fails → 「会話の形式または上限を確認してください。」; `attemptGoAction("CONVERSATION_DELETE_FAILED")` (Go 404 → generic); success → `revalidatePath("/conversations", "layout")` + `redirect("/conversations")`.
- Gateway `src/infrastructure/go-api/conversation-gateway.ts` (list 404 → `ChatUnavailableError`, get 404 → null, save PUT with ISO `createdAt`, remove DELETE); container `src/composition/chat-container.ts` exports `conversationNotes`. `ChatUnavailableError` (`src/domain/chat/chat-unavailable.ts`) is now thrown only by this gateway and caught by `/chat` and `chat-guard.ts`; in production it never happens (Go always has `Conversations`).
- Guard `src/presentation/guards/chat-guard.ts`: `requireChatUser` (signed out → sign-in, guest → 404, demo allowed); `loadConversationList` (`ChatUnavailableError` → null).
- Pages:
  - `/chat` (`src/app/chat/page.tsx`): local UUID regex on `?id` → 404; list → `chatModel` + 8 recent; `chatModel` "" or null → EmptyState 「ChatGPT が設定されていません」/「Go API に OPENAI_API_KEY を設定すると、ここで会話できます。」; with `chatModel` and `id`, `get` null → 404. The demo sees the page (menu hides it; the API refuses).
  - `/conversations`: null → EmptyState with the Go text; days grouped by `createdAt` (JST); 「ChatGPT と話す」 button unless demo.
  - `/conversations/[y]/[m]/[d]`: null → 404. `/…/[number]`: number within the day from the list → `get` → messages, 「続きを話す」 unless ended, Markdown export (`conversation-markdown-export.ts`), delete form.
- Domain `src/domain/chat/conversation.ts`: types, `MAX_MESSAGES = 40`, `MAX_TOTAL_CHARS = 40_000`, `MAX_INPUT_CHARS = 4_000` (input box only), title 80.
- Unit tests: `tests/chat-relay-controller.test.ts` (7 tests, all die), `tests/go-api-conversation-gateway.test.ts` (dies), `tests/conversation.test.ts`, `tests/conversation-dates.test.ts`, `tests/conversation-markdown-export.test.ts`, `tests/chat-stream.test.ts`, `tests/site-navigation.test.ts`, `tests/ai-usage.test.ts` (label).
- E2E: `e2e/chat.spec.ts` :12 admin chats/continues/deletes; :65 member chats (owner = member), guest 404 and no menu; :110 saving keeps the screen; :151 failed save retried after the next answer; :185 stop does not resend. `e2e/act-as.spec.ts:13` conversation saved as the member's (no usage check). `e2e/demo.spec.ts:28` demo reads the fixture's 2 conversations, no 「ChatGPT と話す」 button or menu item. `e2e/bottom-navigation.spec.ts:65`. OpenAI stub (`e2e/openai-stub.ts`) already streams usage (21/43) and handles `[incomplete]`, `[fail]`, `[hang]` + `GET /e2e/streams`.
- **Gaps:** chat usage recorded at all (feature `chat`, owner, admin pays while acting); demo refused on `POST /api/chat`; an incomplete answer ends with `done` and is saved; a failure before text (502) for the chat; another owner's conversation id neither readable nor overwritable; stopping a chat answer stops the OpenAI request.

## 7. What remaining Go still needs after stage 7 (keep)

- **Demo reset (stage 10):** store/demo.go:21-25 (`DemoSeed.Conversations []Conversation`), :150-158 (own `INSERT INTO "ChatConversation"`), :67 (deletes by table name); demo/demo.go:51,160-171 builds `store.Conversation`/`ConversationSummary`/`ConversationMessage`. **Keep the three types** (move them into store/demo.go). store/demo_test.go:124-130 reads through `ListConversations`/`GetConversation` → rewrite with SQL (`countRows` testhelpers_test.go:94).
- **LINE (stage 10):** `learning`, `openai` (`Request` without `Accept`, `Fail`, `TransportError`, codes, `ReportUsage` — used by `ReportBodyUsage` —, `ReportBodyUsage`), `aiusage` (`WithRecorder`, `Report`, `FeatureLine`; linebot/service.go:264-272 records with its own store call), `newNoRedirectHTTPClient` (main.go:47-56,84,91). Go's `OPENAI_API_KEY` is then for LINE only.
- Still used: `pathValueMsg` (admin_handlers.go:156), `formatTime`, `decodeBody`, `writeStoreError`, `writeBodyError`.
- Test helpers defined in files that die but used elsewhere: `newUUID` (store/conversations_test.go:24-30; used by testhelpers_test.go:236,274,288, vocabulary_test.go:35); `jsonAuth` (chat_handlers_test.go:93; used by study_log_handlers_test.go, demo_test.go:83); `testConversationID` (demo_test.go:68 path replacer).
- Go tests leaning on chat code: act_as_test.go:33-55 (`TestActAsWritesGoToTheMember`), :98 (deps); demo_test.go:45 (`allRoutesDeps`), :56-69 (closed list has `POST /v1/chat`), :98-124 (`TestDemoKeepsItsOwnRecords` on `GET /v1/conversations`); router_test.go:26,61,134 (deps), :160-189 (`TestSavedNotesReadableWithoutOpenAI`, whole test about chat); ai_usage_handlers_test.go:17-35 (`fakeAIUsage` recording part), :94-131; config_test.go:331-349, :369-382.
- Routes left that honour act-as / let the demo in: `GET /v1/study-log` (private; `fakeStudyLog.owner` study_log_handlers_test.go:13-21), `PUT|DELETE /v1/follows/{ownerId}` (notForDemo; follower = `Principal.OwnerID` follow_handlers.go:48-70), `GET /v1/members`, `GET /v1/timeline`, `GET /v1/me`.

## 8. Becomes dead when the web owns the chat

- Go: chat/ (whole package: chat.go, chat_test.go, openai.go, openai_test.go, usage_test.go); httpapi/chat_handlers.go, httpapi/chat_handlers_test.go; store/conversations.go (except the 3 types), store/conversations_test.go (except `newUUID`); router.go:95-102 (`Chat`, `Conversations`, `ChatModel` + comment), :164, :228-231 (`trackAI`), :332-351; ai_usage_handlers.go:24-54 (`recordTimeout`, `trackAIUsage`; `AIUsage.RecordAIUsage` then has no caller in httpapi); main.go:16 (import), :171-173, :189-198; config.go:18-20, :49 comment, :53, :76-78, :165 comment, :170-172; respond.go:51-53, :75, :167-172 (`uuidPattern`, `validUUID`: only the chat used them); openai/openai.go `Request.Accept` (:48,54,76-78; only the chat set it); aiusage.go:16 `FeatureChat`.
- Web: `src/composition/chat-relay.ts`, `src/presentation/controllers/chat-relay-controller.ts`, `tests/chat-relay-controller.test.ts`, `src/infrastructure/go-api/conversation-gateway.ts`, `tests/go-api-conversation-gateway.test.ts`, `src/domain/chat/chat-unavailable.ts` and its catches (`/chat`, `chat-guard.ts`), the null branches of the three conversation pages.
- Docs: `docs-site/reference/chat.md`, its nav entry `docs-site/.vuepress/config.ts:33`, `docs-site/reference/README.md:7` (the chat 404/405 remark) and :30-34 (5 rows), `docs-site/reference/admin.md:139`, `docs-site/README.md:26` (list of what the web handles) and :51 (example path), `docs-site/operations/deploy.md:54,205-220`, `docs/features.md:7,14,92,97`, `docs/architecture.md:15,172-182,209`, `docs/api-deployment.md:50,72,162,168,386-399,426`, `README.md:33`, `.env.example:56-57`, `e2e/server.ts:128-132` (comment).
