# 認証とアカウント

仕組みの説明は [認証](../guide/auth.md) にあります。このページの `/v1/auth/*`（`POST /v1/auth/refresh` を除く）と `POST /v1/account/password` には、IP ごとに 1 分 10 回の [レート制限](../guide/auth.md#レート制限) があり（同じ枠を共有）、超えると `429 rate_limited` です。`POST /v1/auth/refresh` だけは別の枠で、IP ごとに 1 分 60 回です。`GET /v1/me` に制限はありません。

## POST /v1/auth/github

GitHub の認可コード（PKCE）でログインします。admin 用です。

- 権限：公開

**リクエスト**

```json
{
  "code": "GitHub から受け取った認可コード",
  "codeVerifier": "PKCE の code_verifier",
  "redirectUri": "yourapp://oauth/callback"
}
```

| フィールド     | 型     | 必須 | 内容                                                                                                                  |
| -------------- | ------ | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `code`         | string | ○    | 認可コード                                                                                                            |
| `codeVerifier` | string | ○    | PKCE（S256）の `code_verifier`                                                                                        |
| `redirectUri`  | string | ○    | 認可に使ったリダイレクト URI。`GITHUB_MOBILE_REDIRECT_URI` か `GITHUB_WEB_REDIRECT_URI`（設定したときだけ）と完全一致 |

**レスポンス** `200`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "refreshToken": "q3b8…",
  "expiresIn": 900,
  "refreshExpiresIn": 2592000
}
```

`expiresIn` はアクセストークンの、`refreshExpiresIn` はリフレッシュトークンの寿命（秒）です。`refreshExpiresIn` は admin・会員が 30 日（`2592000`）、ゲストが 24 時間（`86400`）です。

**エラー**

| HTTP | code                 | 状況                                                                                             |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------ |
| 400  | `invalid_request`    | JSON が不正、項目が空・無い・`null`                                                              |
| 401  | `unauthorized`       | `redirectUri` がモバイル用にも Web 用にも一致しない、GitHub がコードや `codeVerifier` を拒否した |
| 403  | `forbidden`          | GitHub のユーザー ID が許可リストに無い                                                          |
| 429  | `rate_limited`       | レート制限                                                                                       |
| 502  | `github_unavailable` | GitHub に届かない、タイムアウト（10 秒）、5xx、応答が不正                                        |

一致した方の GitHub OAuth App（モバイル用か Web 用）で認可コードを交換します。Web 用の callback は `https://<Web>/api/auth/callback/github/go` です。

## POST /v1/auth/guest

ゲストとしてログインします。認証もログイン情報も要りません。

- 権限：公開

**リクエスト**：本文は空か `{}` です。項目を付けると `400` です。

API に `API_WEB_PROXY_SECRET` を設定したときは、`X-Zhuelog-Proxy-Secret` がその値と一致する呼び出し（Web のサーバー）だけを受け付けます（定数時間で比べます）。一致しない・無いときは `403 forbidden` です。未設定のとき（ローカルの開発）は誰でも呼べます。

**レスポンス** `200`：`/v1/auth/github` と同じ形。`ownerId` は `guest`、`role` は `guest` です。リフレッシュトークンの寿命は **24 時間** で、`refreshExpiresIn` は `86400` です（会員・admin は 30 日）。

ゲストのトークンで呼べるのは `GET /v1/me` だけで、ほかの認証つきルートはすべて `403 forbidden` です。ゲストはリフレッシュできます。

**エラー**

| HTTP | code              | 状況                                                                                   |
| ---- | ----------------- | -------------------------------------------------------------------------------------- |
| 400  | `invalid_request` | 本文が空でも `{}` でもない                                                             |
| 403  | `forbidden`       | `API_WEB_PROXY_SECRET` を設定しているのに、`X-Zhuelog-Proxy-Secret` が一致しない・無い |
| 429  | `rate_limited`    | レート制限                                                                             |

## POST /v1/auth/password

ログイン ID とパスワードでログインします。会員用です。

- 権限：公開

**リクエスト**

```json
{ "loginId": "demo", "password": "demo-password-123" }
```

| フィールド | 型     | 必須 | 内容                                                                                                             |
| ---------- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `loginId`  | string | ○    | 前後の空白を除き小文字にして（JavaScript の `trim`・`toLowerCase` と同じ）、`^[a-z0-9._-]{3,32}$` に一致すること |
| `password` | string | ○    | 1〜128 文字                                                                                                      |

**レスポンス** `200`：`/v1/auth/github` と同じ形。ログインに成功すると、このクライアントからのこの `loginId` の試行回数は 0 に戻ります。

**エラー**

