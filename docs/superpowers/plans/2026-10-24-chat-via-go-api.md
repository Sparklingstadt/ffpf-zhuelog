# ChatGPT との会話練習（/chat）を Go API で作り直す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者が `/chat` で ChatGPT と会話練習をし、その会話が自動で保存されて `/conversations` で見返せるようにする。

**Architecture:** Go API（`services/api`）に `POST /v1/chat`（OpenAI Responses API の SSE を NDJSON に直して流す）と会話の CRUD（`/v1/conversations`）を足し、表 `ChatConversation` に保存する。Web（Next.js）は `/api/chat` の Route Handler で Go に中継し、会話の読み書きは Go API のゲートウェイと Server Action で行う。

**Tech Stack:** Go 1.x（net/http、pgx）、Prisma（スキーマとマイグレーションだけ）、Next.js 16（App Router、Route Handler、Server Action）、node:test、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-24-chat-via-go-api-design.md`

## Global Constraints

- 使う人は admin だけ。Go は既存の `requireAdmin`（403「管理者だけが利用できます。」）、Web は管理者以外に `notFound()`。
- Go のルートは `OPENAI_API_KEY` があるときだけ登録する。
- モデルは `OPENAI_CHAT_MODEL`、無ければ `gpt-6.1-sol`。`store: false`、`reasoning.effort: "medium"`、`max_output_tokens: 1600`、`stream: true`。
- OpenAI への 1 回の呼び出しは 60 秒で打ち切る。chat の書き込みの期限は 90 秒（server の WriteTimeout 30 秒を延ばす）。
- 上限：`messages` 1〜40 件、合計 4 万字、各 text は空白だけでない、`/v1/chat` の本文 256 KiB。保存の `title` 1〜100 字、`modelName` 1〜150 字、message の `id` 1〜200 字で重ならない、会話の `id` は UUID。
- 流す形：1 行 1 JSON（`application/x-ndjson`）。`{"type":"delta","text":"…"}`・`{"type":"done"}`・`{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}`。
- 文言：400「会話内容が上限を超えているか、形式が不正です。」、413「会話が大きすぎます。」、404「会話が見つかりません。」、502「ChatGPTから応答を受信できませんでした。」。
- ログに会話の中身を出さない。OpenAI の鍵は Go にだけ置く。
- 日付は日本時間の `createdAt`（`getTokyoDateParts`）。その日の番号は古い順に 1 から。

## Review Focus

- 停止ボタン・画面を離れたとき：Web→Go→OpenAI の接続がすべて切れ、Go が書きかけの応答で落ちない（Task 3 で ctx の打ち切りを、Task 4 で中継の abort をテストする）。
- NDJSON の 1 行が chunk の途中で切れて届く：組み立て直して正しく表示する（Task 6 でテストする）。
- 他の人の会話の id で `PUT`：上書きせず 404（Task 1 の store テスト、Task 4 のハンドラのテスト）。
- 2 回目以降の `PUT` で `createdAt` を送り直しても変わらない（Task 1）。
- 保存に失敗した直後の次の回答：もう一度まるごと保存される（Task 7 の `ChatInterface` は「保存済みの内容」と比べて未保存なら保存する。e2e で保存が届くことを確かめる）。

---

### Task 1: 表 `ChatConversation` と Go の store

**Files:**

- Modify: `prisma/schema.prisma`（`model ChatConversation`）
- Create: `prisma/migrations/20261024090000_add_chat_conversations/migration.sql`
- Create: `services/api/store/conversations.go`
- Test: `services/api/store/conversations_test.go`

**Interfaces:**

- Produces（`store` パッケージ）:
  - `type ConversationMessage struct { ID, Role, Text string }`（JSON タグ `id`・`role`・`text`）
  - `type ConversationSummary struct { ID, Title, ModelName string; Ended bool; CreatedAt, UpdatedAt time.Time }`
  - `type Conversation struct { ConversationSummary; Messages []ConversationMessage }`
  - `func (s *Store) ListConversations(ctx context.Context, ownerID string, limit int) ([]ConversationSummary, error)` — `createdAt DESC, id DESC`
  - `func (s *Store) GetConversation(ctx context.Context, ownerID, id string) (Conversation, error)` — 無い・他人は `ErrNotFound`
  - `func (s *Store) PutConversation(ctx context.Context, ownerID string, c Conversation, now time.Time) (Conversation, error)` — 無ければ作る（`createdAt` は c の値、`updatedAt` は now）。同じ id で同じ持ち主なら `title`・`modelName`・`ended`・`messages`・`updatedAt` だけ更新。他人の行なら何も変えず `ErrNotFound`
  - `func (s *Store) DeleteConversation(ctx context.Context, ownerID, id string) error` — 消せなければ `ErrNotFound`

- [ ] **Step 1: スキーマとマイグレーションを書く**

列・索引は仕様書 6 章のとおり（`@@unique([id, ownerId])`・`@@index([ownerId, updatedAt])`・`@@index([ownerId, createdAt])`、`updatedAt` は `@updatedAt`）。migration.sql は削除前の `20261001100000_chat_conversations` と `20261004090000_chat_conversation_created_at` を合わせた内容。`pnpm prisma migrate diff` でスキーマと一致することを確かめる。

- [ ] **Step 2: 失敗するテストを書く**（`testStore(t)` を使う。`API_TEST_DATABASE_URL` が無ければ skip）

```go
func TestPutConversationCreatesThenUpdatesKeepingCreatedAt(t *testing.T) // 2 回目の PUT で createdAt を別の値で送っても最初の値のまま、updatedAt は 2 回目の now
func TestPutConversationOfAnotherOwnerIsNotFound(t *testing.T)          // owner B が A の id で PUT → ErrNotFound、A の行は変わらない
func TestListConversationsIsNewestFirstAndOwnersOnly(t *testing.T)     // 他人の会話は出ない、createdAt の新しい順、limit が効く、Messages は持たない
func TestGetAndDeleteConversation(t *testing.T)                        // 他人の id は ErrNotFound、削除後の Get は ErrNotFound、2 回目の Delete は ErrNotFound
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `pnpm api:db && cd services/api && API_TEST_DATABASE_URL=… go test ./store -run Conversation`（URL は `scripts/api-local.sh` の値）
Expected: FAIL（`PutConversation` が無い）

