# 会員の管理（admin）

admin がパスワード会員を一覧・作成し、パスワードをリセットするためのルートです。Web の管理画面と同じ規則で動きます。

- 使えるのは **admin だけ** です。会員が呼ぶと `403 forbidden` です。`?user=` は付けられません（付けると `400`）。
- 返したパスワードは、その応答の 1 回だけしか見られません。ログにも出しません。
- 会員の削除はありません（Web にもありません）。

## 入力の検証

| フィールド    | 規則                                                                        | 違反したときの `message`                                           |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `loginId`     | 前後の空白を除いて小文字にし、`^[a-z0-9._-]{3,32}$` に一致すること          | 「ログインIDは英小文字・数字・. \_ - の3〜32文字にしてください。」 |
| `displayName` | 前後の空白を除いて 1〜50 文字。NUL を含まない                               | 「表示名は1〜50文字にしてください。」                              |
| `password`    | 空（または空白だけ）なら生成する。それ以外は 12〜128 文字（空白は除かない） | 「パスワードは12〜128文字にしてください。」                        |

- 違反はすべて `400 invalid_request` で、`loginId`・`displayName`・`password` の順に確かめ、最初に違反した項目のメッセージを返します。
- 前後の空白は、JavaScript の `String.prototype.trim` と同じ文字を除きます（Web と同じ判定にするため）。
- 生成するパスワードは、ランダムな 15 バイトの base64url（20 文字）です。ハッシュは Web と同じ scrypt（N=32768, r=8, p=1）です。

## GET /v1/admin/accounts

パスワード会員を作成順（`createdAt` の昇順、同じ時刻なら `id` の昇順）に返します。ハッシュや失敗回数は返しません。

- 権限：admin

**レスポンス** `200`

```json
{
  "accounts": [
    {
      "id": "cmh0w1a2b0000qwer5678tyui",
      "ownerId": "password:cmh0w1a2b0000qwer5678tyui",
      "loginId": "demo",
      "displayName": "デモ",
      "createdAt": "2026-10-01T00:00:00.000Z",
      "locked": false
    }
  ]
}
```

| フィールド | 内容                                                     |
| ---------- | -------------------------------------------------------- |
| `id`       | `PasswordAccount` の ID。リセットのパスに使う            |
| `ownerId`  | `password:` + `id`。`?user=` やフォローに使う            |
| `locked`   | ログインの失敗でロック中か（`lockedUntil` が現在より後） |

**エラー**

| HTTP | code              | 状況                               |
| ---- | ----------------- | ---------------------------------- |
| 400  | `invalid_request` | `?user=` が付いている              |
| 401  | `unauthorized`    | トークンが無い・無効・失効         |
| 403  | `forbidden`       | 会員が呼んだ、許可リスト外の admin |

## POST /v1/admin/accounts

パスワード会員を作ります。

- 権限：admin

**リクエスト**

```json
{ "loginId": "new.member", "displayName": "新しい会員", "password": "" }
```

`password` は省略するか空にすると生成します。規則は [入力の検証](#入力の検証) のとおりです。

**レスポンス** `201`

```json
{
  "account": {
    "id": "cmh0x9z8y0000mnbv4321lkjh",
    "ownerId": "password:cmh0x9z8y0000mnbv4321lkjh",
    "loginId": "new.member",
    "displayName": "新しい会員",
    "createdAt": "2026-10-21T08:00:00.000Z",
    "locked": false
  },
  "password": "Xq3v9LmZ0aB7cD1eF2gH",
  "generated": true
}
```

`password` は保存したパスワード（送ったもの、または生成したもの）、`generated` は生成したかどうかです。

**エラー**

| HTTP | code              | 状況                                                    |
| ---- | ----------------- | ------------------------------------------------------- |
| 400  | `invalid_request` | [入力の検証](#入力の検証) に違反、JSON が不正、`?user=` |
| 401  | `unauthorized`    | トークンが無い・無効・失効                              |
| 403  | `forbidden`       | 会員が呼んだ                                            |
| 409  | `login_id_taken`  | 「このログインIDはすでに使われています。」              |

## POST /v1/admin/accounts/{id}/password

会員のパスワードをリセットします。`{id}` は `PasswordAccount` の ID（`ownerId` から `password:` を除いたもの）です。

- 権限：admin

**リクエスト**

```json
{ "password": "" }
```

`password` は省略するか空にすると生成し、それ以外は 12〜128 文字です。

新しいハッシュを保存し、失敗回数とロックを消し、`sessionVersion` を 1 上げます。**その会員の Web と API の既存のログインはすべて無効になります**。

**レスポンス** `200`

```json
{ "loginId": "demo", "password": "Xq3v9LmZ0aB7cD1eF2gH", "generated": true }
```

**エラー**

| HTTP | code              | 状況                                                               |
| ---- | ----------------- | ------------------------------------------------------------------ |
| 400  | `invalid_request` | 「パスワードは12〜128文字にしてください。」、JSON が不正、`?user=` |
| 401  | `unauthorized`    | トークンが無い・無効・失効                                         |
| 403  | `forbidden`       | 会員が呼んだ                                                       |
| 404  | `not_found`       | 「アカウントが見つかりません。」                                   |
