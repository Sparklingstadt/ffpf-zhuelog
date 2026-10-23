# LINE の添削・翻訳を Go API で作り直す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会員と管理者が自分の LINE を結びつけ、LINE に送った文を OpenAI で添削・翻訳して自分の学習ノートに追加できるようにする。

**Architecture:** Go API（`services/api`）に、LINE の webhook・連携コード・拾い直しのルートを足す。処理は webhook のリクエストの中で行う（保存 → OpenAI → ノート保存 → reply）。部品は `line`（LINE とのやり取り）・`learning`（OpenAI）・`linebot`（流れのまとめ）・`store`（DB）に分け、`httpapi` は薄く保つ。Web は `/account/line` で連携コードの発行と解除だけを行う。

**Tech Stack:** Go（`net/http`・pgx）、Prisma のマイグレーション、Next.js（Server Action）、node:test、Playwright

**Spec:** `docs/superpowers/specs/2026-10-23-line-via-go-api-design.md`

## Global Constraints

- モデルは `gpt-5-mini`、`store: false`、OpenAI の打ち切りは 20 秒。その場での再試行はしない。
- 文字数の上限は 500 文字（rune で数える）。501 文字以上は上限のお知らせだけ。
- 生成の上限：本文（`correctedText` / `translatedText`）1000 文字、`pinyin` 1600 文字、`hints` は各 200 文字で 1〜5 個。
- 連携コードは 8 文字、文字は `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（`0`・`O`・`1`・`I` を除く）、10 分で切れる。DB には SHA-256 の 16 進だけを保存する。
- 連携コードの失敗は `SignInThrottle` のキー `line-link:<lineUserId>` で 1 時間に 5 回まで。
- `LineMessage.attempts` は 2 で打ち止め。拾い直しの対象は、作られてから 5 分以上たった `pending`。`done` / `failed` は 7 日で消す。
- バッチ名（`ImportBatch.fileName`）は `LINE`。1 メッセージにつき 1 バッチ・1 ノート。
- ログに本文・生成結果・鍵・LINE のユーザー ID・連携コードを出さない。
- `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY` は全部設定か全部空。全部空なら LINE のルートは登録しない（`404`）。`CRON_SECRET` が空なら拾い直しは常に `401`。
- `OPENAI_API_BASE_URL`・`LINE_API_BASE_URL` はループバック（ホストが `127.0.0.1`・`::1`・`localhost`）だけを受け付ける。
- 返信の見出し：添削は【元の文】【添削後】【ピン音】【ヒント】、翻訳は【元の文】【中国語訳】【ピン音】【ヒント】、最後に「学習ノートに保存しました」。
- スキーマは Prisma が持つ。Go は DDL を実行しない。
- コメント・文言・ドキュメントは、まわりのコードと同じ書き方（Go のコメントは英語、画面の文言とドキュメントは日本語）。

## Review Focus

1. LINE Developers の「検証」ボタンは `events: []` の webhook を送る → 署名が正しければ `200` を返し、何もしない（Task 6 にテスト）。
2. 同じイベントの再送（`deliveryContext.isRedelivery: true`、同じ `webhookEventId`）が、処理済みの後に届く → OpenAI もノートも二重にならない（Task 5 にテスト）。
3. グループやトークルームからのメッセージ（`source.type` が `group` / `room`）→ 結びつけにも添削にも使わず、何も返さない（Task 3 と Task 5 にテスト）。
4. 連携コードを小文字・全角・前後に空白つきで送る → NFKC で正規化し、大文字にしてから照合する（Task 5 にテスト）。
5. ちょうど 500 文字の文（絵文字を含む）→ 添削に進む。501 文字 → 上限のお知らせ。バイト数ではなく rune で数える（Task 3 にテスト）。

---

## ファイルの構成

| ファイル                                                                                                                                                                                                                                         | 役割                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `prisma/schema.prisma`、`prisma/migrations/20261023090000_add_line_link/migration.sql`                                                                                                                                                           | 3 つの表                                         |
| `services/api/store/line.go`（+ `_test.go`）                                                                                                                                                                                                     | LINE の表の読み書き                              |
| `services/api/store/entries.go`                                                                                                                                                                                                                  | バッチ作成の中身を `queueImportBatch` に切り出す |
| `services/api/learning/openai.go`、`schema.go`（+ `_test.go`）                                                                                                                                                                                   | OpenAI の呼び出しと返事の確かめ                  |
| `services/api/line/signature.go`、`webhook.go`、`classify.go`、`client.go`、`format.go`（+ `_test.go`）                                                                                                                                          | LINE とのやり取りと文の整形                      |
| `services/api/linebot/service.go`、`code.go`、`drain.go`（+ `_test.go`）                                                                                                                                                                         | 結びつけ・処理・拾い直しの流れ                   |
| `services/api/httpapi/line_handlers.go`（+ `_test.go`）、`router.go`                                                                                                                                                                             | ルート                                           |
| `services/api/config.go`、`main.go`、`vercel.json`                                                                                                                                                                                               | 設定と組み立て                                   |
| `src/infrastructure/go-api/account-gateway.ts`、`src/presentation/actions/line-link-actions.ts`、`src/presentation/components/account/line-link-panel.tsx`、`src/app/account/line/page.tsx`、`src/presentation/components/layout/app-header.tsx` | Web                                              |
| `tests/go-api-account-gateway.test.ts`、`e2e/line.spec.ts`                                                                                                                                                                                       | Web のテスト                                     |
| `README.md`、`.env.example`、`docs/api-deployment.md`、`docs-site/`                                                                                                                                                                              | ドキュメント                                     |

DB のテストを手元で動かすとき：`pnpm run api:db` のあと、`source scripts/api-local-env.sh && cd services/api && API_TEST_DATABASE_URL="$DATABASE_URL" go test ./store/...`。

---

### Task 1: LINE の表とストア

**Files:**

- Modify: `prisma/schema.prisma`、`services/api/store/entries.go:263-295`
- Create: `prisma/migrations/20261023090000_add_line_link/migration.sql`、`services/api/store/line.go`
- Test: `services/api/store/line_test.go`

**Interfaces:**

- Produces（`store` パッケージ）:
  - `type LineLink struct { LineUserID, OwnerID, Role string; CreatedAt time.Time }`
  - `type LineMessage struct { ID, WebhookEventID, LineUserID, OwnerID, Kind, Text, Status string; Attempts int; EntryID *string; CreatedAt, UpdatedAt time.Time }`（`Text` は消したあと `""`）
  - `const LineStatusPending, LineStatusDone, LineStatusFailed = "pending", "done", "failed"`
  - `func (s *Store) FindLineLink(ctx, lineUserID string) (LineLink, error)`（無ければ `ErrNotFound`）
  - `func (s *Store) LineLinked(ctx, ownerID string) (bool, error)`
  - `func (s *Store) DeleteLineLinkByOwner(ctx, ownerID string) error`
  - `func (s *Store) DeleteLineLink(ctx, lineUserID string) error`
  - `func (s *Store) PutLineLinkCode(ctx, ownerID, role, codeHash string, expiresAt time.Time) error`（`ownerId` で上書き）
  - `func (s *Store) RedeemLineLinkCode(ctx, codeHash, lineUserID string, now time.Time) (link LineLink, relinked bool, err error)`（1 トランザクション。期限切れ・無しは `ErrNotFound`。`relinked` はこの LINE が既に結びついていたとき true）
  - `func (s *Store) InsertLineMessage(ctx, m LineMessage, now time.Time) (LineMessage, bool, error)`（`webhookEventId` が既にあれば既存の行と `false`）
  - `func (s *Store) StartLineMessageAttempt(ctx, id string, now time.Time) (LineMessage, error)`（`pending` かつ `attempts < 2` のときだけ `attempts+1` して返す。他は `ErrNotFound`）
  - `func (s *Store) CompleteLineMessage(ctx, id, ownerID string, draft EntryDraft, now time.Time) (Entry, error)`（1 トランザクションで「`LINE` バッチとノートの作成」と「`done`・`entryId`・`text=NULL`」）
  - `func (s *Store) FailLineMessage(ctx, id string, now time.Time) error`（`failed`・`text=NULL`）
  - `func (s *Store) ListStaleLineMessages(ctx, createdBefore time.Time, limit int) ([]LineMessage, error)`（`pending` を `createdAt` の古い順）
  - `func (s *Store) PruneLine(ctx, now time.Time) error`（`updatedAt` が 7 日より前の `done` / `failed` と、期限切れのコードを消す）

- [ ] **Step 1: スキーマとマイグレーションを書く。** モデル `LineLink`・`LineLinkCode`・`LineMessage` を仕様の 5 章どおりに足す。CHECK 制約（`role`・`kind`・`status`）と索引 `LineMessage(status, createdAt)` は SQL に手で書く（`20261021090000_add_sign_in_throttle` と同じやり方）。`pnpm exec prisma migrate dev --create-only` は使わず、SQL を直接置く。
- [ ] **Step 2: `pnpm run api:db` でローカルの DB に適用し、`pnpm exec prisma validate` が通ることを確かめる。**
- [ ] **Step 3: 失敗するテストを書く**（`line_test.go`、すべて `testStore(t)` を使う）
  - `TestRedeemLineLinkCode`：コードを入れ、`RedeemLineLinkCode` が `LineLink{OwnerID: owner, Role: "member"}` と `relinked == false` を返し、コードが消えている。
  - `TestRedeemLineLinkCodeExpired`：`expiresAt` が `now` より前なら `ErrNotFound`、リンクは作られない。
  - `TestRedeemLineLinkCodeMovesLinks`：owner A が LINE x と結びついている状態で、owner A の新しいコードを LINE y が使う → x のリンクは消え、y が A に結びつく。LINE y が owner B に結びついていた場合は `relinked == true` で B のリンクは消える。
  - `TestPutLineLinkCodeReplaces`：同じ owner で 2 回入れると、1 回目のハッシュは `ErrNotFound`。
  - `TestInsertLineMessageOnce`：同じ `WebhookEventID` で 2 回入れると、2 回目は `false` と 1 回目の行。
  - `TestStartLineMessageAttemptStopsAtTwo`：3 回目は `ErrNotFound`。`done` の行も `ErrNotFound`。
  - `TestCompleteLineMessage`：ノートが `kind`・本文・ヒントつきで作られ、`ImportBatch.fileName == "LINE"`、行は `done`・`entryId` あり・`text` が空。
  - `TestPruneLine`：8 日前の `done` と期限切れのコードは消え、6 日前の `done` と `pending` は残る。
- [ ] **Step 4: テストが失敗することを確かめる。** 実行：`API_TEST_DATABASE_URL=... go test ./store/ -run Line`。期待：コンパイルエラー（未定義）。
- [ ] **Step 5: 実装する。** `CreateImportBatch` の中身を `queueImportBatch(b *pgx.Batch, ownerID, fileName string, drafts []EntryDraft, now time.Time) (Batch, []Entry)` に切り出し、`CreateImportBatch` と `CompleteLineMessage` の両方から使う。`StartLineMessageAttempt` は `UPDATE ... WHERE status='pending' AND attempts < 2 RETURNING ...` の 1 文。
- [ ] **Step 6: テストが通ることを確かめる。** 実行：`go test ./store/...`（`API_TEST_DATABASE_URL` つき）。期待：PASS。既存の `entries_test.go` も PASS。
- [ ] **Step 7: コミットする。** `feat(api): LINE の結びつけと処理待ちの表を足す`

### Task 2: 設定

**Files:**

- Modify: `services/api/config.go`
- Test: `services/api/config_test.go`

**Interfaces:**

- Produces（`Config` の項目）：`LineChannelSecret []byte`、`LineChannelAccessToken string`、`OpenAIAPIKey string`、`CronSecret []byte`、`OpenAIBaseURL string`（既定 `https://api.openai.com`）、`LineAPIBaseURL string`（既定 `https://api.line.me`）、`func (c Config) LineEnabled() bool`

