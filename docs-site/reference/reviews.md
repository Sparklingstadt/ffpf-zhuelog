# 復習

会員と admin が、練習で間違えた問題や、自分で選んだ単語・学習ノートを間隔反復（FSRS）で復習するためのルートです。

- 使えるのは会員と admin です。ゲストは `403`（`forbidden`）です。
- 復習の問題は、いつもトークンの持ち主のものです。管理者が会員として操作しているときは、その会員のものです。
- 問題は、介詞・補語の練習記録を保存したときに自動で入ります（[練習の記録](./practice.md)）。間違えた（`misses` がある）問題のうち、`id` があるものだけです。同じ問題がすでに入っていて期日がまだ先なら、期日をいまに早めます（覚えている度合いはそのままです）。
- 学習ノートは、自分で選んだものだけが入ります（[学習ノートを復習に入れる](#学習ノートを復習に入れる)）。ノートを作っても、CSV や LINE から取り込んでも、自動では入りません。
- ノートをゴミ箱に入れると、その問題は `GET /v1/reviews/due` の `items` にも `count` にも出なくなります。覚えている度合い（FSRS のカード）は残るので、復元すると元の期日と状態のまま戻ります。ノートを完全に削除する（[`DELETE /v1/trash/{id}`](./trash.md#delete-v1-trash-id)・[`DELETE /v1/trash`](./trash.md#delete-v1-trash)）と、その問題と回答の記録も消えます。

| `kind`        | `targetId`                                                | 例                          |
| ------------- | --------------------------------------------------------- | --------------------------- |
| `preposition` | 介詞の用法の `id` と名詞を `:` でつないだもの             | `P001:学校`                 |
| `complement`  | 補語の問題の `id`（動詞から選ぶは `verb:<行 ID>:<動詞>`） | `result-01`、`verb:C005:看` |
| `vocabulary`  | [単語帳](./vocabulary.md)の単語の `id`                    | UUID                        |
| `entry`       | 復習に入れた[学習ノート](./entries.md)の `id`             | cuid                        |

次の期日は FSRS（[go-fsrs](https://github.com/open-spaced-repetition/go-fsrs)）の既定のパラメータで決めます。定着率は 90%、学習ステップは 1 分と 10 分です。

### GET /v1/reviews/due

いま期日が来ている問題の数と、そのうち期日の古い順に `limit` 件（1〜100、既定 20）を返します。`limit` が範囲外なら `400` です。

- 権限：会員・admin

**レスポンス** `200`

```json
{
  "count": 3,
  "streakDays": 5,
  "items": [
    {
      "id": "cabcdefghijklmnopqrstuvwx",
      "language": "zh",
      "kind": "preposition",
      "targetId": "P001:学校",
      "due": "2026-11-05T10:00:00.000Z",
      "state": 0,
      "reps": 0,
      "lapses": 0,
      "lastReview": null
    }
  ]
}
```

| 項目         | 意味                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| `count`      | 期日が来ている問題の数（`items` の件数ではありません）                                  |
| `streakDays` | 日本時間で、1 問以上復習した日が今日（または昨日）まで何日続いているか                  |
| `language`   | 学んでいる言語。今は `zh` だけ                                                          |
| `state`      | `0` 未学習、`1` 学習中、`2` 復習中、`3` 再学習中                                        |
| `reps`       | 答えた回数                                                                              |
| `lapses`     | 復習中に「もう一度」を選んだ回数                                                        |
| `lastReview` | 最後に答えた時刻。まだ答えていなければ `null`                                           |
| `vocabulary` | `kind` が `vocabulary` のときだけ、その単語（[単語帳](./vocabulary.md)の 1 件と同じ形） |
| `entry`      | `kind` が `entry` のときだけ、そのノート（[ノートの形](./README.md#ノートの形)と同じ）  |

`vocabulary` と `entry` は、単語やノートが見つからないときは付きません。

`kind` が `entry` の問題は、たとえばこうなります。

```json
{
  "id": "cabcdefghijklmnopqrstuvwx",
  "language": "zh",
  "kind": "entry",
  "targetId": "cmh0x5k2p0000abcd1234efgh",
  "due": "2026-11-09T10:00:00.000Z",
  "state": 0,
  "reps": 0,
  "lapses": 0,
  "lastReview": null,
  "entry": {
    "id": "cmh0x5k2p0000abcd1234efgh",
    "kind": "correction",
    "originalText": "我昨天去了学校。",
    "correctedText": "我昨天去学校了。",
    "pinyin": "Wǒ zuótiān qù xuéxiào le.",
    "hints": [
      {
        "id": "cmh0x5k2p0001abcd1234efgh",
        "content": "了の位置",
        "position": 0
      }
    ],
    "createdAt": "2026-10-20T03:04:05.678Z",
    "sharedAt": null
  }
}
```

### POST /v1/reviews/{itemId}

1 問に答えます。答えると次の期日が決まり、回答の記録が残ります。

- 権限：会員・admin

**リクエスト**

```json
{ "logId": "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f", "rating": 3 }
```

| 項目     | 決まり                                                                    |
| -------- | ------------------------------------------------------------------------- |
| `logId`  | クライアントが作る UUID。同じ `logId` で送り直しても、答えるのは 1 回だけ |
| `rating` | `1` もう一度、`2` 難しい、`3` できた、`4` 簡単                            |

**レスポンス** `200`：答えたあとの問題（`GET /v1/reviews/due` の `items` の 1 件と同じ形）。

`rating` や `logId` が不正なら `400`、ほかの人の問題や存在しない問題、別の問題で使った `logId` なら `404`（`not_found`）です。

## 学習ノートを復習に入れる

自分の学習ノートを選んで、復習の問題（`kind` は `entry`、`targetId` はノートの `id`）にする操作です。

- 権限は会員・admin です。ゲストは `403`（`forbidden`）です。
- 対象は、いつもトークンの持ち主の、ゴミ箱に無いノートです。ゴミ箱の中・他人・存在しない ID は `404 not_found` です。
- `?user=` は付けられません（付けると `400`）。

### GET /v1/entries/{id}/review

ノートが復習に入っているかどうかを返します。

- 権限：会員・admin

**レスポンス** `200`

```json
{ "inReview": true }
```

**エラー**

| HTTP | code              | 状況                               |
| ---- | ----------------- | ---------------------------------- |
| 400  | `invalid_request` | `?user=` が付いている              |
| 401  | `unauthorized`    | トークンが無い・無効・失効         |
| 403  | `forbidden`       | ゲストが呼んだ                     |
| 404  | `not_found`       | 存在しない、他人のもの、ゴミ箱の中 |

### PUT /v1/entries/{id}/review

ノートを復習に入れます。新しい問題（`state` は `0`）として、すぐ期日になります。すでに入っていれば何も変えません（期日も覚えている度合いもそのままです）。

- 権限：会員・admin

**リクエスト**：本文なし。

**レスポンス** `204`（本文なし）

**エラー**：`GET /v1/entries/{id}/review` と同じ。

### DELETE /v1/entries/{id}/review

ノートを復習から外します。その問題の回答の記録も消えます。復習に入っていないノートでも成功します。もう一度入れると、新しい問題として最初からになります。

- 権限：会員・admin

**レスポンス** `204`（本文なし）

**エラー**：`GET /v1/entries/{id}/review` と同じ。
