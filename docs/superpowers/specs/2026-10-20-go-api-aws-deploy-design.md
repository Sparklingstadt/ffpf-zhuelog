# Go API を AWS（ECS Express Mode）で動かす

> **置き換え済み**: この構成は段階 1（`docs/superpowers/specs/2026-10-21-go-api-on-vercel-design.md`）で Vercel に置き換えた。以下は当時の設計の記録。

`docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` のデプロイの節（Cloud Run）を置き換える。API の動作は変えない。

## 承認済みの要件

- 実行環境は Amazon ECS Express Mode（Fargate + 自動で作られる ALB）。App Runner は 2026-04-30 で新規受付を終了したため使わない。
- リージョンは `ap-northeast-1`。DB（Neon）は `us-east-1` のままなので、DB への往復が 1 回あたり約 150ms 増える（将来 Neon を移せば解消）。
- AWS のリソースは手順書の CLI コマンドで 1 回だけ作り、デプロイは GitHub Actions が行う。IaC（Terraform / CDK）は使わない。
- Cloud Run 用の workflow と GCP の手順は削除する。

## 構成

- ECS Express Mode のサービス 1 つ。公開 URL は Express Mode が発行する HTTPS エンドポイント（独自ドメインは扱わない）。
- タスク: 0.5 vCPU / 1 GB。最小 1、最大 2 タスク（Neon の接続数を抑える）。
- ALB のヘルスチェックのパスは `/ping`（DB にアクセスしない）。DB まで確かめる `/health` は手動の確認用。数秒ごとに DB へアクセスすると Neon が休止できず、DB 障害時に ECS が正常なタスクまで入れ替えるため。
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

## Express Mode に渡す値（確認済み）

`aws-actions/amazon-ecs-deploy-express-service@v1` の入力として次を渡す（CLI の `create-express-gateway-service` でも同じ項目が指定できる）。

| 入力                                             | 値                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `service-name`                                   | Actions Variable `API_SERVICE_NAME`                                                |
| `image`                                          | `<ECR リポジトリ>:${{ github.sha }}`                                               |
| `execution-role-arn` / `infrastructure-role-arn` | Actions Variables `AWS_ECS_EXECUTION_ROLE_ARN` / `AWS_ECS_INFRASTRUCTURE_ROLE_ARN` |
| `container-port`                                 | `8080`                                                                             |
| `health-check-path`                              | `/ping`（Go API が DB にアクセスせず 200 を返す）                                  |
| `cpu` / `memory`                                 | `512` / `1024`                                                                     |
| `min-task-count` / `max-task-count`              | `1` / `2`                                                                          |
| `environment-variables`                          | 秘密でない 3 つ（JSON 配列）                                                       |
| `secrets`                                        | 3 つのシークレットの Secrets Manager ARN（JSON 配列、`valueFrom` は完全な ARN）    |
| `log-group`                                      | `/ecs/<API_SERVICE_NAME>`                                                          |

- CPU アーキテクチャは既定の `X86_64`（GitHub の ubuntu ランナーでビルドするイメージと一致する）。
- エンドポイントは Express Mode が発行する `https://….ecs.ap-northeast-1.on.aws`。証明書は Express Mode が作る。ALB はホスト名でルーティングするので、IP 直打ちや別ホスト名では 404 になる。
- ALB は `X-Forwarded-For` の末尾にクライアントの IP を追加する（既定の append モード）ので、今のレート制限のキーの取り方をそのまま使える。