- [ ] **Step 4: `store/conversations.go` を実装する**

upsert は `INSERT … ON CONFLICT (id) DO UPDATE SET … WHERE "ChatConversation"."ownerId" = EXCLUDED."ownerId" RETURNING …`。行が返らなければ `ErrNotFound`。`messages` は `json.Marshal` して JSONB に入れる。

- [ ] **Step 5: テストが通ることを確かめる** — 同じコマンドで PASS

- [ ] **Step 6: Commit** — `feat(api): 会話ノートの表と store を足す`

### Task 2: 設定（`OPENAI_API_KEY` だけで起動できる、`OPENAI_CHAT_MODEL`）

**Files:**

- Modify: `services/api/config.go`
- Test: `services/api/config_test.go`

**Interfaces:**

- Produces: `Config.OpenAIChatModel string`（既定 `"gpt-6.1-sol"`）、`func (c Config) ChatEnabled() bool`（`OpenAIAPIKey != ""`）。`LineEnabled()` は今の意味のまま。

- [ ] **Step 1: 失敗するテストを書く**

```go
func TestLoadConfigOpenAIAloneEnablesChatNotLine(t *testing.T) // OPENAI_API_KEY だけ → err なし、ChatEnabled() true、LineEnabled() false
func TestLoadConfigLineWithoutOpenAIFails(t *testing.T)        // LINE の 2 つだけ → エラー
func TestLoadConfigLinePartialFails(t *testing.T)              // LINE_CHANNEL_SECRET と OPENAI_API_KEY だけ → エラー
func TestLoadConfigChatModelDefaultAndOverride(t *testing.T)   // 未設定 → "gpt-6.1-sol"、"gpt-x" → "gpt-x"
```

