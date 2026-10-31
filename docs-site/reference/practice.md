# 練習の記録

## 介詞の練習の記録

会員と管理者が、Web の介詞の練習（`/practice/prepositions`、1 回 25 問）を最後まで解いたときの記録を保存し、見返すためのルートです。ゲストも練習はできますが、記録は残りません。

- 使えるのは会員と admin です。ゲストは `403`（`forbidden`）です。
- 記録は、いつもトークンの持ち主のものです。`?user=` は受け付けません（`400`）。管理者が会員として操作しているときは、その会員の記録です。
- 1 回分は 1〜50 問です。正答率は「1 回目で正解した問題 ÷ 問題数」で、Web が計算します。

### GET /v1/preposition-records

記録の一覧を、新しい順に 100 件まで返します。問題ごとの中身は含みません。

- 権限：会員・admin

**レスポンス** `200`

```json
{
  "records": [
    {
      "id": "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
      "questionCount": 25,
      "firstTryCount": 20,
      "missCount": 7,
      "elapsedMs": 95000,
      "startedAt": "2026-10-24T01:00:00.000Z",
      "createdAt": "2026-10-24T01:01:35.000Z"
    }
  ]
}
```

| 項目            | 意味                                 |
| --------------- | ------------------------------------ |
| `questionCount` | 問題数                               |
| `firstTryCount` | 間違えずに 1 回目で正解した問題の数  |
| `missCount`     | 間違えて選んだ回数の合計（ミス数）   |
| `elapsedMs`     | 最初の問題を出してから解き終えるまで |
| `startedAt`     | 練習を始めた時刻                     |
| `createdAt`     | 保存した時刻（サーバーが付けます）   |

### GET /v1/preposition-records/{id}

記録 1 件を、問題ごとの中身（`questions`）付きで返します。

- 権限：会員・admin

**レスポンス** `200`：一覧の 1 件に、出した順の `questions` を足したもの。

```json
{
  "id": "0b0c6f4e-5d2a-4c1b-9e3f-7a8b9c0d1e2f",
  "questionCount": 25,
  "firstTryCount": 20,
  "missCount": 7,
  "elapsedMs": 95000,
  "startedAt": "2026-10-24T01:00:00.000Z",
  "createdAt": "2026-10-24T01:01:35.000Z",
  "questions": [
    {
      "answer": "在",
      "noun": "学校",
      "prompt": "（　）学校学习",
      "misses": []
    },
    {
      "answer": "把",
      "noun": "门",
      "prompt": "（　）门关上",
      "misses": ["被", "对"]
    }
  ]
}
```

**エラー**

| HTTP | code        | 状況                                        |
| ---- | ----------- | ------------------------------------------- |
| 404  | `not_found` | 記録が無い、他人のもの、`id` が UUID でない |

### PUT /v1/preposition-records/{id}

解き終えた 1 回分を保存します。`id` はクライアントが作る UUID（小文字）です。同じ `id` をもう一度送っても記録は増えず、最初に保存したものを返します（保存のやり直し用）。

- 権限：会員・admin

**リクエスト**

```json
{
  "startedAt": "2026-10-24T01:00:00.000Z",
  "elapsedMs": 95000,
  "questions": [
    {
      "answer": "在",
      "noun": "学校",
      "prompt": "（　）学校学习",
      "misses": []
    },
    {
      "answer": "把",
      "noun": "门",
      "prompt": "（　）门关上",
      "misses": ["被", "对"]
    }
  ]
}
```

| 項目                 | 決まり                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `startedAt`          | ISO 8601                                                          |
| `elapsedMs`          | 0〜86,400,000（24 時間）                                          |
| `questions`          | 1〜50 件。出した順                                                |
| `questions[].answer` | 1〜10 字                                                          |
| `questions[].noun`   | 1〜40 字                                                          |
| `questions[].prompt` | 1〜100 字                                                         |
| `questions[].misses` | 間違えて選んだ介詞を選んだ順に 0〜3 件。重ならず、`answer` でない |

`questionCount`・`firstTryCount`・`missCount` は `questions` からサーバーが数え、`createdAt` もサーバーが付けます。

**レスポンス** `200`：保存した記録（`GET /v1/preposition-records/{id}` と同じ形）。

**エラー**

| HTTP | code              | 状況                                     |
| ---- | ----------------- | ---------------------------------------- |
| 400  | `invalid_request` | 項目が決まりに合わない、未知のフィールド |
| 403  | `forbidden`       | ゲスト                                   |
| 404  | `not_found`       | `id` が他人の記録、`id` が UUID でない   |

## 補語の練習の記録

Web の `/practice/complements` で、結果補語（`result`）・可能補語（`potential`）・程度補語（`degree`）と、方向補語の4種類（単純方向補語 `direction-simple`・複合方向補語 `direction-compound`・単純方向補語の派生義 `direction-simple-extended`・複合方向補語の派生義 `direction-compound-extended`）を選んで練習します。各モード25問の4択で、間違えた選択肢は再度選べず、正解まで選び直せます。出題順・選択肢の順番は練習ごとに変わります。

### 補語の記録 API

以下の3ルートは、上記の介詞の記録 API と同じ認証・所有者制限・採点・再送時の動作を持ちます。保存先は独立した `ComplementPracticeRecord` テーブルです。

- `GET /v1/complement-records`：自分の記録を新しい順で最大100件。
- `GET /v1/complement-records/{id}`：自分の記録の詳細。
- `PUT /v1/complement-records/{id}`：練習の結果を保存。

保存リクエストには、介詞の記録の項目に加えて `mode`（`result` / `potential` / `degree` / `direction-simple` / `direction-compound` / `direction-simple-extended` / `direction-compound-extended`）が必要です。一覧・詳細にも `mode` を返します。`questions[].noun` は補語の種類名、`answer` と `misses` の各要素は1〜40字です。その他の長さや件数の制限は介詞と同じです。未知の `mode` は `400` です。

Web の記録一覧は `/practice/complements/records`、詳細は `/practice/complements/records/{id}` です。会員・管理者だけが利用でき、ゲストは記録を保存しません。
