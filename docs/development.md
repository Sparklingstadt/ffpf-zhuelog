# 開発と運用

学习録を手元で動かす手順、認証の設定、テスト、本番への反映の手順です。入口は [README](../README.md)、全体の設計は [architecture.md](architecture.md) にあります。

## 起動方法

前提: Node.js 24 または 26、Docker Desktop

ログインも学習ノートの読み書きも Web が行います。ログインは Better Auth が行い、ログイン中の人は、Cookie `better-auth.session_token` から DB の `session` と `user` の行を引いて決めるので、手元では DB だけが要ります。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm run db:deploy
pnpm run db:seed:sample   # サンプルの会員（下の表）
pnpm run dev
```

ブラウザーで <http://localhost:3000> を開き、ゲストか、サンプルの会員（下の「サンプルのアカウント」）でログインします。管理者は Sparklingstadt ID でログインする人ですが、手元では本物の ID サーバーが要るので、下の「手元で管理者になる」の方法を使います。

`.env` では、次のようにそろえます。

- `DATABASE_URL`: `.env.example` の値（`docker compose up -d` の開発用 DB）のまま。サンプルの会員は `pnpm run db:seed:sample` で、この DB に入ります。開発用 DB は `127.0.0.1:55432` で動きます（ほかの Postgres がよく使う 5432 とぶつからないように）。ポートは `ZHUELOG_DB_PORT` で替えられ、替えたら `DATABASE_URL` のポートも合わせます。「address already in use」や Prisma の `P1010` が出たら、ほかの Postgres がそのポートを使っています。
- `AUTH_URL`: `http://localhost:3000`。Better Auth の `baseURL` と、Sparklingstadt ID の `redirect_uri` を決めます。
- `BETTER_AUTH_SECRET`: 32 文字以上のランダムな値（例: `openssl rand -base64 32`）。必須です。
- `DEMO_LOGIN_ID`・`DEMO_PASSWORD`: ローカルでは `demo` と `demo-password-123`（サンプルの会員 `demo` のパスワードと同じです。両方あるときだけ、デモのボタンが出ます）。
- `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET`: 手元で Sparklingstadt ID を試すときだけ。3 つそろわないと、Sparklingstadt ID のボタンは出ません。手元の ID サーバー（下の「Sparklingstadt ID でのログイン」）を使うなら、`SID_ISSUER` は `http://localhost:<ID サーバーのポート>` です（issuer は `https://` が必要ですが、`localhost` と `127.0.0.1` だけは `http://` で使えます）。

Prisma のマイグレーションと seed は、同じ `DATABASE_URL` を使います。

### サンプルのアカウント

手元だけのテストの値で、`scripts/sample-members-seed.ts` が作ります（何度実行しても重複しません）。`docker compose down -v` で DB ごと消えます。Web のログイン画面の「ID とパスワード」で使えます。

| loginId  | パスワード            | 内容                                |
| -------- | --------------------- | ----------------------------------- |
| `demo`   | `demo-password-123`   | 試すときに使う会員                  |
| `friend` | `friend-password-123` | 共有済みのエントリーを 2 件持つ会員 |

### LINE を手元で見る

LINE 連携は手元では使えません。本物の LINE のチャネルと OpenAI の API キーが要るためです（e2e は偽の LINE API の `e2e/line-stub.ts` で確かめます）。Web に LINE の環境変数が無いと、「LINE 連携」画面（`/account/line`）には「LINE 連携は今は使えません。」と出ます。

ダミーの LINE 設定でコード発行画面を確認する場合は、Web の `.env.local` に `LINE_LINK_PREVIEW_MODE="true"` を設定してください。本番ボットへ送る QR とボタンを隠し、表示確認用であることを明示します。ローカル DB で発行したコードは本番の LINE ボットには登録されないため、本番での連携には本番画面で発行したコードを使います。

## 認証・認可の設定

ログインは Better Auth が行います（`/api/auth/*`）。Web の Vercel プロジェクトに入れる値は `AUTH_URL`・`BETTER_AUTH_SECRET`・`DEMO_LOGIN_ID`・`DEMO_PASSWORD`・`DATABASE_URL` です（Sparklingstadt ID を使うときは、下の「Sparklingstadt ID でのログイン」の 3 つも）。手順は [docs/deployment.md](deployment.md) の「2. Web の設定」にあります。しくみは [architecture.md](architecture.md) の「4. 認証」にあります。