- [ ] **Step 2: 落ちることを確かめる** — `cd services/api && go test . -run LoadConfig` → FAIL
- [ ] **Step 3: 実装する** — LINE の検査を「LINE の 2 つはそろうか両方空、LINE があるなら `OPENAI_API_KEY` も要る」に変える。エラー文は今の文を残す。
- [ ] **Step 4: 通ることを確かめる** — `go test .` PASS
- [ ] **Step 5: Commit** — `feat(api): OPENAI_API_KEY だけで起動でき、チャットのモデルを設定できるようにする`

### Task 3: `chat` パッケージ（入力の確かめと OpenAI のストリーミング）

**Files:**

- Create: `services/api/chat/chat.go`（システムプロンプト・上限・`Validate`）
- Create: `services/api/chat/openai.go`（`Streamer`）
- Test: `services/api/chat/chat_test.go`、`services/api/chat/openai_test.go`

**Interfaces:**

- Produces（`chat` パッケージ）:
  - `type Message struct { Role, Text string }`（JSON タグ `role`・`text`）
  - `const MaxMessages = 40; const MaxTotalChars = 40_000`
  - `func Validate(msgs []Message) error` — `ErrInvalid` を返す
  - `var ErrInvalid = errors.New("chat: invalid messages")`
  - `type Error struct{ Code string }`（`learning.Error` と同じコード：`OPENAI_TIMEOUT`・`OPENAI_AUTH_FAILED`・`OPENAI_RATE_LIMITED`・`OPENAI_INVALID_RESPONSE`・`OPENAI_REQUEST_FAILED`）
  - `type Streamer struct { HTTP *http.Client; BaseURL, APIKey, Model string }`
  - `func (s *Streamer) Stream(ctx context.Context, msgs []Message, emit func(text string) error) error` — `emit` は delta ごとに呼ぶ。最後まで届けば nil。`emit` の失敗はそのまま返す。

- [ ] **Step 1: 失敗するテストを書く**

```go
func TestValidate(t *testing.T) // 表で：0 件・41 件・最後が assistant・role が system・text が "  \n"・合計 40_001 字 → ErrInvalid。1 件の user・40 件で最後が user・合計 40_000 字 → nil。字数は rune で数える
func TestStreamSendsModelPromptAndStoreFalse(t *testing.T)  // httptest の偽サーバーで本文を確かめる：model、stream:true、store:false、reasoning.effort "medium"、max_output_tokens 1600、instructions が SystemPrompt、input が [{role,content}]、Authorization: Bearer
func TestStreamEmitsOnlyTextDeltas(t *testing.T)            // SSE：response.created、output_text.delta "你"・"好"、response.completed → emit が ["你","好"]、err nil
func TestStreamIncompleteCountsAsDone(t *testing.T)         // delta の後 response.incomplete → nil
func TestStreamFailedEventsAndStatuses(t *testing.T)        // error イベント・response.failed → OPENAI_INVALID_RESPONSE、401 → OPENAI_AUTH_FAILED、429 → OPENAI_RATE_LIMITED、500 → OPENAI_REQUEST_FAILED、completed 無しで本文が終わる → OPENAI_INVALID_RESPONSE
func TestStreamStopsWhenContextCancelled(t *testing.T)      // 偽サーバーが delta 1 つの後に止まる。ctx を cancel → Stream が 1 秒以内に non-nil を返す
func TestStreamTimesOut(t *testing.T)                       // timeout を小さく差し替えられるよう、Streamer に未公開のフィールド timeout を持たせる（0 なら 60s）→ OPENAI_TIMEOUT
```

- [ ] **Step 2: 落ちることを確かめる** — `go test ./chat` → FAIL（パッケージが無い）
- [ ] **Step 3: 実装する** — `SystemPrompt` は仕様書 5.3 の文面そのまま。SSE は `bufio.Scanner`（バッファ 1 MiB）で `data: ` 行を読み、`type` で振り分ける。リダイレクトは `learning` と同じく止める。
- [ ] **Step 4: 通ることを確かめる** — `go test ./chat` PASS
- [ ] **Step 5: Commit** — `feat(api): OpenAI の応答を流す chat パッケージを足す`

