# 段階 1：Go API を Vercel で動かす

「フロントは Next.js、バックエンドは Go、どちらも Vercel」に移す計画の段階 1。Go API（`services/api/`）を AWS ECS ではなく Vercel の別プロジェクトで動かす。Web（Next.js）はこの段階では変えない（CSV の上限だけそろえる）。

全体の段階:

1. Go API を Vercel で動かす（この仕様）
2. Web のログインを Go API に移す（Go API に Web 用の GitHub ログインとゲストを足し、Next.js がトークンを HttpOnly Cookie で持つ。Auth.js をやめる）
3. Web のデータの読み書きを Go API 経由に移し、Web から Prisma の読み書きをなくす（スキーマとマイグレーションは Prisma のまま）

## 承認済みの要件

- Go API は Web と同じリポジトリの、Vercel の **別プロジェクト** に置く。
- CSV の上限は Web と Go API の両方で **4 MiB**（Vercel の関数は本文 4.5 MB が固定の上限）。
- AWS 向けの workflow と手順は Vercel 向けに置き換える。
- DB のスキーマは変えない。

## Vercel の前提（資料で確認済み）

- Go の Framework Preset は、プロジェクトのルートの `go.mod` と `main.go` を見つけ、普通の `net/http` サーバーを動かす。サーバーは `PORT` で待ち受ける。`framework` を `go` にする必要がある。現在 Beta。
- Go のバージョンは `go.mod` の `go`（`toolchain` があればそれ）から読む。
- 実行は Fluid compute。1 つのインスタンスが複数のリクエストを受けるので、プロセス内の状態（pgx の接続プール、メモリ上のレート制限、scrypt の同時実行数の上限）はインスタンスごとに有効。
- Vercel は `X-Forwarded-For` をクライアントの IP で上書きし、外部から来た値は渡さない（なりすまし対策）。`x-vercel-forwarded-for` と `x-real-ip` も同じ値。
- 関数の本文は要求・応答とも 4.5 MB が上限で、設定やプランでは上げられない。

## 構成

- Vercel プロジェクト（例: `zhuelog-api`）を新しく作る。Root Directory は `services/api`、Framework は `go`（`services/api/vercel.json` に `"framework": "go"` を書く）。
- Git 連携で main を本番、PR をプレビューにする。`services/api/` に変更が無いコミットはビルドを飛ばす（Ignored Build Step に `git diff --quiet HEAD^ HEAD -- .`）。
- URL はまず Vercel の `*.vercel.app`。独自ドメインは後で足せる。
- 環境変数は Vercel のこのプロジェクトに設定する: `DATABASE_URL`（Neon の pooled URL、`?schema=` なし）、`API_JWT_SECRET`、`GITHUB_MOBILE_CLIENT_ID`、`GITHUB_MOBILE_CLIENT_SECRET`、`GITHUB_MOBILE_REDIRECT_URI`、`AUTH_ALLOWED_GITHUB_IDS`。`PORT` は Vercel が設定する。
- `.github/workflows/api-deploy.yml`（AWS 向け）は削除する。CI（`ci.yml` の `go` ジョブ）はそのまま。

## コードの変更

- **CSV の上限を 4 MiB に**: Web（`src/presentation/controllers/learning-csv-import-controller.ts` の `MAX_FILE_SIZE`）と Go API（`httpapi/import_handlers.go`）の両方。超えたときのメッセージは「ファイルは4MB以下にしてください。」（Web と Go で同じ）。Go API の CSV ルートだけ広げている本文の上限（今は 6 MiB）は、4 MiB にマルチパートの余白を足した値にし、4.5 MB を超えない（例: 4 MiB + 256 KiB）。仕様書と VuePress のドキュメントの数値も直す。
- **CSV アップロードの制限時間**: 今の延長は 5 分。Vercel の関数の最大実行時間を超えないよう 4 分にする（実装前に、このプランの Go の最大実行時間を Vercel の資料かダッシュボードで確かめ、それより短ければさらに下げる）。
- **レート制限のキー**: `X-Forwarded-For` の最後の値を使う今の作りは、Vercel では上書き済みの 1 つの値になるので正しい。コードは変えず、コメントと手順書の前提を「ALB」から「Vercel」に直す。
- **DB の接続数**: Vercel はインスタンスを自動で増やすので、pgx のプールの上限を 1 インスタンスあたり 5 から 3 に下げる（Neon の pooled 接続を前提）。
- **ヘルスチェック**: Vercel に ALB のヘルスチェックは無い。`/health`・`/healthz`・`/ping` はそのまま残す。
- **起動と停止**: `main.go` は `PORT` を読んで待ち受け、SIGTERM で 8 秒以内に終わる今の作りのまま（Vercel の停止の扱いが違っても害はない）。

## 手順書（`docs/api-deployment.md` を Vercel 版に書き直す）

1. Vercel でプロジェクトを作る（Import → Root Directory `services/api` → Framework `Go`）。
2. 環境変数を設定する（本番とプレビューの値を分ける。プレビューで本番の DB を書き換えないよう、プレビューには本番の `DATABASE_URL` を入れない）。
3. Ignored Build Step を設定する。
4. 本番の Neon で `ja-x-icu` の照合順序があるか確かめる（`SELECT 1 FROM pg_collation WHERE collname = 'ja-x-icu'`）。
5. デプロイ後に `curl -i https://<プロジェクト>.vercel.app/health` で 200 を確かめる。
6. 注意書き: Go の実行は Beta、本文 4.5 MB の上限、レート制限が Vercel の `X-Forwarded-For` を前提にしていること、`API_JWT_SECRET` のローテーション（再デプロイで反映）。

AWS の手順（ECR・IAM・ECS・Secrets Manager）はすべて削除する。`docs/superpowers/specs/2026-10-20-go-api-aws-deploy-design.md` は冒頭に「段階 1 で Vercel に置き換えた」と書き、本文は残す。

## 範囲外

- Web のログインと読み書きの変更（段階 2・3）。
- 独自ドメイン、CORS（Web はサーバー同士で呼ぶので段階 2 でも不要の見込み）。
