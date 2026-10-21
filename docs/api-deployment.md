# Go API（`services/api`）のデプロイ手順

ネイティブアプリ向けの Go API を、AWS の ECS Express Mode（東京リージョン `ap-northeast-1`）へデプロイするための準備と手順です。仕様は `docs/superpowers/specs/2026-10-20-go-mobile-api-design.md` と `docs/superpowers/specs/2026-10-20-go-api-aws-deploy-design.md` にあります。

ECS Express Mode は、コンテナイメージを渡すと Fargate のタスクと ALB（HTTPS の証明書つき）、オートスケールをまとめて作ってくれる ECS の機能です。AWS 側の準備（ECR、IAM、Secrets Manager）と、モバイル用 GitHub OAuth App の登録は、リポジトリの管理者が手作業で 1 回だけ行います。`.github/workflows/api-deploy.yml` は、main への push のうち `services/api/**` に変更があるときと、手動実行（`workflow_dispatch`）で動きます。

**Actions Variables の `AWS_ROLE_ARN` が空のあいだは、デプロイのジョブはスキップされます。** 手順 3 を終えるまで、main へマージしても失敗する実行は出ません。

DB（Neon）は `us-east-1` にあるため、東京の API から DB への往復は 1 回あたり約 150ms かかります。1 回のリクエストで DB に 2〜4 回アクセスするので、応答は数百 ms 遅くなります。Neon を東京へ移せば解消します。

## 1. モバイル用 GitHub OAuth App の登録

Web 用とは別の OAuth App を新しく作ります。GitHub の **Settings → Developer settings → OAuth Apps → New OAuth App** で登録します。

- Application name: 任意（例: `学习録 mobile`）
- Homepage URL: Web の本番 URL
- Authorization callback URL: アプリのカスタム URL スキーム（例: `yourapp://oauth/callback`）

登録後に控える値は 2 つです。

- Client ID: Actions Variable `API_GITHUB_CLIENT_ID` に設定します。
- Client Secret: 手順 2 の Secrets Manager に入れます。

カスタム URL スキームは、Actions Variable `API_GITHUB_REDIRECT_URI` にも同じ値を設定します。Go API は、リクエストの `redirectUri` がこの値と完全一致することを要求します。

## 2. AWS の準備

AWS CLI v2 で、管理者権限のあるプロファイルから実行します。この節のコマンドは、**すべて同じターミナルで続けて** 実行してください（途中で作ったシェル変数を後のコマンドが使います）。Express Mode は、ネットワークを指定しなければ `ap-northeast-1` の既定の VPC を使います（既定の VPC を削除している場合は、作り直すか、workflow に `subnets` と `security-groups` を足してください）。

```bash
export AWS_REGION=ap-northeast-1
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
SERVICE=zhuelog-api        # Actions Variable API_SERVICE_NAME と同じ値
echo "$ACCOUNT_ID"         # デプロイ先のアカウントか確認する

# ECS のサービスリンクロール。新しいアカウントには無いことがある（既にあればエラーになるが問題ない）
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com || true
```

### ECR リポジトリとロググループ

```bash
aws ecr create-repository --repository-name "$SERVICE" --image-scanning-configuration scanOnPush=true
aws logs create-log-group --log-group-name "/ecs/${SERVICE}"
aws logs put-retention-policy --log-group-name "/ecs/${SERVICE}" --retention-in-days 30
```

### Secrets Manager

コンテナに渡すシークレットは次の 3 つです。

| シークレット名              | 環境変数                      | 内容                                                       |
| --------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `zhuelog-api/database-url`  | `DATABASE_URL`                | Neon の接続文字列（下の注意を参照）                        |
| `zhuelog-api/jwt-secret`    | `API_JWT_SECRET`              | アクセス JWT の HS256 鍵。`openssl rand -base64 48` で作る |
| `zhuelog-api/github-secret` | `GITHUB_MOBILE_CLIENT_SECRET` | モバイル用 GitHub OAuth App の Client Secret               |

値はコマンドラインに書かず、`read -rs` で入力します（入力した文字は画面に表示されません）。値はシェル変数から標準入力で `aws` に渡すので、シェルの履歴にもファイルにも残りません（`printf` はシェルの組み込みコマンドなので、プロセス一覧にも出ません）。JWT の鍵は `openssl` で作った値をそのまま渡すため、値を入力することも目にすることもありません。