### Task 4: Go のハンドラ・ルート・main のつなぎ

**Files:**

- Create: `services/api/httpapi/chat_handlers.go`
- Modify: `services/api/httpapi/router.go`（`Deps.Chat`・`Deps.Conversations`・`Deps.ChatModel`、ルートの登録）
- Modify: `services/api/httpapi/respond.go`（文言の定数）
- Modify: `services/api/main.go`（`cfg.ChatEnabled()` のときつなぐ）
- Test: `services/api/httpapi/chat_handlers_test.go`、`services/api/httpapi/router_test.go`（ルート表）、`services/api/main_test.go`（必要なら）

**Interfaces:**

- Consumes: Task 1 の store のメソッド、Task 3 の `chat.Message`・`chat.Validate`・`(*chat.Streamer).Stream`
- Produces:
  - `type ChatStreamer interface { Stream(ctx context.Context, msgs []chat.Message, emit func(string) error) error }`
  - `type Conversations interface { ListConversations…; GetConversation…; PutConversation…; DeleteConversation… }`（Task 1 のシグネチャ）
  - `Deps.Chat ChatStreamer`（nil ならルートを登録しない）、`Deps.Conversations Conversations`、`Deps.ChatModel string`
  - JSON：要約は `{id,title,modelName,ended,createdAt,updatedAt}`、1 件はそれに `messages:[{id,role,text}]`。日時は RFC 3339（ミリ秒、UTC）。一覧は `{"chatModel":…, "conversations":[…]}`。`PUT` は保存後の 1 件を返す。`DELETE` は `204`。

- [ ] **Step 1: 失敗するテストを書く**（`routerWith(t, auth.RoleAdmin, Deps{Chat: fake, Conversations: fake, ChatModel: "m"})`）

```go
func TestChatRoutesAreAdminOnly(t *testing.T)          // member・guest で 5 ルートとも 403 forbidden
func TestChatRoutesMissingWithoutStreamer(t *testing.T) // Deps.Chat が nil → POST /v1/chat が 404
func TestChatStreamsNDJSONAndDone(t *testing.T)        // fake が "你","好" を emit → Content-Type application/x-ndjson、本文が 3 行 delta,delta,done
func TestChatErrorBeforeWritingIs502(t *testing.T)     // fake が emit せず chat.Error → 502、JSON の message が msgChatFailed
func TestChatErrorAfterWritingIsErrorLine(t *testing.T) // emit 1 回の後に失敗 → 200、最後の行が {"type":"error","message":msgChatFailed}
func TestChatRejectsInvalidAndLarge(t *testing.T)      // 最後が assistant → 400 invalid_request（message は msgChatInvalid）、256 KiB を超える本文 → 413 too_large
func TestChatPassesRequestContext(t *testing.T)        // fake が受けた ctx を cancel 済みのリクエストで呼ぶと ctx.Err() != nil
func TestConversationCRUD(t *testing.T)                // list の形と chatModel、get の 404（ErrNotFound）、不正な UUID は 400、PUT の検証（title 101 字・message id の重なり・不正な createdAt → 400）、PUT が ownerID=testOwner と now を渡す、DELETE 204 と 404
```

`router_test.go` の既存のルート表のテストに、5 つのルートが「authed、?user= を受け付けない、guest 不可」として出ることを足す。

- [ ] **Step 2: 落ちることを確かめる** — `go test ./httpapi` → FAIL
- [ ] **Step 3: 実装する**
  - `/v1/chat`：`http.MaxBytesReader` で 256 KiB、`decodeBody`、`chat.Validate`、`extendChatDeadlines(w)`（`extendLineDeadlines` と同じ作りで 90 秒）。最初の emit のときにヘッダー（`Content-Type: application/x-ndjson; charset=utf-8`）を書く。各行の後に `http.NewResponseController(w).Flush()`。失敗は `chat.Error` の Code だけをログに出す。
  - CRUD の検証は `validate.go` の流儀で `validateConversation` を足す。
  - main：`cfg.ChatEnabled()` なら `deps.Chat = &chat.Streamer{HTTP: newNoRedirectHTTPClient(65 * time.Second), BaseURL: cfg.OpenAIBaseURL, APIKey: cfg.OpenAIAPIKey, Model: cfg.OpenAIChatModel}`、`deps.Conversations = db`、`deps.ChatModel = cfg.OpenAIChatModel`。