管理者は、DB の `user.role` が `admin` の人です。環境変数の許可リストはありません。管理者を増やす・外すときは、DB を直接変えます。

```sql
UPDATE "user" SET role = 'admin' WHERE id = '<user の id>';
```

### 手元で管理者になる

手元には本物の Sparklingstadt ID が無いので、次のどちらかで管理者になります。

- **`UPDATE` で役割を替える（手軽）**：サンプルの会員（`friend` など）で ID とパスワードでログインできるようにしてから、DB でその `user` の役割を替えます。次のログインから（ログイン中なら、次のリクエストから）管理者です。

  ```bash
  psql "postgresql://zhuelog:zhuelog@127.0.0.1:55432/zhuelog" \
    -c "UPDATE \"user\" SET role = 'admin' WHERE username = 'friend'"
  ```

  管理者は会員の画面の `/admin/accounts` で、会員を作ったり、なりすましたりできます。戻すときは、`role` を `'user'` に替えます。

- **Sparklingstadt ID のスタブ**：`e2e/fixtures/sid-oidc-stub.ts` の `startSidOidcStub` が、画面なしで戻ってくる小さな OIDC のサーバーです。起動して、`SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET` をそのスタブに向け、その `sub`（`sidStubUser.sub`）を持つ `account`（`providerId` は `sid`）を、`role` が `admin` の `user` につないでおくと、「Sparklingstadt ID でログイン」で管理者になれます。e2e の `asAdmin`（`e2e/fixtures.ts`）が、この形を作っています。

### Sparklingstadt ID でのログイン