- [ ] **Step 1: 失敗するテストを書く**
  - `TestLoadConfigLineAllOrNothing`：3 つのうち 1 つか 2 つだけだとエラー（メッセージに 3 つの名前を含み、値は含まない）。3 つ全部なら `LineEnabled() == true`、全部空なら `false`。
  - `TestLoadConfigBaseURLLoopbackOnly`：`OPENAI_API_BASE_URL=http://127.0.0.1:9999` は通る、`https://example.com` はエラー。`LINE_API_BASE_URL` も同じ。
  - `TestLoadConfigCronSecretOptional`：空なら `CronSecret == nil`。
- [ ] **Step 2: 失敗を確かめる。** 実行：`go test . -run LoadConfig`。期待：FAIL。
- [ ] **Step 3: 実装する。** `GITHUB_WEB_*` の数え方に合わせる。ループバックの判定は `url.Parse` のホスト名で行う。
- [ ] **Step 4: 通ることを確かめる。** 実行：`go test .`。期待：PASS。
- [ ] **Step 5: コミットする。** `feat(api): LINE と OpenAI の設定を読む`

### Task 3: LINE とのやり取り（署名・webhook・振り分け・送信・整形）

**Files:**

- Create: `services/api/line/signature.go`、`webhook.go`、`classify.go`、`client.go`、`format.go`
- Test: 同名の `_test.go`