| HTTP | code              | 状況                                                                                                                                                                                   |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `invalid_request` | 本文が JSON のオブジェクトでない、未知のフィールド、`null`                                                                                                                             |
| 401  | `unauthorized`    | 形式の不正・存在しない ID・パスワード違い。区別しない                                                                                                                                  |
| 429  | `rate_limited`    | レート制限（IP ごとに 1 分 10 回）、または [試行回数](../guide/auth.md#試行回数の制限) の超過（15 分のあいだに同じクライアントから 20 回、同じクライアントから同じ `loginId` へ 5 回） |

## POST /v1/auth/refresh

リフレッシュトークンを新しい組と交換します（ローテーション）。提示したトークンは使えなくなります。

- 権限：公開

**リクエスト**

```json
{ "refreshToken": "q3b8…" }
```

**レスポンス** `200`：`/v1/auth/github` と同じ形。応答の `refreshToken` で手元の値を置き換えます。

提示したトークンが 30 秒以内にローテーション済みで、同じファミリーに有効なトークンが残っているときは、並行したリフレッシュとみなして `200` を返します（[リフレッシュの猶予](../guide/auth.md#リフレッシュの猶予)）。

**エラー**

| HTTP | code              | 状況                                                                                                                    |
| ---- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 400  | `invalid_request` | JSON が不正                                                                                                             |
| 401  | `unauthorized`    | 未知・空・期限切れのトークン。30 秒より前に使用済みのトークン（ファミリー全体を失効）。会員のパスワードが変わった（同） |
| 403  | `forbidden`       | admin が許可リストから外された（ファミリー全体を失効）                                                                  |
| 429  | `rate_limited`    | レート制限（リフレッシュだけの枠。IP ごとに 1 分 60 回）                                                                |

## POST /v1/auth/logout

リフレッシュトークンのファミリーを失効させます。

- 権限：公開

**リクエスト**

```json
{ "refreshToken": "q3b8…" }
```

**レスポンス** `204`（本文なし）。未知のトークンや空の文字列でも `204` です。

**エラー**

| HTTP | code              | 状況        |
| ---- | ----------------- | ----------- |
| 400  | `invalid_request` | JSON が不正 |
| 429  | `rate_limited`    | レート制限  |

## POST /v1/account/password

会員が自分のパスワードを変えます。Web の `ChangeOwnPassword` と同じ順に確かめます。

- 権限：会員（admin は `403`）
- `?user=`：不可（付けると `400`）

**リクエスト**

```json
{
  "currentPassword": "demo-password-123",
  "newPassword": "new-password-456",
  "confirmPassword": "new-password-456"
}
```

| フィールド        | 型     | 必須 | 内容                                                           |
| ----------------- | ------ | ---- | -------------------------------------------------------------- |
| `currentPassword` | string | ○    | 今のパスワード（1〜128 文字）                                  |
| `newPassword`     | string | ○    | 新しいパスワード。UTF-16 の単位で 12〜128 文字（空白も数える） |
| `confirmPassword` | string | ○    | `newPassword` と同じ値                                         |

確かめる順番：

1. 会員であること（違えば `403 forbidden`「この操作は会員だけが利用できます。」）
2. `newPassword` が UTF-16 の単位で 12〜128 文字であること（違えば `400 invalid_request`）
3. `newPassword` と `confirmPassword` が一致すること（違えば `400 password_mismatch`）
4. 試行を 1 回数えてから（アカウントごとに 15 分で 5 回まで）、`currentPassword` を確かめる。アカウントが無い・形式違い・試行が多すぎる・違うパスワードは、どれも `400 invalid_current_password`

1〜3 で失敗したときは、試行を数えません。

**レスポンス** `204`（本文なし）。新しいハッシュを保存し、`sessionVersion` を 1 上げ、試行の回数を戻します。**この端末を含め、Web と API の既存のログインはすべて無効になる** ので、アプリはログインし直します。

**エラー**

| HTTP | code                       | message                                                    |
| ---- | -------------------------- | ---------------------------------------------------------- |
| 400  | `invalid_request`          | 「パスワードは12〜128文字にしてください。」／JSON が不正   |
| 400  | `password_mismatch`        | 「確認用のパスワードが一致しません。」                     |
| 400  | `invalid_current_password` | 「現在のパスワードが違うか、一時的にロックされています。」 |
| 401  | `unauthorized`             | トークンが無い・無効・失効                                 |
| 403  | `forbidden`                | 「この操作は会員だけが利用できます。」：admin が呼んだ     |
| 429  | `rate_limited`             | レート制限（認証より前に数える）                           |

## GET /v1/me

認証済みの利用者の情報を返します。Web が「今の利用者」を決めるために使います。

- 権限：全員（**ゲストも可**）
- `?user=`：不可（付けると `400`）

**レスポンス** `200`

```json
{
  "ownerId": "password:ckx…",
  "role": "member",
  "login": "demo",
  "displayName": "デモ",
  "accountId": "ckx…"
}
```

| フィールド    | 型     | 内容                                                             |
| ------------- | ------ | ---------------------------------------------------------------- |
| `ownerId`     | string | ノートの所有者 ID。ゲストは `guest`                              |
| `role`        | string | `admin`・`member`・`guest`                                       |
| `login`       | string | admin は GitHub のログイン名、会員は `loginId`、ゲストは `guest` |
| `displayName` | string | 会員だけ。DB から読む。空のときは省く                            |
| `accountId`   | string | 会員だけ。`PasswordAccount` の `id`                              |

**エラー**

| HTTP | code           | 状況                                                                       |
| ---- | -------------- | -------------------------------------------------------------------------- |
| 401  | `unauthorized` | トークンが無い・無効・失効。会員のアカウントが消えた、パスワードが変わった |
| 403  | `forbidden`    | admin が許可リストから外れた                                               |