```bash
# Neon の接続文字列を貼り付けて Enter
read -rs V && DB_SECRET_ARN="$(printf '%s' "$V" | aws secretsmanager create-secret \
  --name zhuelog-api/database-url --secret-string file:///dev/stdin --query ARN --output text)"; unset V

JWT_SECRET_ARN="$(openssl rand -base64 48 | tr -d '\n' | aws secretsmanager create-secret \
  --name zhuelog-api/jwt-secret --secret-string file:///dev/stdin --query ARN --output text)"

# モバイル用 GitHub OAuth App の Client Secret を貼り付けて Enter
read -rs V && GH_SECRET_ARN="$(printf '%s' "$V" | aws secretsmanager create-secret \
  --name zhuelog-api/github-secret --secret-string file:///dev/stdin --query ARN --output text)"; unset V

printf '%s\n' "$DB_SECRET_ARN" "$JWT_SECRET_ARN" "$GH_SECRET_ARN"
```

表示された 3 つの ARN（末尾にランダムな 6 文字が付いた完全な ARN）を、手順 3 の `API_SECRET_*_ARN` に設定します。貼り付ける値の前後に空白や改行を入れないでください。

**`zhuelog-api/database-url` には、Neon の pooled 接続文字列（ホスト名に `-pooler` を含むもの）を、`?schema=` パラメータを付けずに入れてください。** Neon の既定のスキーマは `public` なので、付けなくても同じテーブルを読み書きします。Go API は `schema=public` を無視しますが、それ以外のスキーマを指定すると `search_path` の起動パラメータに変換するため、プーラーに拒否されることがあります。

DB への接続は、Web と同じく TLS で証明書まで検証します。Go API は、ホストが `localhost`・`127.0.0.1`・`::1` 以外のとき（または `sslmode` が `prefer`・`require`・`verify-ca` のとき）、`sslmode` を `verify-full` に置き換え、`uselibpqcompat`・`ssl` パラメータを取り除きます。Neon の接続文字列に付いている `sslmode=require` は、そのままで構いません（`verify-full` に格上げされます）。

### ECS のロール

Express Mode には 2 つのロールが必要です。

- **タスク実行ロール**: イメージの取得、ログの送信、シークレットの読み出しに使います。
- **インフラロール**: ECS が ALB・ターゲットグループ・セキュリティグループ・証明書・オートスケールを作るのに使います。

```bash
SECRET_ARNS="[\"${DB_SECRET_ARN}\", \"${JWT_SECRET_ARN}\", \"${GH_SECRET_ARN}\"]"

aws iam create-role --role-name zhuelog-api-execution --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs-tasks.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'
aws iam attach-role-policy --role-name zhuelog-api-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name zhuelog-api-execution --policy-name read-api-secrets --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Effect\": \"Allow\", \"Action\": \"secretsmanager:GetSecretValue\", \"Resource\": ${SECRET_ARNS}}]
}"

aws iam create-role --role-name zhuelog-api-infrastructure --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'
aws iam attach-role-policy --role-name zhuelog-api-infrastructure \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
```

### GitHub Actions 用のデプロイロール（OIDC）

GitHub Actions がキーなしで AWS に認証するための設定です。信頼ポリシーで、**このリポジトリ（`Sparklingstadt/ffpf-zhuelog`）の main ブランチで動くワークフローだけ** に限定します。ほかのブランチや pull request のワークフローはロールを引き受けられないので、手動実行（`workflow_dispatch`）も main を選んで行います。

```bash
# アカウントに GitHub の OIDC プロバイダがまだ無い場合だけ実行する
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com

aws iam create-role --role-name zhuelog-api-deploy --assume-role-policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Principal\": {\"Federated\": \"arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com\"},
    \"Action\": \"sts:AssumeRoleWithWebIdentity\",
    \"Condition\": {\"StringEquals\": {
      \"token.actions.githubusercontent.com:aud\": \"sts.amazonaws.com\",
      \"token.actions.githubusercontent.com:sub\": \"repo:Sparklingstadt/ffpf-zhuelog:ref:refs/heads/main\"
    }}
  }]
}"

aws iam put-role-policy --role-name zhuelog-api-deploy --policy-name deploy-api --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": \"ecr:GetAuthorizationToken\", \"Resource\": \"*\"},
    {\"Effect\": \"Allow\", \"Action\": [
      \"ecr:BatchCheckLayerAvailability\", \"ecr:BatchGetImage\", \"ecr:InitiateLayerUpload\",
      \"ecr:UploadLayerPart\", \"ecr:CompleteLayerUpload\", \"ecr:PutImage\"
    ], \"Resource\": \"arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${SERVICE}\"},
    {\"Effect\": \"Allow\", \"Action\": [
      \"ecs:CreateCluster\", \"ecs:RegisterTaskDefinition\",
      \"ecs:CreateExpressGatewayService\", \"ecs:UpdateExpressGatewayService\", \"ecs:DescribeExpressGatewayService\",
      \"ecs:DescribeClusters\", \"ecs:DescribeServices\",
      \"ecs:ListServiceDeployments\", \"ecs:DescribeServiceDeployments\",
      \"ecs:TagResource\", \"ecs:UntagResource\"
    ], \"Resource\": \"*\"},
    {\"Effect\": \"Allow\", \"Action\": \"iam:PassRole\", \"Resource\": [
      \"arn:aws:iam::${ACCOUNT_ID}:role/zhuelog-api-execution\",
      \"arn:aws:iam::${ACCOUNT_ID}:role/zhuelog-api-infrastructure\"
    ]}
  ]
}"
```