**Interfaces:**

- Consumes：`learning.Result`（Task 4。`Text, Pinyin string; Hints []string`）。Task 4 より先に作るときは、`format.go` は `learning` を import せず `Result` と同じ形の引数を受ける。
- Produces（`line` パッケージ）:
  - `func VerifySignature(secret, body []byte, signature string) bool`（HMAC-SHA256 の Base64、`hmac.Equal`）
  - `type Event struct { WebhookEventID, ReplyToken, UserID, Text string; IsText, FromUser bool }`
  - `func ParseWebhook(body []byte) ([]Event, error)`（`type == "message"` のイベントだけ返す。`FromUser` は `source.type == "user"`）
  - `type Route int` と `RouteCorrection`・`RouteTranslation`・`RouteTooLong`・`RouteUnsupported`、`const MaxTextRunes = 500`、`func Classify(text string) Route`
  - `type Client struct { HTTP *http.Client; BaseURL, AccessToken string }`、`func (c *Client) Reply(ctx, replyToken string, texts ...string) error`、`func (c *Client) Push(ctx, to string, texts ...string) error`（`POST /v2/bot/message/reply`・`/push`、`Authorization: Bearer`）
  - `func FormatResult(kind, original, text, pinyin string, hints []string) string`、`func FormatFailure(kind, code string) string`、文言の定数 `MsgLinked`・`MsgRelinked`・`MsgBadCode`・`MsgThrottled`・`MsgNotLinked`・`MsgLinkGone`・`MsgTooLong`・`MsgUsage`・`MsgSlow`