- [ ] **Step 4: 通ることを確かめる** — `go test ./...` と `go vet ./...` PASS
- [ ] **Step 5: Commit** — `feat(api): 会話練習と会話ノートのルートを足す`

### Task 5: Web の型・ゲートウェイ・日付のまとめ

**Files:**

- Create: `src/domain/chat/conversation.ts`
- Create: `src/infrastructure/go-api/conversation-gateway.ts`
- Create: `src/composition/chat-container.ts`
- Create: `src/presentation/presenters/conversation-dates.ts`
- Test: `tests/go-api-conversation-gateway.test.ts`、`tests/conversation-dates.test.ts`、`tests/conversation.test.ts`

**Interfaces:**

- Produces:
  - `src/domain/chat/conversation.ts`：`type ChatRole = "user" | "assistant"`、`type ConversationMessage = { id: string; role: ChatRole; text: string }`、`type ConversationSummary = { id; title; modelName; ended: boolean; createdAt: Date; updatedAt: Date }`、`type Conversation = ConversationSummary & { messages: ConversationMessage[] }`、`MAX_MESSAGES = 40`、`MAX_TOTAL_CHARS = 40_000`、`conversationTitle(text: string): string`（空白をつめて 80 字、空なら「新しい会話」）、`fitsLimits(messages: { text: string }[]): boolean`
  - `createConversationGateway(call: GoApiCall = goApiAuthed)` が返す `{ list(): Promise<{ chatModel: string; conversations: ConversationSummary[] }>; get(id: string): Promise<Conversation | null>; save(c: Conversation): Promise<void>; remove(id: string): Promise<void> }`。`get` は Go の 404 で null。`list` の 404（Go にチャットが無い）は `ChatUnavailableError` を投げる（同じファイルで export）。
  - `src/composition/chat-container.ts`：`export const conversationNotes = createConversationGateway();`
  - `conversation-dates.ts`：`listConversationDates(items: ConversationSummary[]): { date: LogDate; count: number }[]`（新しい日から）、`conversationsOn(items, date: LogDate): (ConversationSummary & { number: number })[]`（古い順、number は 1 から）

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("list maps Go JSON to dates and keeps chatModel"); // createdAt/updatedAt が Date、path は "/v1/conversations"、method GET
test("list throws ChatUnavailableError on 404");
test("get returns null on 404 and encodes the id");
test("save PUTs the whole conversation with ISO dates"); // path "/v1/conversations/<id>"、body の createdAt は toISOString()、updatedAt は送らない
test("remove DELETEs");
test("conversationTitle squeezes spaces, cuts at 80, falls back");
test("fitsLimits counts 40 messages and 40000 chars");
test("listConversationDates groups by Tokyo date, newest first"); // 2026-10-23T15:30Z は 10/24 に入る
test("conversationsOn numbers the day's conversations oldest first");
```

- [ ] **Step 2: 落ちることを確かめる** — `node --import tsx --test tests/go-api-conversation-gateway.test.ts tests/conversation-dates.test.ts tests/conversation.test.ts` → FAIL
- [ ] **Step 3: 実装する**（`social-gateway.ts` の書き方に合わせる）
- [ ] **Step 4: 通ることを確かめる** — 同じコマンドで PASS、`pnpm typecheck` PASS
- [ ] **Step 5: Commit** — `feat(web): 会話ノートのゲートウェイと日付のまとめを足す`

### Task 6: Web の中継 `/api/chat` と NDJSON の読み取り

**Files:**

- Create: `src/app/api/chat/route.ts`
- Create: `src/presentation/controllers/chat-relay-controller.ts`
- Create: `src/presentation/http/same-origin.ts`（#66 で消した版を戻す）
- Create: `src/presentation/components/chat/chat-stream.ts`
- Test: `tests/chat-relay-controller.test.ts`、`tests/chat-stream.test.ts`

**Interfaces:**

- Produces:
  - `handleChatRelay(request: Request, deps: { accessToken: string | undefined; fetchGo: (path: string, init: RequestInit) => Promise<Response> }): Promise<Response>`。route.ts は `readAccessToken()` と、`goApiUrl()`・`isSafeGoApiUrl()` を確かめて `fetch(base + path, …)` する `fetchGo` を渡す（`redirect: "error"`、`cache: "no-store"`、`signal: request.signal`）。
  - `readChatStream(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<"done" | { error: string } | "cut">`

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("relay rejects cross-origin with 403"); // Origin が別 → 403「この画面から送信してください。」
test("relay rejects non-JSON with 415");
test("relay answers 401 without a token");
test("relay rejects bodies over 256 KiB with 413");
test("relay forwards body and bearer token to /v1/chat"); // fetchGo の path・method POST・authorization・content-type
test("relay passes Go status, content-type and body through"); // 502 の JSON も、200 の NDJSON もそのまま。Cache-Control: no-store
test("relay answers 502 when Go is unreachable"); // fetchGo が throw → 502「ChatGPTから応答を受信できませんでした。」
test("readChatStream joins lines split across chunks"); // '{"type":"del' と 'ta","text":"你"}\n{"type":"done"}\n' → onDelta("你")、"done"
test("readChatStream reports cut without done");
test("readChatStream returns the error line's message");
```

- [ ] **Step 2: 落ちることを確かめる** — `node --import tsx --test tests/chat-relay-controller.test.ts tests/chat-stream.test.ts` → FAIL
- [ ] **Step 3: 実装する** — 本文の上限の読み取りは #66 で消した `read-limited-body.ts` の考え方で controller の中に置く（Buffer を使わず `Uint8Array` で数える）。route.ts は `export const dynamic = "force-dynamic"`。
- [ ] **Step 4: 通ることを確かめる** — PASS、`pnpm typecheck`・`pnpm lint` PASS
- [ ] **Step 5: Commit** — `feat(web): /api/chat で Go の会話練習を中継する`

### Task 7: 画面（`/chat`・`/conversations`）と入口

**Files:**

- Create: `src/app/chat/page.tsx`
- Create: `src/presentation/components/chat/chat-interface.tsx`（client）
- Create: `src/presentation/components/chat/chat-message.tsx`（#66 の前の版を、`ConversationMessage` を受けるように戻す）
- Create: `src/presentation/actions/conversation-actions.ts`
- Create: `src/app/conversations/page.tsx`、`src/app/conversations/[year]/[month]/[day]/page.tsx`、`src/app/conversations/[year]/[month]/[day]/[number]/page.tsx`
- Create: `src/presentation/components/chat/delete-conversation-button.tsx`（確認のダイアログ）
- Modify: `src/presentation/components/layout/app-header.tsx`（admin に「ChatGPT と話す」）、`src/app/page.tsx`（admin にボタン）

**Interfaces:**

- Consumes: Task 5 の `conversationNotes`・`ChatUnavailableError`・`conversationTitle`・`fitsLimits`・日付のまとめ、Task 6 の `readChatStream`
- Produces:
  - `saveConversationAction(input: { id; title; modelName; ended; createdAt: string; messages: ConversationMessage[] }): Promise<{ ok: true } | { ok: false; message: string }>` — admin でなければ `{ ok: false, message: accountForbiddenMessage }`
  - `deleteConversationAction(id: string): Promise<void>` — 消した後 `redirect("/conversations")`
  - `<ChatInterface chatModel={string} initial={Conversation | null} />`

- [ ] **Step 1: `/chat` を作る** — `getCurrentViewerUser()` が null なら `/signin?callbackUrl=/chat`、admin でなければ `notFound()`。`conversationNotes.list()` で `chatModel` を得る（`ChatUnavailableError` なら「ChatGPT が設定されていません。」の `EmptyState`）。`?id=` が UUID なら `get`、無ければ `notFound()`。
- [ ] **Step 2: `ChatInterface` を作る** — 状態は `conversation`（id は `crypto.randomUUID()`、createdAt は最初の送信の時刻）、`savedJson`（最後に保存できた内容の JSON）、`status`。送信：`fitsLimits` を超えるなら `ended: true` で保存して仕様書 7.2 の文言を出す。`fetch("/api/chat", { signal })` → `!ok` なら JSON の `error.message` か汎用文言 → `readChatStream` で文字を足す → `"done"` なら保存（今の内容の JSON が `savedJson` と違えば `saveConversationAction`、失敗なら仕様書 7.2 の文言）。`"cut"`・`{error}` は受け取った分を表示し「応答が途中で切れました。」、その回答は保存の対象に入れない。停止は `AbortController.abort()`。`ended` のときは入力欄を出さない。
- [ ] **Step 3: 会話ノートの 3 画面を作る** — `/logs` の 3 画面と同じ組み立て（`PageShell`・`PageHeader`・`EmptyState`・`parseLogDate`・`parseLogNumber`・`getLogDateHref(date, "/conversations")`）。中身の画面に「続きを話す」（`/chat?id=`、`ended` なら出さない）と削除のボタン。
- [ ] **Step 4: 入口を足す** — ヘッダーの `isAdmin` の枠に `NavLink href="/chat"`、ホームの見出しの操作に admin だけ「ChatGPT と話す」と「会話ノート」。
- [ ] **Step 5: 確かめる** — `pnpm typecheck`・`pnpm lint`・`pnpm test:unit` PASS、`pnpm build` PASS
- [ ] **Step 6: Commit** — `feat(web): 会話練習と会話ノートの画面を足す`

### Task 8: e2e（OpenAI の偽サーバー）

**Files:**

- Create: `e2e/openai-stub.ts`（`startOpenAiStub(port: number): Promise<{ close(): Promise<void> }>`）
- Modify: `e2e/server.ts`（スタブを起動し、`OPENAI_API_BASE_URL` をそこに向ける）、`e2e/environment.ts`（`openAiStubURL = "http://127.0.0.1:3109"`）、`e2e/fixtures.ts`（`TRUNCATE` に `"ChatConversation"`）
- Create: `e2e/chat.spec.ts`

**Interfaces:**

- スタブは `POST /v1/responses` に、受け取った最後の user の text を含む `你好！「<text>」ですね。` を 3 つの `response.output_text.delta` に分けて送り、`response.completed` で終える。

- [ ] **Step 1: テストを書く**

```ts
test("admin chats, the conversation is saved and can be continued and deleted"); // asAdmin → / の「ChatGPT と話す」→ 送信 → 回答が見える → /conversations に今日の 1 件 → 中身に両方の発言 → 続きを話す → 2 回目の回答 → 中身に 4 発言 → 削除 → 一覧が空
test("members and guests have no way in"); // asMember・asGuest：ホームとヘッダーに入口が無い、/chat と /conversations が 404
```

- [ ] **Step 2: 走らせる** — `pnpm test:e2e -- e2e/chat.spec.ts` → PASS。続けて `pnpm test:e2e` 全体（LINE の e2e が向け先の変更で壊れていないこと）。
- [ ] **Step 3: Commit** — `test(e2e): 会話練習と会話ノートを確かめる`

### Task 9: ドキュメント

**Files:**

- Modify: `README.md`、`.env.example`、`docs/api-deployment.md`、`docs-site/reference/README.md`（ルートの一覧）、`docs-site/errors.md`（文言）

- [ ] **Step 1: 書く** — `OPENAI_API_KEY` だけでチャットが有効になること、LINE には 3 つとも要ること、`OPENAI_CHAT_MODEL`、5 つのルートと NDJSON の形、本番に出す手順（マイグレーション → Go のプレビューでストリーミングを確かめる → マージ → Go を手でデプロイ）。
- [ ] **Step 2: 確かめる** — `pnpm format:check`、`pnpm api-docs:build` PASS
- [ ] **Step 3: Commit** — `docs: 会話練習の設定とルートを書く`
