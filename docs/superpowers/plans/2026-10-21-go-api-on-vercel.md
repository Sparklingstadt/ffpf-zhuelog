# 段階 1：Go API を Vercel で動かす 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go API を Vercel の別プロジェクトで動かせるようにし（設定・上限・手順書）、AWS 向けの仕組みを取り除く。

**Architecture:** Vercel の Go Framework Preset が `services/api` の `main.go` をそのまま動かす。コードの変更は上限と接続数とコメントだけ。デプロイは Vercel の Git 連携。

**Tech Stack:** Go 1.27、Vercel（Go preset、Fluid compute）、Next.js（CSV の上限だけ）、VuePress（ドキュメントの数値）。

**Spec:** `docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md`

## Global Constraints

- CSV のファイルの上限は 4 MiB（`4 << 20`）、メッセージは「ファイルは4MB以下にしてください。」（Web と Go で同じ）。Go の CSV ルートの本文の上限は `4<<20 + 256<<10`。
- CSV アップロードの制限時間は 4 分（読み込み）、書き込みは +10 秒。
- pgx の `MaxConns` は 3。
- `X-Forwarded-For` の扱いはコードを変えない（コメントと文書の前提だけ ALB → Vercel）。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。`DATABASE_URL` が未設定なら `DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5439/zhuelog_api_test?schema=public"` を付けてコミットする。

## Review Focus

- 4 MiB ちょうどの CSV が通り、4 MiB + 1 バイトが 413 になること（Web と Go）→ Task 1。
- CSV ルートの本文の上限が 4.5 MB（4,718,592 バイト）未満であること → Task 1 の定数テスト。
- 手順書が、プレビューに本番の DB を入れないよう書いていること → Task 2。
- AWS の記述が文書に残っていないこと（履歴の仕様書を除く）→ Task 2 の grep。

---

### Task 1: 上限・制限時間・接続数（コード）

**Files:** Modify `services/api/httpapi/import_handlers.go`, `services/api/httpapi/respond.go`, `services/api/httpapi/import_handlers_test.go`, `services/api/store/store.go`, `services/api/httpapi/middleware.go`（XFF のコメント）, `src/presentation/controllers/learning-csv-import-controller.ts` と、その Web 側のテスト（`tests/` に上限のテストがあれば）

- [ ] **Step 1: 失敗するテスト** — Go: `TestImportCSVSizeLimits` に「4 MiB ちょうど → 413 にならない」「4 MiB + 1 → 413、メッセージは 4MB」を足し、既存の 5 MiB の期待値を直す。`TestCSVBodyLimitUnderVercelMax`（`maxCSVBodyBytes < 4_718_592`）。`TestCSVUploadTimeoutDefault`（4 分）。Web: 上限のテストがあれば 4 MiB に直し、無ければ `tests/` に controller のテストを 1 つ足す（4 MiB + 1 で「ファイルは4MB以下にしてください。」）。
- [ ] **Step 2:** FAIL を確認（`cd services/api && go test ./httpapi/`、`pnpm run test:unit`）。
- [ ] **Step 3: 実装** — 定数とメッセージを変える。`MaxConns = 3`。XFF のコメントを「Vercel はクライアントの IP で上書きする」に直す。コメント中の「5 MiB」も直す。
- [ ] **Step 4:** `go vet ./... && go test -race -count=1 ./...`（DB あり・なし）と `pnpm run test:unit && pnpm run typecheck && pnpm run lint` が通る。
- [ ] **Step 5:** `git commit -m "feat(api): fit CSV limits and timeouts to Vercel functions"`

### Task 2: Vercel の設定・AWS の削除・手順書

**Files:** Create `services/api/vercel.json`（`{"$schema": "https://openapi.vercel.sh/vercel.json", "framework": "go"}`）; Delete `.github/workflows/api-deploy.yml`; Rewrite `docs/api-deployment.md`; Modify `docs/superpowers/specs/2026-10-20-go-api-aws-deploy-design.md`（冒頭に置き換えの注記）, `docs-site/operations/deploy.md` ほか `docs-site/` の AWS・ALB・5MB の記述, `README.md`, `.env.example`, `docs/api-local.md`（AWS・ALB・5MB の記述があれば）

- [ ] **Step 1:** 仕様書の「手順書」の 6 項目どおりに `docs/api-deployment.md` を書き直す（日本語）。Ignored Build Step は `git diff --quiet HEAD^ HEAD -- .`（Root Directory が `services/api` なので `.` がそのディレクトリ）。
- [ ] **Step 2:** `docs-site/` の該当ページ・README・`.env.example`・`docs/api-local.md` を Vercel と 4MB に合わせる。
- [ ] **Step 3: 確認** — `pnpm run api-docs:build` が成功。`pnpm exec prettier --check` が通る。`grep -rniE "aws|ecs|alb|ecr|secrets manager|5MB|5 MiB" docs/api-deployment.md docs/api-local.md docs-site --include=*.md README.md .env.example` が何も出さない。
- [ ] **Step 4:** `git commit -m "docs(api): deploy the Go API on Vercel and drop the AWS setup"`