- [ ] **Step 1: 失敗するテストを書く**
  - 署名：正しい・1 バイト違う本文・空のヘッダー。
  - `ParseWebhook`：`events: []` は空のスライスで `nil` エラー。グループのメッセージは `FromUser == false`。スタンプは `IsText == false`。壊れた JSON はエラー。
  - `Classify`：`"我喜欢学习"` → 添削、`"今日は雨"` → 翻訳、`"カタカナ"` → 翻訳、`"hello"` → `RouteUnsupported`、絵文字を含む 500 rune の漢字の文 → 添削、501 rune → `RouteTooLong`。
  - `Client`：`httptest` で、`Reply` が `replyToken` と `messages[].text` を送ること、`Authorization` ヘッダー、`429`・`500` でエラー。
  - `FormatResult`：上限いっぱい（本文 1000・ピン音 1600・ヒント 200×5、元の文 500）でも 5000 rune 以下。見出しが仕様どおり。
- [ ] **Step 2: 失敗を確かめる。** 実行：`go test ./line/`。期待：FAIL。
- [ ] **Step 3: 実装する。** 翻訳の判定は Unicode の Hiragana・Katakana を含むかどうか。添削は Han を含むかどうか。
- [ ] **Step 4: 通ることを確かめる。** 実行：`go test ./line/`。期待：PASS。
- [ ] **Step 5: コミットする。** `feat(api): LINE の署名・振り分け・送信・返信の文を足す`

