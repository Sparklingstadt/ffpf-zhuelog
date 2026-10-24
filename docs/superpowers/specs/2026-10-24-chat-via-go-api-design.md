# ChatGPT との会話練習（/chat）を Go API で作り直す

- 作成日: 2026-10-24
- 状態: 設計合意済み（この仕様書のレビュー待ち）

## 1. 目的

管理者が Web の `/chat` で ChatGPT（OpenAI の API）と中国語の会話練習をし、その会話を会話ノート（`/conversations`）で見返せるようにする。

以前は Next.js の中にこの仕組みがあった（`2026-10-01-chat-history-design.md`）が、#66 で削除し、#71 で `ChatConversation` の表も消した。その後、Web はフロントエンドだけになり、データの読み書きはすべて Go API が受け持つようになった（`2026-10-22-web-data-via-go-api-design.md`）。今回は LINE（`2026-10-23-line-via-go-api-design.md`）と同じく、Go API（`services/api`）の上に作り直す。

成功の条件は次のとおり。

1. 管理者が `/chat` で送った文に、ChatGPT の回答が少しずつ（ストリーミングで）表示される。
2. 回答が届くたびに会話が保存され、`/conversations` で日付ごとに見返せる。
3. 保存した会話の続きを `/chat` で話せる。会話ノートから会話を削除できる。
4. 会員とゲストは、画面にも API にも届かない（入口は出ず、`/chat`・`/conversations` は 404、API は 403）。

## 2. 決定事項

| 項目           | 決定                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 使う人         | 管理者だけ。会員とゲストは使えない                                                                                                               |
| 有効にする条件 | Go に `OPENAI_API_KEY` があるとき。`CHAT_ENABLED` のスイッチは置かない                                                                           |
| 置き場所       | OpenAI の呼び出しと会話の保存は Go API。Web は画面と、Go への中継だけ                                                                            |
| 生成           | OpenAI Responses API、`stream: true`、`store: false`、推論は `medium`、`max_output_tokens` 1600。システムプロンプトは以前の文面                  |
| モデル         | `OPENAI_CHAT_MODEL`。無ければ以前の既定の `gpt-6.1-sol`                                                                                          |
| 返し方         | Go は 1 行 1 つの JSON（`application/x-ndjson`）で少しずつ流し、最後に終わりの印を送る（5.3）。Web の `/api/chat` はそれをそのままブラウザへ流す |
| 保存           | 回答を最後まで受け取るたびに、ブラウザが会話をまるごと `PUT` する。保存ボタンと localStorage の控えは無くす                                      |
| 削除           | 確認してから消す。ゴミ箱は無い                                                                                                                   |
| AI SDK         | 戻さない。ブラウザは `fetch` の本文を読んで文字を足していく                                                                                      |

保存を自動にした理由：以前は保存ボタンを押した会話だけが残った。使うのは管理者だけで保存の負担は小さく、押し忘れで会話がなくなるほうが困るため。

## 3. 対象外

- ゴミ箱、Markdown のダウンロード、ローカルの Codex のモード
- 会員への開放、送信回数の上限
- 管理者が他の人の会話を見ること（`?user=`）
- 回答の Markdown の表示（以前と同じく改行だけ生かす）
- モバイルアプリの画面

## 4. 処理の流れ

```text
ブラウザ（/chat）
  │ POST /api/chat {messages}          （同じオリジンだけ）
  ▼
Web の Route Handler（src/app/api/chat/route.ts）
  │ POST /v1/chat {messages}           （zl_access のトークンを Authorization に付ける）
  ▼
Go API
  1. トークンを確かめ、admin でなければ 403
  2. 入力を確かめる（5 章）。だめなら 400
  3. OpenAI Responses API を stream: true で呼ぶ
  4. response.output_text.delta の文字を、届くたびに {"type":"delta","text":…} の 1 行として書いて Flush する
  5. 最後まで届いたら {"type":"done"} を書いて閉じる
  6. 失敗・時間切れ → まだ何も書いていなければ 502 と JSON のエラー。
     書き始めた後なら {"type":"error","message":…} を書いて閉じる
     （done が無いまま終わったときも、ブラウザは途中で切れたものとして扱う）
  │
  ▼ 文字が少しずつ届く
ブラウザ：回答を最後まで受け取ったら PUT /v1/conversations/{id}（Web のゲートウェイ経由）
```

