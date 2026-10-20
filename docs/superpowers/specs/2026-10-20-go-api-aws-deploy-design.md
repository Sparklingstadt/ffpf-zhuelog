# Go API を AWS（ECS Express Mode）で動かす

`docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` のデプロイの節（Cloud Run）を置き換える。API の動作は変えない。

## 承認済みの要件

- 実行環境は Amazon ECS Express Mode（Fargate + 自動で作られる ALB）。App Runner は 2026-04-30 で新規受付を終了したため使わない。
- リージョンは `ap-northeast-1`。DB（Neon）は `us-east-1` のままなので、DB への往復が 1 回あたり約 150ms 増える（将来 Neon を移せば解消）。
- AWS のリソースは手順書の CLI コマンドで 1 回だけ作り、デプロイは GitHub Actions が行う。IaC（Terraform / CDK）は使わない。
- Cloud Run 用の workflow と GCP の手順は削除する。

## 構成

- ECS Express Mode のサービス 1 つ。公開 URL は Express Mode が発行する HTTPS エンドポイント（独自ドメインは扱わない）。
- タスク: 0.5 vCPU / 1 GB。最小 1、最大 2 タスク（Neon の接続数を抑える）。
- ヘルスチェックのパスは `/health`。
- ログは CloudWatch Logs（slog の JSON をそのまま出す）。

## シークレットと設定

- `DATABASE_URL`・`API_JWT_SECRET`・`GITHUB_MOBILE_CLIENT_SECRET` は Secrets Manager に置き、ECS の実行ロールが起動時にコンテナへ注入する。
- `GITHUB_MOBILE_CLIENT_ID`・`GITHUB_MOBILE_REDIRECT_URI`・`AUTH_ALLOWED_GITHUB_LOGINS` は Actions Variables から環境変数で渡す。

## デプロイ（`.github/workflows/api-deploy.yml` を置き換え）

- トリガーは main への push のうち `services/api/**` か workflow 自身が変わったときと、`workflow_dispatch`。
- `aws-actions/configure-aws-credentials` で GitHub OIDC からデプロイ用ロールを引き受ける → イメージをビルドして ECR に push（タグは `github.sha`）→ `aws-actions/amazon-ecs-deploy-express-service` でサービスを作成・更新し、安定を待つ。
- デプロイ用ロールの信頼ポリシーは `repo:Sparklingstadt/ffpf-zhuelog:ref:refs/heads/main` に限る。
- Actions Variable `AWS_ROLE_ARN` が空の間はジョブを skip する。

## 手順書（`docs/api-deployment.md` を AWS 版に書き換え）

GitHub OAuth App の登録、AWS で 1 回だけ行う準備（ECR、IAM の OIDC プロバイダとデプロイ用ロール、ECS の実行ロールとインフラロール、Secrets Manager の 3 つのシークレットを値をコマンドラインに書かずに登録）、Actions Variables、デプロイ後の確認（`curl https://<エンドポイント>/health`）、注意書き（レート制限は ALB が付ける `X-Forwarded-For` の末尾を信頼する／リージョン差によるレイテンシ）。

## コードの変更（動作は変えない）

- Cloud Run を前提にしたコメントを ALB / ECS 向けに直す（`X-Forwarded-For`、停止の猶予時間、`/healthz` の理由）。
- 停止の待ち時間 8s は ECS の既定の猶予 30s に収まるので変えない。

## 実装前に確認すること

- Express Mode の CLI と GitHub Action で、ヘルスチェックのパス・CPU / メモリ・最小 / 最大タスク数・Secrets Manager の注入が指定できること（AWS のドキュメントと Action の README で確認する）。
