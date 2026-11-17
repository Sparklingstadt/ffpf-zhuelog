# Vercel へのデプロイ

::: tip 元の文書
このページは `docs/api-deployment.md` を元にしています。手順が変わったときは、そちらと合わせて直してください。
:::

Go API を、Vercel へデプロイするための準備と手順です。段階 11 からは、Go に残るのは health のルート（`/health`・`/healthz`・`/ping`）だけで、ログインは Web（Next.js）が受け持ちます。`services/api` と Go の Vercel プロジェクトは、段階 12 で消します。Web とは **別の Vercel プロジェクト** として、同じリポジトリの `services/api` をデプロイします。仕様は `docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md` にあります。

Vercel の Go の Framework Preset は、`services/api` の `go.mod` と `main.go` を見つけて、普通の `net/http` サーバーとして動かします（Fluid compute）。設定は `services/api/vercel.json`（`"framework": "go"`）にあります。Go の実行は Vercel では Beta です。

以後は Vercel の Git 連携で、main へのマージが本番、PR がプレビューにデプロイされます。

## 1. Vercel プロジェクト

1. Vercel のダッシュボードで **Add New… → Project** を選び、このリポジトリ（`Sparklingstadt/ffpf-zhuelog`）を Import します。Web のプロジェクトとは別のプロジェクト（本番は `ffpf-zhuelog-api`）です。
2. **Root Directory** に `services/api` を指定します。
3. **Framework Preset** が `Go` になっていることを確かめます（`services/api/vercel.json` でも指定しています）。
4. **Settings → Build and Deployment → Root Directory** の **Skip deployments when there are no changes to the root directory or its dependencies** をオンにし、`services/api/` に変更が無いときはデプロイを飛ばします。Vercel のビルド環境には `.git` が無いので、`git diff` を使う Ignored Build Step は動きません（エラーになります）。

## 2. 環境変数

**Settings → Environment Variables** に設定します。`PORT` は Vercel が設定するので不要です。

ビルドのために `GOFLAGS` に `-buildvcs=false` を入れます（Production と Preview）。Vercel のビルド環境には `.git` が無く、`go build` がコミットの情報を埋め込めずに失敗するためです。

| 名前           | 内容                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）。`?schema=` は付けない（下の注を参照） |

- `DATABASE_URL` は、手で入れなくても、チームの **Storage** タブで Web が使っている Neon のストアを開き、**Connect Project** から Go API のプロジェクトをつなぐと入ります（pooled の接続文字列です。`channel_binding=require` が付いていても Go API はそのまま使えます）。
- Preview の `DATABASE_URL` には本番の接続文字列を入れず、Neon のブランチなど別の DB を指定します。Preview に `DATABASE_URL` が無いと、プレビューのデプロイは起動時に止まります。
- Go はこのほかの環境変数を読みません。以前のログインのための値が残っていても起動には影響しません。消す値と順番は `docs/api-deployment.md` にあります。

DB への接続は、TLS で証明書まで検証します。ホストが `localhost`・`127.0.0.1`・`::1` 以外のとき（または `sslmode` が `prefer`・`require`・`verify-ca` のとき）、Go API は `sslmode` を `verify-full` に置き換えます。Neon の接続文字列の `sslmode=require` はそのままで構いません。`?schema=public` は無視しますが、それ以外のスキーマは `search_path` の起動パラメータになり、プーラーに拒否されることがあるので付けないでください。

## 3. 本番の DB

テーブルは Prisma のマイグレーションで本番の Neon に適用します。Go はテーブルを読み書きせず、DB に ping するだけです。今後スキーマを変えるときは、main へマージする前に本番へ適用します（main は Web と Go API の両方の本番へ自動でデプロイされるため）。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

## 4. デプロイと確認

main にマージすると本番にデプロイされます（`services/api/` に変更がある場合）。初回や変更が無いときは、ダッシュボードの **Deployments → Redeploy** で実行します。

```bash
curl -i https://<プロジェクト>.vercel.app/health
```

`200` が返れば、DB への接続まで確認できています（失敗時は `503`）。`/ping` は DB にアクセスせずに `200` を返します。

## 5. Web の設定

Web（Next.js）は、ログインを含むすべての機能を自分で受け持ち、DB を Prisma（`src/infrastructure/prisma/`）で読み書きします。Web の Vercel プロジェクトに入れる値と、段階 11 の切り替えの前と後に行うことは、リポジトリの `docs/api-deployment.md` にあります。

## 運用上の注意

### DB の接続数

Go API は 1 つのインスタンスあたり最大 3 本の DB 接続を持ちます。Vercel がインスタンスを増やすと接続数も増えるので、Neon の pooled 接続文字列を使ってください。

### 公開範囲

エンドポイントはインターネットに公開します。残っているのは health のルートだけで、認証は要りません。CORS は設定していません（ブラウザから直接は呼びません）。頻繁な死活監視には、DB にアクセスしない `/ping` を使ってください。