- ブラウザが止める（停止ボタン・画面を離れる）と、Web から Go、Go から OpenAI への接続が切れ、生成も止まる（`request.Context()` で打ち切る）。
- 時間の上限：OpenAI への 1 回の呼び出しは 60 秒で打ち切る。Vercel の関数の最大実行時間は Fluid compute の既定（300 秒）で足りる。
- **最初に確かめること**：Vercel の Go 関数で、`Flush` した文字が少しずつ届くか（まとめて届かないか）をプレビューのデプロイで確かめる。少しずつ届かないときは、実装を進める前に利用者と方針を相談する。

## 5. Go API

### 5.1 ルート

| ルート                          | 内容                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/chat`                 | 会話の続きを生成して流す                                                                                                                                                       |
| `GET /v1/conversations`         | `{"chatModel":"…","conversations":[…]}`。`chatModel` は `/v1/chat` が使うモデル名、`conversations` は自分の会話の要約（`messages` 以外）を `createdAt` の新しい順に 100 件まで |
| `GET /v1/conversations/{id}`    | 自分の会話 1 件                                                                                                                                                                |
| `PUT /v1/conversations/{id}`    | 自分の会話をまるごと保存する（無ければ作る）                                                                                                                                   |
| `DELETE /v1/conversations/{id}` | 自分の会話を消す                                                                                                                                                               |

- 5 つとも admin だけ。それ以外の role は `403 forbidden`。
- `OPENAI_API_KEY` が無いときは、5 つとも登録しない（LINE のルートと同じやり方）。
- 他の人の会話の `id` は、無いものとして `404` にする。`PUT` で他の人の `id` を使ったときも `404`（上書きしない）。

### 5.2 入力の確かめ（以前と同じ上限）

`POST /v1/chat` の本文：`{"messages":[{"role":"user"|"assistant","text":"..."}]}`

- 本文は 256 KiB まで（超えたら `413 too_large`）
- `messages` は 1〜40 件、最後は `user`
- 各 `text` は空白だけでなく、合計 4 万字まで

`PUT /v1/conversations/{id}` の本文：

```json
{
  "title": "…",
  "modelName": "…",
  "ended": false,
  "createdAt": "2026-10-24T10:00:00.000Z",
  "messages": [{ "id": "…", "role": "user", "text": "…" }]
}
```

- `id`（パス）は UUID
- `title` は 1〜100 字、`modelName` は 1〜150 字
- `messages` は 1〜40 件、`id` は 1〜200 字で重ならない、`text` は上と同じ
- `createdAt` は ISO 8601。最初の保存の値を残し、後の `PUT` では変えない。`updatedAt` は Go が付ける

### 5.3 生成（`services/api/chat`）

- 新しいパッケージ `chat` に、システムプロンプト・入力の確かめ・OpenAI のストリーミングの呼び出しを置く。
- OpenAI の HTTP クライアント・`OPENAI_API_BASE_URL`・失敗のコード（`OPENAI_TIMEOUT` など）は `learning` と同じ考え方にする。共有できる部分は `learning` から切り出して使う。
- SSE のうち `response.output_text.delta` の文字だけを流す。`error`・`response.failed` が来たら失敗にする。
- 流す形（1 行に 1 つ、`\n` で区切る）：
  - `{"type":"delta","text":"…"}`：回答の続きの文字
  - `{"type":"done"}`：最後まで届いた。これが無いまま終わった応答は、途中で切れたものとして扱う
  - `{"type":"error","message":"ChatGPTから応答を受信できませんでした。"}`：書き始めた後の失敗
- システムプロンプト（以前の文面のまま）：

```text
あなたは中国語学習アプリ「学习録」の会話パートナーです。
ユーザーの中国語学習を支援してください。
- 原則として、ユーザーが使った言語に合わせて答える。
- 中国語の例文には、必要に応じてピン音と自然な日本語訳を添える。
- 間違いを直すときは、自然な修正文と短い理由を示す。
- 会話練習では細かい訂正で流れを止めすぎず、会話を続けてから要点を整理する。
- 確信がない内容を断定しない。
- 回答は学習しやすい長さにまとめる。
```

### 5.4 エラーの文言

| 場面                    | 状態 | 文言                                                |
| ----------------------- | ---- | --------------------------------------------------- |
| 入力の誤り              | 400  | 会話内容が上限を超えているか、形式が不正です。      |
| 大きすぎる              | 413  | 会話が大きすぎます。                                |
| admin でない            | 403  | 管理者だけが利用できます。（既存の `requireAdmin`） |
| 会話が無い              | 404  | 会話が見つかりません。                              |
| OpenAI の失敗・時間切れ | 502  | ChatGPTから応答を受信できませんでした。             |

### 5.5 設定

- `OPENAI_API_KEY` だけでも起動できるようにする。LINE は今までどおり `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY` の 3 つがそろったときだけ有効（LINE の 2 つだけがあって `OPENAI_API_KEY` が無いときは起動しない）。
- `OPENAI_CHAT_MODEL` を足す（任意）。

## 6. データ

`prisma/schema.prisma` に `ChatConversation` を作り直し、マイグレーション `20261024090000_add_chat_conversations` を足す。列と索引は以前と同じ。

| 列          | 型             | 内容                         |
| ----------- | -------------- | ---------------------------- |
| `id`        | `TEXT` PK      | ブラウザが作る UUID          |
| `ownerId`   | `TEXT`         | Go の持ち主の ID             |
| `title`     | `TEXT`         | 最初の発言から作る（80 字）  |
| `modelName` | `TEXT`         | 生成したモデル名             |
| `ended`     | `BOOLEAN`      | 上限に達して読むだけになった |
| `messages`  | `JSONB`        | `[{id, role, text}]`         |
| `createdAt` | `TIMESTAMP(3)` | 会話を始めた時刻             |
| `updatedAt` | `TIMESTAMP(3)` | 最後に保存した時刻           |

索引：`(id, ownerId)` の一意、`(ownerId, updatedAt)`、`(ownerId, createdAt)`。

Go の `store` に、持ち主で絞った読み書き（一覧・1 件・upsert・削除）を足す。upsert は `id` が同じで `ownerId` が違う行があれば何も変えずに「無い」を返す。

## 7. Web

### 7.1 中継とゲートウェイ

- `src/app/api/chat/route.ts`：同じオリジンかと `Content-Type: application/json` を確かめ、本文を 256 KiB まで読んで Go の `POST /v1/chat` に送り、Go の応答の本文と状態をそのまま返す（`Cache-Control: no-store`）。ブラウザが切ると Go への fetch も止める。トークンが無ければ `401`。
- `src/infrastructure/go-api/conversation-gateway.ts`：一覧・1 件・保存・削除。JSON を画面の型に直す（日時は `Date`）。エラーは今の `GoApiError` の扱いに合わせる。
- 保存と削除は Server Action（`src/presentation/actions/`）から呼ぶ。

### 7.2 `/chat`

- 管理者でなければ `notFound()`。Go に `OPENAI_API_KEY` が無い（`/v1/conversations` が 404）ときは「ChatGPT が設定されていません」と出す。
- 画面：発言の一覧、入力欄、送信・停止、「新しい会話」、モデル名。発言の見た目は以前の `ChatMessage`（改行を生かす）。
- `/chat?id=<id>` で保存済みの会話を読み込み、続きから話す。`ended` の会話は読むだけにし、「新しい会話」を案内する。
- 次の発言で 40 件か 4 万字を超えるときは送らず、`ended` にして保存し、「会話の上限に達しました。新しい会話を始めてください。」と出す。
- 回答を最後まで受け取ったら保存する。失敗したら「保存できませんでした。次の回答のときにもう一度保存します。」と出し、次の回答のあとに改めて保存する。
- 回答が途中で切れたときは、受け取ったところまでを表示し「応答が途中で切れました。」と出す。途中までの回答は保存しない（その発言は送り直せる）。
- 入口：ホームとヘッダーに「ChatGPT と話す」（管理者だけ）。

### 7.3 `/conversations`

- 管理者でなければ `notFound()`。
- `/conversations`：日付（日本時間の `createdAt`）ごとの件数。
- `/conversations/[year]/[month]/[day]`：その日の会話（タイトル・時刻・件数）。
- `/conversations/[year]/[month]/[day]/[number]`：会話の中身。「続きを話す」（`/chat?id=`）と「削除する」（確認のダイアログ）。
- 日付のまとめは `src/domain/calendar` を使い、Go の一覧（100 件）から Web で組み立てる。番号はその日の古い順に 1 から。

## 8. 安全策

- OpenAI の鍵は Go にだけ置く。Web には置かない。
- `store: false` で OpenAI に会話を残さない。
- 会話の読み書きは、Go が常にトークンの持ち主で絞る。
- `/api/chat` は同じオリジンの送信だけを受け付ける。
- ログに会話の中身を出さない（失敗のコードだけ）。

## 9. テスト

### 9.1 Go

- `chat`：入力の確かめ（件数・字数・最後の role・空白）、OpenAI の偽サーバーの SSE から文字だけを流すこと、`error` イベント・HTTP の失敗・時間切れ、送る中身（モデル・`stream`・`store: false`・システムプロンプト）。
- ハンドラ：admin 以外は 403、行ごとに Flush すること、最後に `done`、書く前の失敗は 502、書き始めた後の失敗は `error` の行、会話の CRUD（他の人の会話は 404、`PUT` で上書きしない、`createdAt` を変えない）、413。
- 設定：`OPENAI_API_KEY` だけで起動できる、LINE の 2 つだけでは起動しない、`OPENAI_API_KEY` が無いとルートが無い。
- store：DB を使うテスト（今の store のテストと同じやり方）。

### 9.2 Web の unit

- `/api/chat`：同じオリジンの確認、トークンの付け方、本文の上限、Go の状態と本文をそのまま返すこと。
- NDJSON の読み取り：行が chunk の途中で切れても組み立てられること、`done` が無いまま終わったら途中で切れた扱いにすること、`error` の行。
- ゲートウェイ：JSON から型への変換、エラーの文言。
- 日付のまとめと番号。

### 9.3 e2e

- OpenAI の偽サーバー（SSE を返す小さな HTTP サーバー）を e2e の起動で立て、Go の `OPENAI_API_BASE_URL` をそこに向ける（今はポート 9 を向けている。LINE の e2e は連携のルートだけを使い OpenAI を呼ばないので、向け先を変えても影響しない）。
- 管理者：送ると回答が表示される → `/conversations` に出る → 「続きを話す」で続けられる → 削除できる。
- 会員・ゲスト：ホームに入口が無い、`/chat`・`/conversations` が 404。

## 10. 本番に出す手順

1. マージの前に、本番の Neon にマイグレーションを当てる（利用者が `vercel env pull` と `prisma migrate deploy` を行う）。
2. マージの前に、Go API のプレビューのデプロイでストリーミングが少しずつ届くことを確かめる（4 章）。
3. マージの後に、Go API の Vercel プロジェクトへ main を手でデプロイする（Git の自動デプロイは切れている）。Web は main への push で自動でデプロイされる。
4. README・`.env.example`・`docs/api-deployment.md`・`docs-site/` に、`OPENAI_CHAT_MODEL` とチャットの有効にしかたを書く。