ログイン画面の「Sparklingstadt ID でログイン」から、Sparklingstadt ID（[sparklingstadt-id](https://github.com/Sparklingstadt/sparklingstadt-id) の OpenID Connect）のアカウントでメンバーとしてログインできます。任意の機能です。Web の `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET` の 3 つがそろっていないと、ボタンは出ません。

- sparklingstadt-id のリポジトリで `pnpm run oidc:client zhuelog` を実行してクライアントを登録します（redirect URI は `https://本番ドメイン/api/auth/callback/sid`、`postLogoutRedirectUris` は `https://本番ドメイン/signin`。手順は sparklingstadt-id の README）。
- Web に `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET` を入れます。`redirect_uri` は、`AUTH_URL` の origin に `/api/auth/callback/sid` を付けた値で、ID サーバーに登録した値と 1 文字も違わない必要があります。
- 管理者は、この道でログインする人です（`user.role` が `admin`）。管理者の `user` と、`sub` のつなぎ方は [docs/deployment.md](deployment.md) の「Better Auth への切り替え」にあります。メールアドレスが同じというだけでは、`user` につながりません。
- 詳しい手順は [docs/deployment.md](deployment.md) の「5. Sparklingstadt ID でのログイン」にあります。
- 手元で試すとき：sparklingstadt-id の README の「開発」では、`ID_ISSUER=http://localhost:3000` で `pnpm run dev` を動かします。この Web の `AUTH_URL` も `http://localhost:3000` なので、同じ手元では動きません。どちらかのポートを替えます（Web なら `pnpm exec next dev -p 3001` と `AUTH_URL=http://localhost:3001`。ID サーバーなら、`ID_ISSUER` のポートと `SID_ISSUER` を合わせます）。クライアントの `redirectUris` は `http://localhost:<Web のポート>/api/auth/callback/sid`、`postLogoutRedirectUris` は `http://localhost:<Web のポート>/signin` にします。

### ロールとID・パスワードのアカウント

ロールは4種類です。

- **admin（管理者）**: Sparklingstadt ID でログインする、`user.role` が `admin` の人。自分の学習ノート、CSVインポートとアカウント管理を使えます。メンバーになりすまして（画面は、そのメンバーとしてログインしているのと同じ）、その人の学習ノートを見られます。なりすましの間は、管理画面と AI の利用量は使えません。
- **member（メンバー）**: ID・パスワードでログインするアカウント、または Sparklingstadt ID でログインした人。自分の学習ノートとCSVインポートを使えます。CSVインポートは自分の学習ノートに追加されます。ほかのユーザーの記録は見られません。アカウント管理は使えません。
- **guest（ゲスト）**: ログイン画面の「ゲストとして使う」（`isAnonymous` の `user`）。学習ノートはなく、`/` には案内だけが出ます。`/logs` と `/follow` は `/` に戻されます。作ってから 24 時間たったゲストは、毎日のデモのリセットが消します。
- **banned**: Better Auth の `banned` が立った人。どのページも使えず、ログイン画面に戻されます。

ID・パスワードのmemberのアカウントは、管理者が `/admin/accounts` で作ります。セルフ登録はありません（Sparklingstadt ID のメンバーは、初めてログインしたときに作られます）。最初の管理者は、本番では切り替えのときに用意し（[docs/deployment.md](deployment.md) の「Better Auth への切り替え」）、手元では上の「手元で管理者になる」で作ります。

- **作成・再設定**: ログインID（英小文字・数字・`.` `_` `-` の3〜32文字）と表示名を入力します。パスワードは12〜128文字で、空欄にすると自動生成します。パスワードは作成・再設定の直後に一度だけ画面に表示され、あとから確認できません。管理者から本人に別の経路で伝えてください。
- **パスワード変更**: memberは、メニューの「パスワード変更」（`/account/password`）から自分で変更できます。変更するとログアウトされ、新しいパスワードでログインし直します。Sparklingstadt ID のメンバーには、この画面に Sparklingstadt ID のアカウントページへのリンクを出します（パスワードは ID サーバーで変えます）。
- **試行回数の制限**: Better Auth のレート制限だけで数えます（DB の `rateLimit`）。接続元（IPアドレス）ごとに、ID・パスワードのログインは15分に20回、パスワード変更は15分に5回までで、全体は1分に10回までです。アカウント単位ではロックしないので、ほかの場所からの失敗で本人が締め出されることはありません。接続元は Vercel が設定する `x-real-ip` を Better Auth が読みます。制限は `NODE_ENV=production` のときだけ働き、`pnpm run dev` では働きません。ログイン画面には、IDの有無や制限の状態を区別せず、決まった文だけを表示します。
- **セッションの失効**: パスワードを変更すると、そのアカウントのほかの端末のセッションが、すべて使えなくなります。管理者が再設定すると、そのアカウントのセッションはすべて消えます。ログインのセッションは Better Auth が DB の `session` に持ち、リクエストのたびに確認します。
- **パスワードの保存**: scrypt（N=2^15, r=8, p=1）でハッシュ化したものだけを保存します。平文はDBにもログにも残しません。
- **記録の持ち主**: memberの学習ノートは、`userId`（`user.id`、`user` への外部キー）に紐づきます。本人と、なりすましている管理者が見られます（詳細は「学習ノートの公開範囲」）。`user` を消すと、その人のデータも消えます。

**マイグレーションの適用**: 本番へのDBマイグレーションは、mainへのマージで走るWebの本番ビルドが自動で当てます。`vercel.json` の `buildCommand` が `scripts/vercel-build.sh` を動かし、`VERCEL_ENV=production` のときだけ `prisma migrate deploy` を実行してから `next build` します。Previewは自分のNeonブランチを使い、マイグレーションは当てません（[docs/deployment.md](deployment.md) の「2. Web の設定」の「Web のプレビュー（Preview）」を参照）。このためWebのProductionには `DATABASE_URL` が必要です（無い・つながらない・DDLが失敗すると、本番のWebのデプロイが失敗します）。ビルドのあいだは前のデプロイが動いているので、**マイグレーションは前のデプロイのコードと両立する形（表の追加、null許可の列の追加）にします**。列や表の削除のような壊す変更は、2回のリリースに分けます。以下の `migrate deploy` / `migrate status` の手順は、自動で当たらなかったときの手動の適用と、適用済みの確認に使います。詳しくは [docs/deployment.md](deployment.md) の「1. 本番の DB とマイグレーション」を参照してください。以下の各節にある「マージの前に適用」という記述は、自動化の前の手順なので、手動の適用として読んでください。

自動で当たらなかったときは、Vercelとリンク済みのmainのチェックアウトで、次の手順で本番DB（Neon）へ適用できます。`prisma.config.ts` は `.env` だけを読み込むので、`vercel env pull` だけでは本番の `DATABASE_URL` が使われません。`--environment=production` で取得したファイルを、`--env-file` で明示して渡します。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
rm .env.production.local
```

認可はProxyによるページ保護に加え、画面のServer ComponentとServer Actionでも検証します。データの権限は、Server Component・Server Action・Route Handler が、リクエストのたびに Better Auth のセッション（`auth.api.getSession`）から確かめます。

ログイン画面からは、ゲストとしてログインすることもできます。学習ノート・日付別ログ・CSVインポート・フォローは管理者・メンバー専用です。書き込み権限と記録の持ち主はServer Actionでも検証します。

開発用PostgreSQLはDockerホストの `127.0.0.1` にだけ公開されます。`.env` はGit管理対象外です。秘密情報をコミットせず、公開・漏洩した可能性がある場合は該当する認証情報を直ちに失効・再発行してください。

## 学習ノートの持ち主の本番への反映

（歴史の記録です。持ち主の列は、その後 `userId` に替わりました。いまの手順は [deployment.md](deployment.md) の「移行の記録」の「Better Auth への切り替え」にあります。）

mainはVercelの本番へ自動でデプロイされます。手順の順番を守ってください。

1. **マイグレーション** `20261008090000_learning_entry_owner`（`LearningEntry.ownerId` の追加）を本番DB（Neon）へ適用します。既存の学習ノートは、すべて持ち主 `219588180` のものになります。前節と同じ手順ですが、**Vercelとリンク済みのリポジトリで、このPRのブランチをチェックアウトして**実行してください。mainにはまだこのマイグレーションがないため、mainのまま実行すると「No pending migrations」と表示され、適用できたように見えてしまいます。

   ```bash
   git fetch origin
   git switch --detach origin/claude/per-user-learning-notes
   vercel env pull .env.production.local --environment=production --yes
   node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
   node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
   rm .env.production.local
   git switch main
   ```

   `migrate status` で `20261008090000_learning_entry_owner` が適用済みになっていること（「Database schema is up to date!」）を、マージの前に必ず確認してください。ブランチをほかの作業場所でチェックアウトしている場合に備え、`git switch --detach` で取得したコミットを直接開いています。

2. **マージし、Vercelの本番デプロイが Ready になるのを待ちます。**

3. **確認します。** 管理者としてCSVを1件インポートし、`/` を開いてそのノートが表示されることを確認します。DBで確認するには、NeonのSQL Editorで次を実行し、`219588180` が返ることを見ます。

   ```sql
   SELECT "ownerId" FROM "LearningEntry" ORDER BY "createdAt" DESC LIMIT 1;
   ```

**注意: 手順1から、手順2のVercelのデプロイが終わるまでの間は、CSVインポートが失敗します。** `ownerId` は必須の列で、今のコードはこの列に値を入れずに登録するため、登録できません。この間はCSVインポートを使わず、終わったあとにやり直してください。GitHub・パスワードでのログインと、ノートの閲覧は影響を受けません。

**ロールバック**: マージを取り消した（revertした）場合も、古いコードは `ownerId` を入れられないため、CSVインポートが失敗します。ブランチをもう一度マージするまでの間は、NeonのSQL Editorで次を実行して、既定の持ち主を付けてください。再マージして新しいコードを反映したら、`ALTER TABLE "LearningEntry" ALTER COLUMN "ownerId" DROP DEFAULT;` で戻します。マイグレーションとスキーマには `DEFAULT` を入れていません。

```sql
ALTER TABLE "LearningEntry" ALTER COLUMN "ownerId" SET DEFAULT '219588180';
```

## LINE・チャットのテーブルの削除

DBマイグレーション `20261020090000_drop_line_and_chat` は、LINEと管理者チャットを削除したあとに残っていたテーブル（`LineLearningJob`・`LineDevelopmentSession`・`ChatConversation`）を削除します。今のコードはどれも読み書きしないので、適用する前にデプロイしても、あとにデプロイしても動作は変わりません。**適用すると、保存されていたLINEのジョブとチャットの履歴は元に戻せません。** 残したいデータがあれば、先にNeonでバックアップを取ってください。手順は、パスワードアカウントの節と同じです（`vercel env pull` → `migrate deploy` → `migrate status`）。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
rm .env.production.local
```

## データ構造

- `ImportBatch`: インポートしたファイル名・件数・日時
- `LearningEntry`: 最初の文・添削後の文・ピンイン・持ち主（`userId`。`user.id` への外部キーで、`user` を消すと一緒に消える）
- `Hint`: 学習文に属する可変個数のヒントと表示順
- `user`・`session`・`account`・`verification`・`rateLimit`: Better Auth の表。`user` はログイン ID（`username`）・表示名（`name`）・役割（`role`）・ゲストか（`isAnonymous`）・`banned` を持つ。`session` はログインのセッション（トークン・期限・なりすまし元の `impersonatedBy`）。`account` は、会員のパスワードのハッシュ（`providerId` が `credential`）と、Sparklingstadt ID の `sub`（`providerId` が `sid`）を持つ。`rateLimit` はログインのレート制限のカウンター。セッションは会員・管理者・ゲストとも 30 日で、使うと延びる
- `SignInThrottle`: LINE の連携コードの入力の試行回数のカウンター（キー・回数・期限）。ログインでは使わない
- すべての持ち物の表（`LearningEntry`・`ReviewItem`・`AiUsage`・`LineLink`・`Follow` など）は、`userId` で `user` につなぐ

インポートはファイル単位のトランザクションです。途中の行でエラーになった場合、そのファイルのデータは1件も保存されません。

## セキュリティ

ページの保護は `src/proxy.ts` と各Server Componentで、書き込みはServer Action内で再検証します。管理者かどうかは、Web がリクエストのたびに Better Auth のセッションの `user.role` から確認します。リモートPostgreSQL接続は `sslmode=verify-full` に統一し、証明書とホスト名を検証します。

HTMLにはリクエストごとのnonce付きCSPを設定します。ログの秘匿化、監査範囲と制約は [2026-09-24 セキュリティレビュー](security-review-2026-09-24.md) を参照してください（AI機能はその後削除しました）。

## Seedデータ

個人の学習ノートを公開リポジトリへ含めないよう、実データはGit管理外の `prisma/seed.private.json` に保存します。

```bash
cp prisma/seed.example.json prisma/seed.private.json
pnpm run db:seed
```

各エントリには固定IDと登録日時を指定します。seedは同じID、または同じ本文・添削文・ピンインの組み合わせを検出してスキップするため、再実行しても重複しません。公開してよいダミーデータの形式は [`prisma/seed.example.json`](../prisma/seed.example.json) で確認できます。

## Playwright E2E

Node.js 24 または 26、起動済みのDocker（Compose v2）が必要です。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:e2e
# 対話的な実行
pnpm run test:e2e:ui
# 終了後、専用DBを停止・破棄（テストデータのみ）
pnpm run test:e2e:stop
```

Desktop Chromiumとモバイル幅（Pixel 7 / Chromium）の両方で検証します。リダイレクト、入力の検査、権限、HTTPヘッダー、webhookやCronがDBに書く内容のように、画面幅で結果が変わらないテストには `anyWidth`（`e2e/fixtures.ts`、`@any-width` タグ）を付け、Desktop Chromiumだけで実行します。メニューを通るテストと、画面に収まるかを見るテストには付けません。
テスト起動時に専用PostgreSQLを起動し、既存マイグレーションを適用してTurbopackでビルド、`127.0.0.1:3107`に本番モードのサーバーを起動します。
既存サーバーは再利用しません。通常の開発サーバーは停止してから実行してください（ビルド先の`.next`を共有します）。

- 認証前のリダイレクト、ゲストログイン／ログアウト、外部URLへのリダイレクト拒否
- ID・パスワードのアカウント（管理者による作成、作成直後のパスワード表示（再表示できない旨の注記つき）、memberのログイン、アカウント管理画面の拒否、ログイン失敗の共通メッセージ、別の接続元からの5回失敗では本人がロックされないこと、再設定によるセッション失効、パスワード変更）
- ゲストへの学習ノートの非表示・CSV操作の拒否（古い管理者フォームからの投稿も拒否）
- CSVの登録・リロード後の永続化・可変ヒント・BOM・引用符・改行・入力エラー
- 日付一覧・ノート詳細・前後移動・JST日付境界・無効なURL・折り畳み
- ユーザーごとの記録（memberは自分の記録だけが見え番号も別々、管理者は切り替え欄でmemberの記録を閲覧のみで見られる、memberの `?user=` は自分に戻される）
- ゴミ箱（詳細からゴミ箱に入れると一覧・ホーム・日付一覧から消えて番号が振り直される、元に戻す、確認つきの完全に削除とゴミ箱を空にする、確認のキャンセル、管理者が他人を表示中は操作できず他人のゴミ箱も見られない、320px幅で横スクロールしない）

DBは`127.0.0.1:55439/zhuelog_e2e`に固定され、`compose.e2e.yaml`の専用コンテナだけを使用します。
各テスト前にこのDBの学習データを初期化します。ポート55439を別のDBに割り当てないでください。
通常の`DATABASE_URL`と実際のOAuth情報は使用しません。
管理者は、テストが DB に作った管理者の `user` を、Sparklingstadt ID のスタブの `sub` につないでから、画面から Sparklingstadt ID でログインして作ります（`asAdmin`）。本番コードに認証バイパスは追加していません。
本物の Sparklingstadt ID への外部ログインは、このE2Eの対象外です（スタブで確かめます）。

失敗時のスクリーンショット・トレースは`test-results/`、HTMLレポートは`playwright-report/`に出力されます（Git管理外）。
`pnpm exec playwright show-report`で結果を確認できます。
設定の参考：[Playwright webServer](https://playwright.dev/docs/test-webserver)。

## コミット・プッシュ前のチェック（Lefthook）

`pnpm install --frozen-lockfile` / `pnpm install`でGitフックを自動設定します。再設定は`pnpm run hooks:install`です。CI・Vercel・Git管理外ではインストールをスキップします。

| タイミング | 順番に実行する処理                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| コミット前 | ステージ済みファイルのPrettier自動整形 → ESLint（警告もエラー）→ Next.js型生成・TypeScript型チェック |
| プッシュ前 | ESLint → 型チェック → 単体テスト → Playwright E2E（Desktop / Mobile）                                |

どれかが失敗するとコミット／プッシュを中止します。自動整形の結果はステージへ反映されます。部分ステージしたファイルの未ステージ部分はLefthookが一時退避・復元します。ただしLint・型チェック・E2Eは作業ツリー全体を対象とし、コミット済みスナップショットだけの検証ではありません。

プッシュには起動済みDockerとPlaywright Chromiumが必要です。上のE2E手順で準備し、`.next`の競合を避けるため開発サーバーを停止してください。フック終了時は成功・失敗にかかわらず専用E2Eコンテナを停止します。E2Eの手動実行との同時使用は避けてください。

既存コード全体の一括整形は行わず、コミット対象から段階的に整形します。生成コード・ロックファイル・秘密情報・テストレポートは整形対象外です。手動の全体整形は`pnpm run format`、全体の整形確認は`pnpm run format:check`（移行中は既存ファイルで失敗し得ます）、個別チェックは`pnpm run lint`と`pnpm run typecheck`で実行できます。

## pnpm移行の回帰テスト

`pnpm install --frozen-lockfile` 後、`pnpm run test:regression` で既存機能の検証を実行します。同じ検査は、GitHub Actions の `verify`（`.github/workflows/verify.yml`）がプルリクエストと main でも走らせます（`pnpm audit` も足しています）。`package.json` の `engines` は `24.x` です（Vercel はまだ Node 26 に対応していないため）。
ブラウザーテストの前に `pnpm exec playwright install chromium` を実行してください。Webの回帰テストは本番ビルドを使い、既存サーバーを再利用しません。
