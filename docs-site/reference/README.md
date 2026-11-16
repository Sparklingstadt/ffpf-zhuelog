# エンドポイント

すべてのルートの一覧と、各ページに共通する決まりです。ルートの定義は `services/api/httpapi/router.go` にあります。

## 一覧

権限の列：「公開」は認証不要（LINE のルートは、括弧の中の別の方法で確かめます。LINE の設定が無いときは `/v1/line/*` の 7 つが `404`）、「全員」は admin と会員（ゲストは `403`。`GET /v1/me` だけ「ゲストも」）、「会員」「admin」はその役割だけ（それ以外は `403`）。

| メソッド | パス                                                                                | 権限                  | 成功 | 内容                                               |
| -------- | ----------------------------------------------------------------------------------- | --------------------- | ---- | -------------------------------------------------- |
| POST     | [`/v1/auth/github`](./auth.md#post-v1-auth-github)                                  | 公開                  | 200  | GitHub ログイン                                    |
| POST     | [`/v1/auth/ffpf`](./auth.md#post-v1-auth-ffpf)                                      | 公開                  | 200  | FFPF ID ログイン                                   |
| POST     | [`/v1/auth/guest`](./auth.md#post-v1-auth-guest)                                    | 公開                  | 200  | ゲストログイン                                     |
| POST     | [`/v1/auth/password`](./auth.md#post-v1-auth-password)                              | 公開                  | 200  | パスワードログイン                                 |
| POST     | [`/v1/auth/refresh`](./auth.md#post-v1-auth-refresh)                                | 公開                  | 200  | トークンのローテーション                           |
| POST     | [`/v1/auth/logout`](./auth.md#post-v1-auth-logout)                                  | 公開                  | 204  | ログアウト                                         |
| GET      | [`/v1/me`](./auth.md#get-v1-me)                                                     | 全員（ゲストも）      | 200  | 自分の情報                                         |
| POST     | [`/v1/account/password`](./auth.md#post-v1-account-password)                        | 会員                  | 204  | 自分のパスワードの変更                             |
| GET      | [`/v1/members`](./follows.md#get-v1-members)                                        | 全員                  | 200  | 会員の一覧                                         |
| PUT      | [`/v1/follows/{ownerId}`](./follows.md#put-v1-follows-ownerid)                      | 全員                  | 204  | フォロー                                           |
| DELETE   | [`/v1/follows/{ownerId}`](./follows.md#delete-v1-follows-ownerid)                   | 全員                  | 204  | フォローをやめる                                   |
| GET      | [`/v1/timeline`](./follows.md#get-v1-timeline)                                      | 全員                  | 200  | タイムライン                                       |
| POST     | [`/v1/line/webhook`](./line.md#post-v1-line-webhook)                                | 公開（LINE の署名）   | 200  | LINE からの通知を受けて添削・翻訳                  |
| GET      | [`/v1/line/link`](./line.md#get-v1-line-link)                                       | 会員・admin           | 200  | LINE と連携しているか                              |
| POST     | [`/v1/line/link-code`](./line.md#post-v1-line-link-code)                            | 会員・admin           | 200  | LINE の連携コードを出す                            |
| DELETE   | [`/v1/line/link`](./line.md#delete-v1-line-link)                                    | 会員・admin           | 204  | LINE の連携を解除                                  |
| PUT      | [`/v1/line/review-notify`](./line.md#put-v1-line-review-notify)                     | 会員・admin           | 200  | 復習のお知らせを受け取る                           |
| DELETE   | [`/v1/line/review-notify`](./line.md#delete-v1-line-review-notify)                  | 会員・admin           | 200  | 復習のお知らせを止める                             |
| GET      | [`/v1/line/drain`](./line.md#get-v1-line-drain)                                     | 公開（`CRON_SECRET`） | 204  | 残ったメッセージの拾い直しと復習のお知らせ（Cron） |
| GET      | [`/v1/admin/accounts`](./admin.md#get-v1-admin-accounts)                            | admin                 | 200  | 会員の一覧（管理用）                               |
| POST     | [`/v1/admin/accounts`](./admin.md#post-v1-admin-accounts)                           | admin                 | 201  | 会員の作成                                         |
| POST     | [`/v1/admin/accounts/{id}/password`](./admin.md#post-v1-admin-accounts-id-password) | admin                 | 200  | 会員のパスワードのリセット                         |
| GET      | [`/health`](./health.md)                                                            | 公開                  | 200  | DB まで含めたヘルスチェック                        |
| GET      | [`/healthz`](./health.md)                                                           | 公開                  | 200  | `/health` と同じ（ローカル用）                     |
| GET      | [`/ping`](./health.md)                                                              | 公開                  | 200  | DB を見ない死活監視用                              |

## 共通の決まり

### リクエスト

- 認証が必要なルートには `Authorization: Bearer <accessToken>` を付けます。無い・形が違う（`Bearer` 以外、空、空白を含む）・無効なトークンは `401 unauthorized` です。詳しくは [認証](../guide/auth.md)。
- 本文は JSON です。本文は **ちょうど 1 つの JSON オブジェクト** でなければなりません。`null` や配列、オブジェクトの後ろの余計なデータ、**未知のフィールド**、文字列の項目への `null` は `400 invalid_request` です。
- 本文の上限は 1 MiB で、超えると `413 too_large` です。
- 文字数は、特に断りがなければ Unicode のコードポイント（Go の rune）で数えます。会員のアカウントの項目（新しいパスワード・表示名）は、Web（zod）と同じく UTF-16 の単位（JavaScript の `length`）で数えます。絵文字など U+10000 以上の文字は 2 と数えます。前後の空白を除くと書いてある項目は、除いた後の値で判定し、除いた後の値を保存します。

### レスポンス

- 本文は JSON（`Content-Type: application/json; charset=utf-8`）で、すべての応答に `Cache-Control: no-store` が付きます。
- `204` の応答には本文がありません。
- 時刻は UTC の ISO 8601 で、ミリ秒まで書きます（例：`2026-10-20T03:04:05.678Z`）。
- エラーは常に `{"error": {"code": "…", "message": "…"}}` の形です。`message` は利用者にそのまま見せられる日本語です。[エラー](../errors.md) を参照してください。
- 存在しないパスは `404 not_found`、パスはあるがメソッドが違うときは `405 method_not_allowed`（`Allow` ヘッダつき）です。

### 所有者

- 読み書きはすべて、トークンの `sub`（`ownerId`）で絞り込みます。**他人のノートは存在しないのと同じ `404`** です。
- 認証つきのルートは、`?user=` が **付いているだけで** `400 invalid_request` です（無視されたと誤解しないようにするため）。admin が会員のノートを読むのは Web だけです。

### ノートの形

タイムラインなど、ノートを返すところはすべてこの形です。

```json
{
  "id": "cmh0x5k2p0000abcd1234efgh",
  "kind": "correction",
  "originalText": "我昨天去了学校。",
  "correctedText": "我昨天去学校了。",
  "pinyin": "Wǒ zuótiān qù xuéxiào le.",
  "hints": [
    { "id": "cmh0x5k2p0001abcd1234efgh", "content": "了の位置", "position": 0 }
  ],
  "createdAt": "2026-10-20T03:04:05.678Z",
  "sharedAt": null
}
```

| フィールド      | 型             | 内容                                                   |
| --------------- | -------------- | ------------------------------------------------------ |
| `id`            | string         | ノートの ID（cuid）                                    |
| `kind`          | string         | `correction`（添削）か `translation`（翻訳）           |
| `originalText`  | string         | 最初の文                                               |
| `correctedText` | string         | 添削後の文                                             |
| `pinyin`        | string         | ピン音                                                 |
| `hints`         | array          | ヒント。`position` の順（0 から）に並ぶ。無ければ `[]` |
| `createdAt`     | string         | 作成時刻                                               |
| `sharedAt`      | string \| null | 共有を始めた時刻。共有していなければ `null`            |

### 一覧の続きの取得

`GET /v1/timeline` はカーソル方式でページングします。

| クエリ   | 内容                                                          |
| -------- | ------------------------------------------------------------- |
| `limit`  | 1 ページの件数。既定 50、1〜100 の 10 進の整数                |
| `cursor` | 前のページの応答の `nextCursor`。省略するか空なら最初のページ |

- 応答の `nextCursor` は、続きがあれば次のページのカーソル、無ければ `null` です。
- カーソルは最後の要素の `(並びの時刻, id)` を base64url にしたものですが、中身に依存せず、そのまま渡してください。
- `limit` や `cursor` が不正なとき、同じキーを 2 回以上付けたときは `400 invalid_request` です。
