# Go API の AWS（ECS Express Mode）デプロイ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go API（`services/api/`）のデプロイ先を Cloud Run から AWS ECS Express Mode（`ap-northeast-1`）に置き換え、手順書・仕様書・コード内の Cloud Run 前提の記述を AWS 向けに直す。

**Architecture:** GitHub Actions が OIDC で AWS のロールを引き受け、イメージを ECR に push し、`aws-actions/amazon-ecs-deploy-express-service@v1` で Express Mode のサービスを作成・更新する。AWS のリソース（ECR、IAM、Secrets Manager）は手順書の CLI コマンドで 1 回だけ作る。API の動作は変えない。

**Tech Stack:** GitHub Actions、`aws-actions/configure-aws-credentials`、`aws-actions/amazon-ecr-login`、`aws-actions/amazon-ecs-deploy-express-service@v1`、AWS CLI v2、Go 1.27。

**Spec:** `docs/superpowers/specs/2026-10-20-go-api-aws-deploy-design.md`（元の API 仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md`）

## Global Constraints

- リージョンは `ap-northeast-1`。
- Express Mode の入力は仕様書の表のとおり: `container-port` 8080、`health-check-path` `/health`、`cpu` `512`、`memory` `1024`、`min-task-count` 1、`max-task-count` 2、`log-group` `/ecs/<API_SERVICE_NAME>`、CPU アーキテクチャは既定の X86_64。
- シークレット `DATABASE_URL`・`API_JWT_SECRET`・`GITHUB_MOBILE_CLIENT_SECRET` は Secrets Manager の完全な ARN を `valueFrom` で渡す。秘密でない `GITHUB_MOBILE_CLIENT_ID`・`GITHUB_MOBILE_REDIRECT_URI`・`AUTH_ALLOWED_GITHUB_LOGINS` は `environment-variables` で渡す。
- Actions Variables（Secrets ではない）: `AWS_ROLE_ARN`、`AWS_ECS_EXECUTION_ROLE_ARN`、`AWS_ECS_INFRASTRUCTURE_ROLE_ARN`、`AWS_ECR_REPOSITORY`、`API_SERVICE_NAME`、`API_SECRET_DATABASE_URL_ARN`、`API_SECRET_JWT_ARN`、`API_SECRET_GITHUB_CLIENT_SECRET_ARN`、`API_GITHUB_CLIENT_ID`、`API_GITHUB_REDIRECT_URI`、`API_ALLOWED_GITHUB_LOGINS`。
- `AWS_ROLE_ARN` が空の間はデプロイジョブを skip する（job レベルの `if`）。
- デプロイ用ロールの信頼ポリシーは `token.actions.githubusercontent.com:sub` = `repo:Sparklingstadt/ffpf-zhuelog:ref:refs/heads/main`、`aud` = `sts.amazonaws.com` に限る。
- 既存 workflow の書き方に合わせる: `actions/checkout@v7` + `persist-credentials: false`、`permissions: contents: read, id-token: write`、`concurrency: api-deploy`。`vars.*` はシェルに直接埋め込まず `env:` 経由で渡す。
- 手順書・仕様書は日本語。シークレットの値はコマンドラインに書かない（`read -rs` で読み、`--secret-string file:///dev/stdin` などで渡す）。
- API の動作（Go のロジック、ルーティング、レート制限、停止時間 8s）は変えない。コメントとテスト名だけ直す。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。pre-commit フックが走るので、`DATABASE_URL` が未設定なら `DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public"` を付けてコミットする。

## Review Focus

- `AUTH_ALLOWED_GITHUB_LOGINS` のカンマや、Variables に含まれる `"` で JSON 配列が壊れないこと → Task 1 で `jq -n --arg` を使って JSON を組み立てる。
- `AWS_ROLE_ARN` 未設定のまま main にマージしても失敗する実行が生まれないこと → Task 1 の job レベル `if`。
- 手順書のコマンドどおりに作った名前・ARN と、workflow が読む Variables の名前が一致すること → Task 2 の Variables 表を Task 1 の workflow と突き合わせる。
- ALB 以外の経路（タスクのパブリック IP など）から直接アクセスされると `X-Forwarded-For` を偽装できること → Task 2 の注意書き。
- Cloud Run の記述が残っていないこと → 両タスクの最後に grep で確認する。

---

### Task 1: デプロイ workflow を AWS 版に置き換える

**Files:**

- Modify: `.github/workflows/api-deploy.yml`（全面書き換え）

**Interfaces:**

- Consumes: Global Constraints の Variables 名、`services/api/Dockerfile`。
- Produces: Task 2 の手順書が説明する Variables 名と同じものを読む workflow。

- [ ] **Step 1: workflow を書き換える** — トリガーと `permissions`・`concurrency` は今のまま。ジョブ `deploy` に `if: vars.AWS_ROLE_ARN != ''`、`runs-on: ubuntu-latest`、`timeout-minutes: 30`。手順は次のとおり。
  1. `actions/checkout@v7`（`persist-credentials: false`）
  2. `aws-actions/configure-aws-credentials`（現行メジャー。`role-to-assume: ${{ vars.AWS_ROLE_ARN }}`、`aws-region: ap-northeast-1`）
  3. `aws-actions/amazon-ecr-login`（現行メジャー。出力 `registry` を使う）
  4. ビルドと push: `image="${REGISTRY}/${ECR_REPOSITORY}:${SHA}"` を `docker build services/api` → `docker push`。`IMAGE` を `$GITHUB_ENV` に書く。
  5. JSON の組み立て: `jq -n --arg …` で `environment-variables`（3 つ）と `secrets`（3 つの `{name, valueFrom}`）の JSON 配列を作り、`$GITHUB_OUTPUT` に複数行で書く。
  6. `aws-actions/amazon-ecs-deploy-express-service@v1` に Global Constraints の値と、5 の出力を渡す。
  7. 出力 `endpoint` を `$GITHUB_STEP_SUMMARY` に書く。
     アクションのメジャー版は `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` で確認する。