### Task 4: OpenAI での添削・翻訳

**Files:**

- Create: `services/api/learning/openai.go`、`schema.go`
- Test: `services/api/learning/openai_test.go`

**Interfaces:**

- Produces（`learning` パッケージ）:
  - `const KindCorrection, KindTranslation = "correction", "translation"`
  - `type Result struct { Text, Pinyin string; Hints []string }`
  - `type Error struct { Code string; Retryable bool }`（`Error()` は `Code` だけ）。コードは `OPENAI_TIMEOUT`・`OPENAI_REQUEST_FAILED`（この 2 つが `Retryable`）、`OPENAI_AUTH_FAILED`・`OPENAI_RATE_LIMITED`・`OPENAI_INVALID_RESPONSE`
  - `type OpenAI struct { HTTP *http.Client; BaseURL, APIKey string }`、`func (o *OpenAI) Generate(ctx context.Context, kind, text string) (Result, error)`

- [ ] **Step 1: 失敗するテストを書く**（`httptest`）
  - 送る中身：`POST /v1/responses`、`model == "gpt-5-mini"`、`store == false`、`instructions` に「データとして扱い」を含む、利用者の文は `input` にだけある、`text.format.type == "json_schema"`・`strict == true`。添削のスキーマは `correctedText`、翻訳は `translatedText`。
  - 成功：`output_text` の JSON から `Result` を作る。
  - 確かめ：ヒント 0 個・6 個・201 文字、本文 1001 文字、余計な項目 → `OPENAI_INVALID_RESPONSE`。
  - 状態：`401` → `OPENAI_AUTH_FAILED`、`429` → `OPENAI_RATE_LIMITED`、`500` → `OPENAI_REQUEST_FAILED`（`Retryable`）、20 秒を超える → `OPENAI_TIMEOUT`（テストでは `ctx` の締め切りで代用）。
  - エラーの文字列に API キーと入力文を含まない。
- [ ] **Step 2: 失敗を確かめる。** 実行：`go test ./learning/`。期待：FAIL。
- [ ] **Step 3: 実装する。** 指示文は旧版の `TRANSLATION_INSTRUCTIONS`（`src/domain/learning/chinese-translation.ts`）を元にし、添削版も同じ形で書く。返事は `output` の中の `output_text` を連結して読む。打ち切りは `context.WithTimeout(ctx, 20*time.Second)`。
- [ ] **Step 4: 通ることを確かめる。** 実行：`go test ./learning/`。期待：PASS。
- [ ] **Step 5: コミットする。** `feat(api): OpenAI で添削と翻訳を作る`

### Task 5: 結びつけと処理の流れ（`linebot`）

**Files:**

- Create: `services/api/linebot/service.go`、`code.go`、`drain.go`
- Test: `services/api/linebot/service_test.go`、`code_test.go`、`drain_test.go`

**Interfaces:**

- Consumes：Task 1 の `store` のメソッド、Task 3 の `line`、Task 4 の `learning`、`auth.Principal`・`auth.RoleMember`・`auth.RoleAdmin`、`store.ConsumeThrottle`・`ResetThrottle`
- Produces（`linebot` パッケージ）:
  - `type Store interface`（Task 1 のメソッドと `ConsumeThrottle`・`ResetThrottle`）
  - `type Generator interface { Generate(ctx context.Context, kind, text string) (learning.Result, error) }`
  - `type Messenger interface { Reply(ctx context.Context, token string, texts ...string) error; Push(ctx context.Context, to string, texts ...string) error }`
  - `type OwnerCheck func(ctx context.Context, ownerID, role string) (bool, error)`（main で `Allowlist.Allows` と `MemberExists` から作る）
  - `type Service struct { Store Store; Generator Generator; Messenger Messenger; OwnerValid OwnerCheck; Now func() time.Time; Logger *slog.Logger; Random io.Reader }`
  - `func (s *Service) HandleEvent(ctx context.Context, ev line.Event) error`
  - `func (s *Service) IssueCode(ctx context.Context, p auth.Principal) (code string, expiresAt time.Time, err error)`（ゲストは `auth.ErrForbidden`）
  - `func (s *Service) Linked(ctx context.Context, ownerID string) (bool, error)`、`func (s *Service) Unlink(ctx context.Context, ownerID string) error`
  - `func (s *Service) Drain(ctx context.Context, deadline time.Time) error`

