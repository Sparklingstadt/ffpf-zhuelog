# エンドポイント

すべてのルートの一覧と、各ページに共通する決まりです。ルートの定義は `services/api/httpapi/router.go` にあります。

## 一覧

> **ログインについて**：ログイン（`/v1/auth/*`）とログイン中の人の確認（`/v1/me`）は Web（段階 11）が受け持ち、Go からは消えました。LINE とデモのリセット（`/v1/line/*`・`/v1/cron/demo-reset`）は段階 10b で消えました。Go に残るのは、次の health のルートだけです。

| メソッド | パス                      | 権限 | 成功 | 内容                           |
| -------- | ------------------------- | ---- | ---- | ------------------------------ |
| GET      | [`/health`](./health.md)  | 公開 | 200  | DB まで含めたヘルスチェック    |
| GET      | [`/healthz`](./health.md) | 公開 | 200  | `/health` と同じ（ローカル用） |
| GET      | [`/ping`](./health.md)    | 公開 | 200  | DB を見ない死活監視用          |

## 共通の決まり

### リクエスト

- どのルートも認証は要りません。
- 本文の上限は 1 MiB です。

### レスポンス

- 本文は JSON（`Content-Type: application/json; charset=utf-8`）で、すべての応答に `Cache-Control: no-store` が付きます。
- エラーは常に `{"error": {"code": "…", "message": "…"}}` の形です。`message` は利用者にそのまま見せられる日本語です。[エラー](../errors.md) を参照してください。
- 存在しないパスは `404 not_found`、パスはあるがメソッドが違うときは `405 method_not_allowed`（`Allow` ヘッダつき）です。
