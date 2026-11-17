---
home: true
title: 概要
heroText: Zhuelog API
tagline: 学习録（Zhuelog）の Go API（段階 11 からは health だけ）
actions:
  - text: エンドポイント
    link: /reference/
    type: primary
features:
  - title: Go に残るのは health だけ
    details: ログイン（GitHub・FFPF ID・パスワード・ゲスト・デモ）、ログアウト、ログイン中の人の確認は、段階 11 で Web（Next.js）に移りました。Go に残るのは /health・/healthz・/ping だけです。
  - title: 段階 12 で消す
    details: services/api とこのサイトは、段階 12 で消します。
  - title: 依存の少ない Go
    details: 標準の net/http と pgx だけで書かれ、Vercel（Go の Framework Preset）で動きます。
---

## 何のための API か

学习録は、中国語の作文を添削・翻訳した結果（学習ノート）を記録する Web アプリです。この Go API（`services/api/`）は、Web の機能を 1 つずつ Go から Web へ移すあいだ、Go に残った機能を受け持ってきました。段階 11 でログインが Web に移り、**Go に残るのは health のルート（`/health`・`/healthz`・`/ping`）だけ** です。`services/api/` とこのサイトは、段階 12 で消します。

- ログイン（GitHub・FFPF ID・パスワード・ゲスト・デモ）、ログアウト、ログイン中の人の確認、会員として見る操作は、Web が `Session` の表と `zl_session` の Cookie で行います。
- 学習ノート、復習、学習ログ、フォロー、会員の管理、LINE 連携、デモの毎晩のリセットなど、ほかの機能はすべて Web が受け持ちます（段階 1〜10）。
- ブラウザから呼ぶことは想定していません（CORS は無効です）。

## 構成

`services/api/` は独立した Go モジュールで、Web のコードには依存しません。

```text
services/api/
├── main.go        # 起動・設定の読み込み・graceful shutdown
├── config.go      # 環境変数の読み込み（PORT と DATABASE_URL だけ）
├── httpapi/       # ルーター（health だけ）、ミドルウェア、JSON の応答
├── store/         # pgx による DB への接続と ping
└── Dockerfile     # 任意（コンテナで動かすとき用。Vercel では使わない）
```

| パッケージ | 役割                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `httpapi`  | 標準の `net/http` のパターンルーティング（`GET /health` の形）。DB は `Pinger` インターフェースで受け取ります |
| `store`    | DB への接続（TLS の検証を含む）と ping。テーブルは読み書きしません                                            |

依存は `github.com/jackc/pgx/v5` だけで、ルーターやフレームワークは使いません。ログは `log/slog` の JSON 形式です。

## Web と API と DB

Web（Next.js）は、DB を Prisma で直接読み書きします。Go は DB に ping するだけです。スキーマの管理は Prisma に一本化しています。

### 環境変数

| 名前           | 内容                        |
| -------------- | --------------------------- |
| `PORT`         | 待ち受けポート（既定 8080） |
| `DATABASE_URL` | Neon の接続文字列（pooled） |

`DATABASE_URL` は必須で、無いときは起動時に終了します。Go はこの 2 つのほかの環境変数を読みません。以前のログインの設定が Go の Vercel プロジェクトに残っていても、起動には影響しません（消し方は [Vercel へのデプロイ](./operations/deploy.md) を見てください）。

## 関連する文書

このサイトは、リポジトリの次の文書とコードを元にしています。食い違いがあれば、コード（`services/api/`）が正です。

- `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md`（v1：認証とノートの読み書き）
- `docs/superpowers/specs/2026-10-21-go-api-trash-share-follow-design.md`（ゴミ箱・共有・フォロー）
- `docs/superpowers/specs/2026-10-21-go-api-web-parity-design.md`（カレンダー・会員の管理・CSV など）
- `docs/api-local.md`（ローカルで動かす）、`docs/api-deployment.md`（Vercel へのデプロイ）
