# フォローとタイムライン

会員の一覧、フォロー、フォローしている人の共有ノートを並べたタイムラインです。

- admin も会員も使えます。`?user=` は付けられません（付けると `400`）。
- フォローできる相手は、存在する会員（`ownerId` が `password:` で始まる人）だけです。admin はフォローできず、自分もフォローできません。
- 二重にフォローしても何も起きません。フォローしていない相手のフォロー解除も成功として扱います。

## GET /v1/members

自分以外のすべての会員を返します。会員は少ないのでページングしません。

- 権限：全員

**レスポンス** `200`

```json
{
  "members": [
    {
      "ownerId": "password:cmh0w1a2b0000qwer5678tyui",
      "displayName": "友だち",
      "following": true,
      "followsMe": false
    }
  ],
  "followingCount": 1,
  "followerCount": 0
}
```

| フィールド            | 内容                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `members`             | `displayName` の日本語の照合順（ICU の `ja-x-icu`）。同名なら作成順                                           |
| `members[]`           | `ownerId`・`displayName`・`following`・`followsMe`。ログインに使う `loginId` は他の会員に見せないため返さない |
| `members[].following` | 自分がその人をフォローしているか                                                                              |
| `members[].followsMe` | その人が自分をフォローしているか                                                                              |
| `followingCount`      | 自分がフォローしている相手のうち、今も存在する会員の数                                                        |
| `followerCount`       | 自分をフォローしている人の数（Web と同じく、フォローの行の数）                                                |

**エラー**

| HTTP | code              | 状況                       |
| ---- | ----------------- | -------------------------- |
| 400  | `invalid_request` | `?user=` が付いている      |
| 401  | `unauthorized`    | トークンが無い・無効・失効 |

## PUT /v1/follows/{ownerId}

会員をフォローします。

- 権限：全員

**パス**：`{ownerId}` は `^password:[a-z0-9]{1,64}$` の形。URL では `:` をそのまま書くか `%3A` にします（例：`/v1/follows/password:cmh0w1a2b0000qwer5678tyui`）。

**リクエスト**：本文なし。

**レスポンス** `204`（本文なし）

**エラー**

| HTTP | code              | 状況                                                             |
| ---- | ----------------- | ---------------------------------------------------------------- |
| 400  | `self_follow`     | 自分を指定した（「自分はフォローできません。」）                 |
| 400  | `invalid_request` | `?user=` が付いている                                            |
| 401  | `unauthorized`    | トークンが無い・無効・失効                                       |
| 404  | `not_found`       | `{ownerId}` の形が違う（admin の数値 ID など）、会員が存在しない |

## DELETE /v1/follows/{ownerId}

フォローをやめます。フォローしていない相手や、存在しない会員でも成功します。

- 権限：全員

**レスポンス** `204`（本文なし）

**エラー**

| HTTP | code              | 状況                       |
| ---- | ----------------- | -------------------------- |
| 400  | `invalid_request` | `?user=` が付いている      |
| 401  | `unauthorized`    | トークンが無い・無効・失効 |
| 404  | `not_found`       | `{ownerId}` の形が違う     |

## GET /v1/timeline

フォローしている会員の、共有中でゴミ箱に無いノートを新しい順に返します。

- 権限：全員

**クエリ**：`limit`・`cursor`（[ページング](./README.md#一覧の続きの取得)）

並びは `createdAt` の降順、同じ時刻なら `id` の降順です（共有した時刻ではありません）。退会した会員のノートは出ません。誰もフォローしていなければ空の配列です。

**レスポンス** `200`

```json
{
  "items": [
    {
      "entry": {
        "id": "cmh0x5k2p0000abcd1234efgh",
        "kind": "translation",
        "originalText": "今日は雨です。",
        "correctedText": "今天下雨。",
        "pinyin": "Jīntiān xià yǔ.",
        "hints": [],
        "createdAt": "2026-10-20T03:04:05.678Z",
        "sharedAt": "2026-10-20T04:00:00.000Z"
      },
      "ownerId": "password:cmh0w1a2b0000qwer5678tyui",
      "ownerName": "友だち"
    }
  ],
  "nextCursor": null
}
```

`entry` は [ノートの形](./README.md#ノートの形)、`ownerName` は会員の `displayName` です。

**エラー**

| HTTP | code              | 状況                               |
| ---- | ----------------- | ---------------------------------- |
| 400  | `invalid_request` | `limit`・`cursor` が不正、`?user=` |
| 401  | `unauthorized`    | トークンが無い・無効・失効         |