ECS の権限は、[`aws-actions/amazon-ecs-deploy-express-service`](https://github.com/aws-actions/amazon-ecs-deploy-express-service) の README が示す一覧に合わせています。`iam:PassRole` は、上の 2 つのロールだけに絞っています。この権限の組み合わせは初回のデプロイで初めて実際に使われるので、手順 5 の確認を必ず行ってください。権限不足で失敗した場合は、ジョブのログに出る `AccessDenied` の操作名を `deploy-api` に足します。

## 3. Actions Variables の設定

GitHub のリポジトリの **Settings → Secrets and variables → Actions → Variables** に設定します。Secrets ではなく **Variables** です（ARN や ID は秘密情報ではないため）。

| 名前                                  | 内容                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `AWS_ROLE_ARN`                        | `arn:aws:iam::<ACCOUNT_ID>:role/zhuelog-api-deploy`。**空のあいだはスキップ**                             |
| `AWS_ECS_EXECUTION_ROLE_ARN`          | `arn:aws:iam::<ACCOUNT_ID>:role/zhuelog-api-execution`                                                    |
| `AWS_ECS_INFRASTRUCTURE_ROLE_ARN`     | `arn:aws:iam::<ACCOUNT_ID>:role/zhuelog-api-infrastructure`                                               |
| `AWS_ECR_REPOSITORY`                  | ECR のリポジトリ名（`zhuelog-api`）                                                                       |
| `API_SERVICE_NAME`                    | Express Mode のサービス名（`zhuelog-api`）。ロググループは `/ecs/<この名前>`                              |
| `API_SECRET_DATABASE_URL_ARN`         | `zhuelog-api/database-url` の完全な ARN                                                                   |
| `API_SECRET_JWT_ARN`                  | `zhuelog-api/jwt-secret` の完全な ARN                                                                     |
| `API_SECRET_GITHUB_CLIENT_SECRET_ARN` | `zhuelog-api/github-secret` の完全な ARN                                                                  |
| `API_GITHUB_CLIENT_ID`                | モバイル用 GitHub OAuth App の Client ID（`GITHUB_MOBILE_CLIENT_ID`）                                     |
| `API_GITHUB_REDIRECT_URI`             | アプリのカスタム URL スキーム（`GITHUB_MOBILE_REDIRECT_URI`）                                             |
| `API_ALLOWED_GITHUB_IDS`              | admin の許可リスト。GitHub の数値のユーザー ID（カンマ区切り）。Web の `AUTH_ALLOWED_GITHUB_IDS` と同じ値 |

最後の 3 つはコンテナの環境変数として渡されます。workflow は `jq` で JSON を組み立てるので、許可リストのカンマや値の中の引用符はそのまま使えます。

`API_ALLOWED_GITHUB_IDS` には、GitHub のログイン名ではなく**数値のユーザー ID** を入れます（例: `583231`）。ID は `https://api.github.com/users/<ログイン名>` の `id` で確認できます（`curl -s https://api.github.com/users/<ログイン名> | jq .id`）。ログイン名は本人が変更でき、手放された名前は他人が取得できるため、許可には使いません（ログイン名はトークンに情報として残るだけです）。数字以外の値は無視されます。以前の `API_ALLOWED_GITHUB_LOGINS` は使われなくなったので、`API_ALLOWED_GITHUB_IDS` を設定してから削除してください。

`AWS_ROLE_ARN` は、ほかの 10 個をすべて設定してから最後に設定してください。`AWS_ROLE_ARN` を設定した時点でデプロイが動くようになります。ほかに空の Variable があると、workflow は最初のステップで名前を示して止まります（イメージの push もサービスの更新もしません）。

## 4. Prisma マイグレーション（参考）

Go API が使う `ApiRefreshToken` テーブル（マイグレーション `20261020120000_add_api_refresh_tokens` と `20261020130000_add_api_refresh_token_login`）は、本番 Neon に適用済みです。今後スキーマを変えるときは、main へマージする前に本番へ適用します（main は Vercel の本番へ自動でデプロイされるため）。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

パスワードログインの試行回数を数える `SignInThrottle` テーブル（マイグレーション `20261021090000_add_sign_in_throttle`）も Go API が使います。本番に適用する前に Go API をデプロイすると、パスワードログインが `500` で失敗します。

`prisma.config.ts` は `.env` だけを読むため、`--env-file` で取得したファイルを明示的に渡しています。`P1001`（DB に届かない）が出たら、Neon のコンピュートが休止から起きるのを待って、もう一度実行してください。

## 5. デプロイと確認

手順 1〜3 を終えたら、**Actions → API deploy → Run workflow**（main を選ぶ）で実行します。以後は、`services/api/**` を変えて main にマージすると自動でデプロイされます。

初回の実行で、Express Mode がサービス・ALB・証明書を作ります。完了するとジョブのサマリにエンドポイント（`https://….ecs.ap-northeast-1.on.aws`）が出るので、それで確認します。

```bash
curl -i https://<エンドポイント>/health
```

`200` が返れば、DB への接続まで確認できています（失敗時は `503`）。

ALB のヘルスチェックは `/health` ではなく `/ping` を使います。`/ping` は DB にアクセスせずに `200` を返します。数秒ごとのヘルスチェックで DB にアクセスすると Neon のコンピュートが休止できずに費用がかかり続け、DB の障害時には ECS が正常なタスクまで入れ替えてしまうためです。アプリからのログインは、`POST /v1/auth/password` か `POST /v1/auth/github` で確認します。

ALB はホスト名で振り分けるので、ALB の IP アドレスや別のホスト名でアクセスすると `404` になります。必ずエンドポイントのホスト名を使ってください。

## 運用上の注意

### `API_JWT_SECRET` のローテーション

`API_JWT_SECRET` は Auth.js の `AUTH_SECRET` とは別の値です（32 バイト以上が必須）。

ローテーションすると、**発行済みのアクセストークンはすべて無効になります**（署名が合わなくなるため）。ただしリフレッシュトークンは DB のハッシュで検証するので影響を受けず、アプリは `POST /v1/auth/refresh` で新しいアクセストークンを取り直せます。

```bash
openssl rand -base64 48 | tr -d '\n' | aws secretsmanager put-secret-value \
  --secret-id zhuelog-api/jwt-secret --secret-string file:///dev/stdin
```

シークレットはタスクの起動時に読まれるので、新しい値を反映するには再デプロイ（workflow の手動実行）が必要です。入れ替えの途中は、古いタスクと新しいタスクが短い時間並んで動くため、古い鍵と新しい鍵のトークンが一時的に混在します。

### レート制限と `X-Forwarded-For`

`/v1/auth/*` には 2 種類の制限があります。

- **IP ごとのレート制限**: タスクのメモリ上で数え、1 分に 10 回までです。
- **パスワードログインの試行回数**: DB の `SignInThrottle` テーブルで数えます。Web と同じテーブル・同じキーを使うので、同じクライアントからの Web と API の試行は合わせて数えられます。15 分の固定の枠で、1 つのクライアントからのパスワードログインは 20 回まで、同じクライアントから同じ loginId へは 5 回まで（ログインに成功すると、その loginId の回数は 0 に戻ります）。超えるとパスワードのハッシュ計算をせずに `429`（`rate_limited`）を返します。回数は必ずクライアントのアドレスごとに数えるので、他人が間違ったパスワードを繰り返しても、別の場所からの本人のログインは止まりません（以前のアカウント単位のロックは廃止しました）。アドレスは、IPv4 はそのまま、IPv6 は上位 64 ビット（/64）単位で数えます。

どちらも、クライアントのアドレスには `X-Forwarded-For` の **最後の値** を使います。これは ALB が付け足す値で、クライアントが偽装できないため正しく動きます。そのため、**タスクには ALB からしか届かないようにしてください。ALB を通らずにタスクへ直接届く経路（タスクのパブリック IP への直接アクセス、別のロードバランサー、API Gateway など）を作らないでください。** 経路が増えると、攻撃者が `X-Forwarded-For` を偽装して制限を回避したり、他人のアドレスを名乗ってその人のパスワードログインを止めたりできるか、すべてのクライアントが 1 つのアドレスとして数えられます。

### 認証と公開範囲

エンドポイントはインターネットに公開します。アプリから直接呼ぶ API で、認証はアプリ層（アクセス JWT）で行うためです。タスク数は最小 1・最大 2 で、Neon の接続数を抑えています。

### メモリと同時実行数

タスクは 0.5 vCPU・1 GB で動かします。パスワードの検証（scrypt、N=2^15・r=8）は 1 回ごとに 32 MiB を使うため、Go API はタスクごとに同時に 4 件までしか計算しません（5 件目以降は空くまで待ちます）。ログインが集中してもメモリ不足で落ちないよう、メモリを 1 GB より下げないでください。

### 停止

ECS はタスクを止めるときに SIGTERM を送り、既定で 30 秒待ってから強制終了します。Go API は 8 秒以内に処理中のリクエストを終えて DB の接続を閉じるので、この猶予に収まります。
