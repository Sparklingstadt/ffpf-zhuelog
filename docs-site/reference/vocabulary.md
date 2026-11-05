# 単語帳

会員と admin が、添削ノートなどから選んだ語句を単語帳に入れ、復習するためのルートです。

- 使えるのは会員と admin です。ゲストは `403`（`forbidden`）です。
- 単語帳は、いつもトークンの持ち主のものです。管理者が会員として操作しているときは、その会員のものです。
- 単語を足すと、[復習](./reviews.md)の問題（`kind` は `vocabulary`、`targetId` は単語の `id`）にも入り、すぐ期日になります。単語を消すと、その復習の問題と回答の記録も消えます。
- 同じ人の単語帳に、同じ語句は 1 つだけです（言語ごと）。

### GET /v1/vocabulary

単語を新しい順に 1000 件まで返します。

- 権限：会員・admin

**レスポンス** `200`

```json
{
  "entries": [
    {
      "id": "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
      "language": "zh",
      "word": "认真",
      "pinyin": "rènzhēn",
      "meaning": "まじめに、真剣に",
      "sourceEntryId": "cabcdefghijklmnopqrstuvwx",
      "createdAt": "2026-11-05T12:00:00.000Z",
      "updatedAt": "2026-11-05T12:00:00.000Z"
    }
  ]
}
```

`sourceEntryId` は、語句を選んだ学習ノートの `id` です。ノートから選んでいなければ `null` です。ノートがあとでゴミ箱に入ったり消えたりしても、単語はそのまま残ります。

### PUT /v1/vocabulary/{id}

単語を足します。`id` はクライアントが作る UUID です。同じ `id` で送り直すと、ピン音と意味を書き換えます（語句と `sourceEntryId` は最初のまま、復習の予定も変わりません）。

- 権限：会員・admin

**リクエスト**

```json
{
  "word": "认真",
  "pinyin": "rènzhēn",
  "meaning": "まじめに、真剣に",
  "sourceEntryId": "cabcdefghijklmnopqrstuvwx"
}
```

| 項目            | 決まり                                                |
| --------------- | ----------------------------------------------------- |
| `word`          | 1〜20 字（前後の空白は除きます）                      |
| `pinyin`        | 0〜100 字                                             |
| `meaning`       | 1〜200 字                                             |
| `sourceEntryId` | 任意。学習ノートの `id`（英小文字と数字の 64 字まで） |     |

**レスポンス** `200`：保存した単語（`GET /v1/vocabulary` の 1 件と同じ形）。

形式が不正なら `400`、同じ語句がほかの `id` ですでにあれば `409`（`vocabulary_exists`）、ほかの人の `id` なら `404` です。

### DELETE /v1/vocabulary/{id}

単語と、その復習の問題を消します。元に戻せません。

- 権限：会員・admin

**レスポンス** `204`。見つからなければ `404` です。

### POST /v1/vocabulary/draft

語句のピン音と日本語の意味の下書きを、OpenAI（`gpt-5-mini`）で作ります。保存はしません。下書きを直して `PUT` で保存します。`OPENAI_API_KEY` が無い Go API では、このルートはありません。

- 権限：会員・admin

**リクエスト**

```json
{ "word": "认真", "sentence": "他学习很认真。" }
```

`word` は 1〜20 字、`sentence`（語句が出てきた文。任意）は 300 字までです。

**レスポンス** `200`

```json
{ "pinyin": "rènzhēn", "meaning": "まじめに、真剣に" }
```

OpenAI から下書きを受け取れなかったときは `502`（`draft_failed`）です。