- [ ] **Step 1: 失敗するテストを書く**（store・generator・messenger は偽物）
  - `IssueCode`：8 文字で文字の集合が仕様どおり、`expiresAt == now+10m`、store に入るのはハッシュ。ゲストは `ErrForbidden`。
  - 結びつけ：結びついていない LINE が `" abcd2345 "` や全角の `"ＡＢＣＤ２３４５"` を送る → 正規化して照合し、`MsgLinked` を reply。期限切れ → `MsgBadCode` と throttle を 1 消費。6 回目 → `MsgThrottled` で store を照合しない。成功で throttle を戻す。結びついた LINE がコードを送る → `MsgRelinked`。
  - 結びついていない LINE の普通の文 → `MsgNotLinked`、generator は呼ばれない。
  - `FromUser == false`（グループ・トークルーム）→ 結びつき済みでも何もしない（reply も store も呼ばない）。
  - 結びつき済みの人の `IsText == false`（スタンプなど）→ `MsgUsage` を reply、generator は呼ばれない。
  - 持ち主が無効（`OwnerValid` が false）→ リンクを消して `MsgLinkGone`、generator は呼ばれない。
  - 成功：`InsertLineMessage` → `StartLineMessageAttempt` → `Generate(kind, text)` → `CompleteLineMessage`（draft の `Kind`・`OriginalText`・`CorrectedText` が仕様の 7.2 どおり）→ `FormatResult` を reply。
  - 再送：`InsertLineMessage` が `false` を返す → generator も reply も呼ばれない。
  - `Retryable` の失敗 → 行は `pending` のまま、`MsgSlow` を reply。そうでない失敗 → `FailLineMessage` と `FormatFailure(kind, code)` を reply。
  - 501 文字 → `MsgTooLong`、行は作らない。
  - `Drain`：`ListStaleLineMessages(now-5m, …)` の行ごとに `StartLineMessageAttempt` → 成功で `Push(FormatResult)`、失敗（`Retryable` でも）で `FailLineMessage` と `Push(FormatFailure)`。`deadline` を過ぎたら新しい行を始めない。最後に `PruneLine`。
  - ログに本文・LINE のユーザー ID・コードが出ない（`slog` を `bytes.Buffer` に向けて確かめる）。
- [ ] **Step 2: 失敗を確かめる。** 実行：`go test ./linebot/`。期待：FAIL。
- [ ] **Step 3: 実装する。** コードの正規化は `golang.org/x/text/unicode/norm` の NFKC → `strings.TrimSpace` → `strings.ToUpper`（`golang.org/x/text` は今 `go.mod` で indirect なので、直接の依存に上げる）。ハッシュは `sha256` の 16 進。
- [ ] **Step 4: 通ることを確かめる。** 実行：`go test ./linebot/`。期待：PASS。
- [ ] **Step 5: コミットする。** `feat(api): LINE の結びつけと添削・翻訳の流れを足す`

### Task 6: ルートと組み立て

**Files:**

- Create: `services/api/httpapi/line_handlers.go`
- Modify: `services/api/httpapi/router.go`、`services/api/main.go`、`services/api/vercel.json`
- Test: `services/api/httpapi/line_handlers_test.go`、`router_test.go`、`services/api/main_test.go`（あれば）

**Interfaces:**