- [ ] **Step 2: 検証** — `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/api-deploy.yml` → 出力なし。`pnpm exec prettier --check .github/workflows/api-deploy.yml` → OK。`grep -niE "gcloud|GCP|cloud run" .github/workflows/api-deploy.yml` → 何も出ない。
- [ ] **Step 3: コミット** — `git commit -m "ci(api): deploy the Go API to AWS ECS Express Mode"`

---

### Task 2: 手順書・仕様書・コメントを AWS 向けに直す

**Files:**

- Modify: `docs/api-deployment.md`（全面書き換え）、`docs/superpowers/specs/2026-10-20-go-mobile-api-design.md`（デプロイの節と Cloud Run の記述）、`.env.example`（8 行目付近の Cloud Run の記述）、`README.md`（`services/api` の段落に Cloud Run の記述があれば）
- Modify: `services/api/main.go:20` 付近（停止時間のコメント）、`services/api/main_test.go:281-284`（`TestShutdownTimeoutFitsCloudRunGrace` → `TestShutdownTimeoutFitsStopGrace`、コメント）、`services/api/httpapi/router.go:68` 付近（`/healthz` のコメント）、`services/api/httpapi/middleware_test.go:111` 付近、`services/api/httpapi/middleware.go` の `X-Forwarded-For` のコメント（Cloud Run / Google front end に触れていれば）

**Interfaces:**

- Consumes: Task 1 の workflow が読む Variables 名。

- [ ] **Step 1: 手順書を書き換える** — 構成は次のとおり。0. 概要（ECS Express Mode、`ap-northeast-1`、DB が `us-east-1` のためのレイテンシ）と、Variables が揃うまでデプロイは skip されること
  1. GitHub OAuth App（今の内容を流用）
  2. AWS の準備（AWS CLI v2）:
     - ECR リポジトリ
     - IAM の OIDC プロバイダ（`token.actions.githubusercontent.com`）とデプロイ用ロール（Global Constraints の信頼条件。権限は ECR への push、`ecs:*ExpressGatewayService*` などデプロイに必要なもの、2 つの ECS ロールへの `iam:PassRole`）
     - ECS のタスク実行ロール（`AmazonECSTaskExecutionRolePolicy` + 3 つのシークレットへの `secretsmanager:GetSecretValue`）とインフラロール（AWS 管理ポリシー `AmazonECSInfrastructureRoleforExpressGatewayServices`。名前は AWS のドキュメントで確認して書く）
     - Secrets Manager の 3 つのシークレット（`read -rs` で読み、値をコマンドラインに書かない。`API_JWT_SECRET` は `openssl rand -base64 48` の出力をパイプで渡す）
  3. Actions Variables の表（Global Constraints の 11 個。どこで値を得るか）
  4. マイグレーション（今の手順 4 を流用）
  5. デプロイと確認（workflow のサマリに出るエンドポイントに `curl -i https://<エンドポイント>/health`）
  6. 注意書き: レート制限は ALB が付ける `X-Forwarded-For` の末尾を信頼する（タスクに直接届く経路を作らない）／ALB はホスト名でルーティングする／`API_JWT_SECRET` のローテーション（新しいデプロイで反映）／メモリとパスワード計算の同時実行数／DB の URL は Neon の pooled URL で `?schema=` なし、API が `verify-full` に上げる
- [ ] **Step 2: 仕様書・`.env.example`・README を直す** — 元の仕様書のデプロイの節は「AWS ECS Express Mode で動かす。詳細は `2026-10-20-go-api-aws-deploy-design.md`」に置き換え、ほかの Cloud Run の記述（`/healthz` の理由、`X-Forwarded-For` の信頼の前提、メモリ）も ALB / ECS の言い方に直す。
- [ ] **Step 3: コード内のコメントとテスト名を直す** — 動作は変えない。停止時間 8s のコメントは「ECS の停止猶予（既定 30 秒）に収まる」、`/healthz` は「Cloud Run では予約パスだったため `/health` を正とする」程度の事実に直す。
- [ ] **Step 4: 検証** — `cd services/api && go vet ./... && go test -race ./...` → PASS。`pnpm exec prettier --check docs/api-deployment.md docs/superpowers/specs/2026-10-20-go-mobile-api-design.md .env.example README.md` → OK。`grep -rniE "cloud ?run|gcloud|GCP|google front|Secret Manager" services README.md .env.example docs/api-deployment.md docs/superpowers/specs/2026-10-20-go-mobile-api-design.md .github` → `/healthz` を予約していた経緯を書いた行以外は何も出ない。
- [ ] **Step 5: コミット** — `git commit -m "docs(api): document the AWS deployment and drop Cloud Run notes"`