- Consumes：Task 5 の `linebot.Service`、Task 3 の `line.VerifySignature`・`line.ParseWebhook`
- Produces：`httpapi.Deps` に `Line LineService`（nil なら LINE のルートを登録しない）、`LineChannelSecret []byte`、`CronSecret []byte`。`type LineService interface { HandleEvent; IssueCode; Linked; Unlink; Drain }`（Task 5 の署名どおり）
- Produces（HTTP）：`POST /v1/line/webhook`（公開）、`GET /v1/line/link` → `{"linked":bool}`、`POST /v1/line/link-code` → `{"code":string,"expiresAt":RFC3339}`、`DELETE /v1/line/link` → `204`（3 つとも `authed`。ゲストは `403`）、`GET /v1/line/drain`（公開、`Authorization: Bearer <CRON_SECRET>`）

- [ ] **Step 1: 失敗するテストを書く**
  - webhook：署名なし・違う → `401`、service は呼ばれない。`{"destination":"x","events":[]}` に正しい署名 → `200`。イベント 2 つ → `HandleEvent` が 2 回。`HandleEvent` がエラーでも `200`（LINE に再送させない）。
  - リンクの 3 ルート：会員・管理者は通る、ゲストは `403`、未ログインは `401`。`link-code` の応答に `code` と `expiresAt`。結びついていないときの `DELETE /v1/line/link` も `204`。
  - drain：`CRON_SECRET` が空 → `401`、違う → `401`、正しい → `Drain` を呼び `204`。
  - `Line == nil` のとき 5 ルートとも `404`。
  - `router_test.go` のルート表のテストに 5 ルートを足す（`authed` の印も）。
- [ ] **Step 2: 失敗を確かめる。** 実行：`go test ./httpapi/`。期待：FAIL。
- [ ] **Step 3: 実装する。**
  - webhook と drain は、`importCSV` と同じく `http.NewResponseController` で書き込みの締め切りを 60 秒に延ばす（サーバー全体の `WriteTimeout` は 30 秒）。drain に渡す `deadline` は開始から 50 秒。
  - webhook は本文を `io.ReadAll` してから署名を確かめる（本文の上限は既存の `limitBody` の 1 MiB）。
  - `CRON_SECRET` は `subtle.ConstantTimeCompare`。
  - `main.go`：`cfg.LineEnabled()` のときだけ `linebot.Service` を作る。`OwnerValid` は `RoleAdmin` なら `Allowlist.Allows(ownerID)`、`RoleMember` なら `db.MemberExists`。OpenAI と LINE の `http.Client` はリダイレクトを追わない（`newGitHubHTTPClient` と同じ）。
  - `vercel.json`：`"functions"` で最大実行時間 60 秒、`"crons": [{ "path": "/v1/line/drain", "schedule": "0 21 * * *" }]`（日本時間の朝 6 時）。
- [ ] **Step 4: 通ることを確かめる。** 実行：`cd services/api && go vet ./... && go test -race ./...`。期待：PASS。
- [ ] **Step 5: 手元で起動を確かめる。** `pnpm run api:dev` が LINE の値なしで起動し、`curl -i -X POST http://127.0.0.1:8081/v1/line/webhook` が `404` を返す。
- [ ] **Step 6: コミットする。** `feat(api): LINE の webhook・連携・拾い直しのルートを足す`

### Task 7: Web の「LINE 連携」画面

**Files:**

- Modify: `src/infrastructure/go-api/account-gateway.ts`、`src/presentation/components/layout/app-header.tsx:67-81`、`.env.example`
- Create: `src/presentation/actions/line-link-actions.ts`、`src/presentation/components/account/line-link-panel.tsx`、`src/app/account/line/page.tsx`、`e2e/line.spec.ts`
- Test: `tests/go-api-account-gateway.test.ts`

**Interfaces:**

- Consumes：Task 6 の 3 つのリンクのルート
- Produces：`createAccountGateway()` に `getLineLink(): Promise<{ linked: boolean }>`、`issueLineLinkCode(): Promise<{ code: string; expiresAt: Date }>`、`unlinkLine(): Promise<void>`。Server Action `issueLineLinkCodeAction(prev, formData): Promise<LineLinkState>`・`unlinkLineAction(): Promise<void>`、`type LineLinkState = { status: "idle" } | { status: "issued"; code: string; expiresAt: string } | { status: "error"; message: string }`

- [ ] **Step 1: 失敗するテストを書く**（`tests/go-api-account-gateway.test.ts`、既存の `fakeCall` を使う）
  - `getLineLink` が `GET /v1/line/link` を呼び、`{ linked: true }` を返す。
  - `issueLineLinkCode` が `POST /v1/line/link-code` を呼び、`expiresAt` を `Date` にする。
  - `unlinkLine` が `DELETE /v1/line/link` を呼ぶ。
- [ ] **Step 2: 失敗を確かめる。** 実行：`node --import tsx --test tests/go-api-account-gateway.test.ts`（`scripts/test-unit.mjs` と同じ起動のしかた）。期待：FAIL。
- [ ] **Step 3: 実装する。**
  - ゲートウェイの 3 つのメソッド。
  - 画面 `/account/line`：`getCurrentViewerUser()` が null かゲストなら `redirect("/")`。作りは `/account/password` に合わせる。表示は仕様の 6.3。`LINE_ADD_FRIEND_URL` は `https://` で始まるときだけリンクを出す。OpenAI に送られることの説明文を必ず出す。
  - パネルは `useActionState` で発行、残り時間は `expiresAt` から表示する（秒単位の更新は要らない。「◯時◯分まで有効」でよい）。解除はフォームの送信で、終わったら `revalidatePath("/account/line")`。
  - ヘッダー：`isMember || isAdmin` のとき `NavLink href="/account/line"`、アイコン `MessageCircle`、文言「LINE 連携」。
  - `.env.example` に `LINE_ADD_FRIEND_URL` を説明つきで足す。
- [ ] **Step 4: 通ることを確かめる。** 実行：`pnpm run typecheck && pnpm run lint && pnpm run test:unit`。期待：PASS。
- [ ] **Step 5: E2E を書いて通す。** `e2e/line.spec.ts`：会員で `/account/line` を開き「連携コードを出す」→ 8 文字のコードが出る。ゲストではヘッダーに「LINE 連携」が無く、`/account/line` は `/` に移る。E2E の Go API は LINE の値なしで動くので、`/v1/line/link-code` が `404` になる場合は、`e2e/server.ts` で LINE の 3 つにループバック向けのダミー値（`LINE_API_BASE_URL`・`OPENAI_API_BASE_URL` も `http://127.0.0.1:9`）を渡す。実行：`pnpm run test:e2e -- e2e/line.spec.ts`。期待：PASS。
- [ ] **Step 6: コミットする。** `feat(web): アカウント画面に LINE 連携を足す`

### Task 8: ドキュメント

**Files:**

- Modify: `README.md`、`docs/api-deployment.md`、`docs/api-local.md`、`docs-site/`（Go API の環境変数とルートの一覧があるページ）、`.env.example`（Go API の欄）

- [ ] **Step 1: 書く。**
  - `docs/api-deployment.md`：3 章の表に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`CRON_SECRET`、6 章に Web の `LINE_ADD_FRIEND_URL`。仕様の 11 章の切り替えの手順（Webhook URL、応答メッセージをオフ、マイグレーションを先に、Go API の Git 自動デプロイが切れている注意）。
  - `docs/api-local.md`：LINE はローカルでは使えず、`/v1/line/*` は `404` になること。
  - `docs-site/`：新しいルート 5 つ。
  - `README.md`：機能の一覧に LINE 連携。
- [ ] **Step 2: 確かめる。** 実行：`pnpm run format:check`。期待：PASS。
- [ ] **Step 3: コミットする。** `docs: LINE 連携の設定と切り替えの手順を書く`

### 最後の確かめ

- [ ] `pnpm run test:regression` が通る（DB の Go テストは `API_TEST_DATABASE_URL` つきで別に実行して PASS）。
- [ ] 本番に出す前に、仕様の 11 章の手順をユーザーと一緒に行う（マイグレーションは main へのマージ前に本番の Neon へ）。
