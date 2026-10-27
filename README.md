# 学习録

開発には `package.json` で指定した pnpm 11.25.0 を使用します。`corepack enable` 後、`pnpm install --frozen-lockfile` で依存関係をインストールしてください。

添削前後の中国語、ピン音、可変個数の学習ヒントをCSVから取り込んで表示する、Next.js製の中国語学習アプリです。

## 技術構成

- Next.js 16（App Router / Server Actions）
- Go API（`services/api/`）: ログイン（GitHub OAuth / ID・パスワード / ゲスト）と、学習ノートの読み書き
- PostgreSQL 17（読み書きするのは Go API だけ）
- Prisma ORM 7（スキーマとマイグレーション、seed）
- shadcn/ui + Tailwind CSS 4

## アーキテクチャ

コードは依存関係が内側へ向くよう、機能別の関心事を層に分けています。

```text
src/
├── domain/          # エンティティ、値オブジェクト、リポジトリの契約
├── application/     # ユースケースと外部サービスのポート
├── infrastructure/  # Go API の呼び出し、Cookie、設定の実装
├── presentation/    # 画面部品、Server Action、コントローラー
├── composition/     # 実装を組み立ててユースケースを公開
└── app/             # Next.js App Routerのエントリーポイント
```

`domain` はフレームワークやデータベースに依存せず、`application` はドメインの契約だけを利用します。外部サービス固有のコードは `infrastructure` に閉じ込め、`composition` で依存性を注入します。

層の間の依存は、次のルールをESLintと `tests/architecture.test.ts` で検査します。

- `domain`・`application` から外側の層（`@/infrastructure` など）、Next.js、React、Prismaを import しない
- `domain` から `application` を import しない

## 起動方法

前提: Node.js 24 または 26、Docker Desktop、Go（`services/api/go.mod` の版）

Web は DB に直接つながらず、ログインも学習ノートの読み書きも Go API で行います。手元では、ローカル専用の Go API（[docs/api-local.md](docs/api-local.md)）を使います。

```bash
cp .env.example .env
pnpm install
pnpm run api:db    # Go API 用の DB を起動し、マイグレーションとサンプルデータを入れる
pnpm run api:dev   # Go API を 127.0.0.1:8081 で起動（起動したまま、別のターミナルで次へ）
pnpm run dev
```

ブラウザで <http://localhost:3000> を開き、ゲストか、サンプルの会員（`docs/api-local.md` の表）でログインします。GitHub ログインは本物の OAuth App が要るので、手元では使えません。

`.env` の `GO_API_URL`・`API_WEB_PROXY_SECRET`・`AUTH_URL`・`AUTH_GITHUB_ID` が Web の設定です（FFPF ID を試すときは `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID` も）。`DATABASE_URL` は Prisma のマイグレーションと seed だけが使います（`docker compose up -d` の開発用 DB）。

## 認証・認可の設定

ログインは Go API が行います。Web の Vercel プロジェクトに入れる値は `GO_API_URL`・`API_WEB_PROXY_SECRET`・`AUTH_URL`・`AUTH_GITHUB_ID` の 4 つです（FFPF ID を使うときは、下の「FFPF ID でのログイン」の 2 つも）。Go API に入れる値も含めて、手順は [docs/api-deployment.md](docs/api-deployment.md) の「6. Web の設定」にあります。

GitHubの **Settings → Developer settings → OAuth Apps** で、Web 用のOAuth Appを作成します。

- Homepage URL: `https://本番ドメイン`
- Authorization callback URL: `https://本番ドメイン/api/auth/callback/github`（実際の callback は、この下の `/api/auth/callback/github/go` です）

Client ID は Web の `AUTH_GITHUB_ID` と Go API の `GITHUB_WEB_CLIENT_ID` に、Client Secret は Go API の `GITHUB_WEB_CLIENT_SECRET` だけに入れます。

管理者の許可リストは、Go API の `AUTH_ALLOWED_GITHUB_IDS` です。GitHubユーザーの **数字のID** をカンマ区切りで並べます。IDは `https://api.github.com/users/<ログイン名>` の `id` で確認できます。ログイン名は使いません。ログイン名は変更でき、空いた名前を別人が取得できるためです。空の場合は安全側に倒し、すべてのGitHubユーザーを拒否します。

### FFPF ID でのログイン

ログイン画面の「FFPF IDでログイン」から、FFPF ID（ffpf-portal の OpenID Connect）のアカウントでメンバーとしてログインできます。任意の機能です。Web の `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID` が無ければボタンは出ません（Web は自分の 2 つの変数だけを見ます）。Go API の設定が無いままボタンを出すと、押してもログインは `503` で失敗するので、Web と Go API の両方に入れてください。

- portal で `pnpm run oidc:client zhuelog` を実行してクライアントを登録します（redirect URI は `https://本番ドメイン/api/auth/callback/ffpf`。手順は ffpf-portal の README）。
- Web には `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID` を、Go API には `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET`・`FFPF_ID_REDIRECT_URI` を入れます。Client Secret は Go API だけに入れます。
- 本番 DB にマイグレーション `20261027120000_add_ffpf_accounts`（`FfpfAccount` の追加）が必要です。main へのマージで Web の本番ビルドが自動で当てます（下の「マイグレーションの適用」）。
- 詳しい手順は [docs/api-deployment.md](docs/api-deployment.md) の「9. FFPF ID でのログイン」にあります。

### ロールとID・パスワードのアカウント

ロールは4種類です。

- **admin（管理者）**: GitHub認証で許可リストに載っているユーザー。自分の学習ノート、CSVインポートとアカウント管理を使えます。メンバーの学習ノートは、切り替え欄から閲覧のみで見られます。
- **member（メンバー）**: ID・パスワードでログインするアカウント、または FFPF ID でログインした人。自分の学習ノートとCSVインポートを使えます。CSVインポートは自分の学習ノートに追加されます。ほかのユーザーの記録は見られません。アカウント管理は使えません。
- **guest（ゲスト）**: ログイン画面の「ゲストとして使う」。学習ノートはなく、`/` には案内だけが出ます。`/logs` と `/follow` は `/` に戻されます。
- **revoked**: 許可リストから外れた管理者や、再設定・変更でセッションが失効したメンバー。どのページも使えず、ログイン画面に戻されます。

ID・パスワードのmemberのアカウントは、GitHub管理者が `/admin/accounts` で作ります。セルフ登録はありません（FFPF ID のメンバーは、初めてログインしたときに作られます）。最初のアカウントも、まずGitHubで管理者としてログインして作成してください。

- **作成・再設定**: ログインID（英小文字・数字・`.` `_` `-` の3〜32文字）と表示名を入力します。パスワードは12〜128文字で、空欄にすると自動生成します。パスワードは作成・再設定の直後に一度だけ画面に表示され、あとから確認できません。管理者から本人に別の経路で伝えてください。
- **パスワード変更**: memberは、ヘッダーの「パスワード変更」（`/account/password`）から自分で変更できます。変更するとログアウトされ、新しいパスワードでログインし直します。FFPF ID のメンバーには、この画面に FFPF ID のマイページへのリンクを出します（パスワードは portal で変えます）。
- **試行回数の制限**: 接続元（IPアドレス。IPv6は /64 単位）ごとに数えます。同じ接続元から同じログインIDへ15分間に5回まで、ログインID全体で15分間に20回までです。超えると、その接続元からは15分間、正しいパスワードでもログインできません。アカウント単位ではロックしないので、ほかの場所からの失敗で本人が締め出されることはありません。接続元は Vercel が設定する `x-real-ip` / `x-forwarded-for` で判定し、Web が Go API に渡します。回数は Go API が DB のテーブル（`SignInThrottle`）で数えます。ログイン画面には、IDの有無や制限の状態を区別せず「IDまたはパスワードが違うか、一時的にロックされています。」とだけ表示します。パスワード変更画面の現在のパスワードも、アカウントごとに15分間5回までです。
- **セッションの失効**: パスワードを再設定・変更すると、そのアカウントの既存のセッションは、すべて使えなくなります。セッションの有効性（`sessionVersion`）は、Go API がリクエストのたびにDBで確認します。
- **パスワードの保存**: scrypt（N=2^15, r=8, p=1）でハッシュ化したものだけを保存します。平文はDBにもログにも残しません。
- **記録の持ち主**: memberの学習ノートは、所有者 `password:<アカウントID>`（FFPF ID のメンバーは `ffpf:<sub>`）に紐づきます。本人と管理者が見られます（詳細は「学習ノートの公開範囲」）。

**マイグレーションの適用**: 本番へのDBマイグレーションは、mainへのマージで走るWebの本番ビルドが自動で当てます。`vercel.json` の `buildCommand` が `scripts/vercel-build.sh` を動かし、`VERCEL_ENV=production` のときだけ `prisma migrate deploy` を実行してから `next build` します。Previewのビルドは本番と同じDBを使うので、マイグレーションは当てません。このためWebのProductionには `DATABASE_URL` が必要です（無い・つながらない・DDLが失敗すると、本番のWebのデプロイが失敗します）。Go APIは別プロジェクトで、あとから手でデプロイするので、**マイグレーションは今動いているGo APIと両立する形（表の追加、null許可の列の追加）にします**。列や表の削除のような壊す変更は、2回のリリースに分けます。以下の `migrate deploy` / `migrate status` の手順は、自動で当たらなかったときの手動の適用と、適用済みの確認に使います。詳しくは [docs/api-deployment.md](docs/api-deployment.md) の「4. 本番の DB の確認」を参照してください。以下の各節にある「マージの前に適用」という記述は、自動化の前の手順なので、手動の適用として読んでください。

パスワードアカウントのために新しい環境変数は要りません。ただしDBマイグレーション `20261007090000_password_accounts`（`PasswordAccount` テーブルの追加）が必要です。Vercelとリンク済みのmainのチェックアウトで、次の手順で本番DB（Neon）へ適用できます。`prisma.config.ts` は `.env` だけを読み込むので、`vercel env pull` だけでは本番の `DATABASE_URL` が使われません。`--environment=production` で取得したファイルを、`--env-file` で明示して渡します。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
rm .env.production.local
```

適用前にデプロイすると、ID・パスワードでのログインと `/admin/accounts` だけがエラーになります。GitHubログインとゲストログインは影響を受けません。

認可はProxyによるページ保護に加え、画面のServer ComponentとServer Actionでも検証します。データの権限は、最後に Go API が確かめます。

ログイン画面からは、GitHub認証を使わずゲストとしてログインすることもできます。学習ノート・日付別ログ・CSVインポート・フォローは管理者・メンバー専用です。書き込み権限と記録の持ち主はServer Actionでも検証します。

開発用PostgreSQLはDockerホストの `127.0.0.1` にだけ公開されます。`.env` はGit管理対象外です。秘密情報をコミットせず、公開・漏洩した可能性がある場合は該当する認証情報を直ちに失効・再発行してください。

## ネイティブアプリ向け API

`services/api/` に、ネイティブアプリ（iOS など）と Web が使う Go 製 API があります。Web とは別の Vercel プロジェクトとして動かし、本番の Neon を読み書きします。ローカルでのテストは `pnpm run test:unit` に含まれます（DB を使うテストは `API_TEST_DATABASE_URL` が無いと skip されます）。Vercel の準備、モバイル用 GitHub OAuth App の登録、本番へのマイグレーション適用、デプロイの手順は [docs/api-deployment.md](docs/api-deployment.md) を参照してください。手元で API を起動して試す手順（`pnpm run api:db` → `pnpm run api:dev` → `pnpm run api:smoke`）は [docs/api-local.md](docs/api-local.md) にあります。

## 表示テーマ

全ページ右上の「システム / ライト / ダーク」から切り替えられます。初期値は「システム」で、OSの配色変更にも自動で追従します。手動で選んだテーマだけを端末の `zhuelog:theme:v1` に保存し、再読み込み・ページ移動・同じブラウザーの別タブでも反映します。DBやアカウントには保存しません。

ブラウザーの保存が制限されている場合でも、その画面での切り替えは利用できます。初期配色はCSP nonce付きの固定スクリプトで本文表示前に適用し、ライト画面が一瞬表示されるのを防ぎます。

## 学習ノートの公開範囲

学習ノートは、ユーザーごとの個人の記録です（本人が共有したノートだけ、フォロワーが読めます）。

- **本人**: 自分の学習ノート・日付別ログだけを見られます。番号（`#1` やその日の n 件目）も持ち主ごとに数えます。memberが `?user=` に他人を指定しても、自分の記録のページに戻されます。
- **管理者**: 自分の記録に加えて、ヘッダー下の切り替え欄（「表示するユーザー」）でmemberを選ぶと、そのユーザーの学習ノート・日付別ログを見られます。閲覧のみで、「〇〇さんの記録を表示中（閲覧のみ）」のバナーを出し、CSVのインポート・エクスポートへのリンクは出しません。日付や詳細へのリンクでも `?user=` を引き継ぎます。
- **ゲスト**: 記録を持ちません。`/logs`・`/import`・`/export` は `/` に戻されます。
- **フォロワー**: フォロー中のメンバーが共有した学習ノートだけを `/follow` で読めます。
- **CSVインポート**（`/import`）: `?user=` に関わらず、ログイン中のユーザー自身の学習ノートに登録します。
- **CSVエクスポート**（`/export`）: ログイン中のユーザー自身の学習ノートから選んだものを、インポートと同じ形式のCSV（UTF-8、BOM付き）でダウンロードします。書き出したファイルは、そのままインポートし直せます。

## 学習ノートの持ち主の本番への反映

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

## 学習ノートのゴミ箱

自分の学習ノートは、消すとまずゴミ箱に入り、あとから元に戻せます。

- **ゴミ箱に入れる**: 学習ノートの詳細画面（`/logs/年/月/日/番号`）の「ゴミ箱に入れる」を押します。確認はありません。その日の一覧に戻り、「ゴミ箱に入れました。ゴミ箱から元に戻せます。」と表示されます。
- **ゴミ箱の中身**: ホームの最近のノート、日付一覧、その日の一覧、詳細、フォローのタイムラインのどこにも出ません。その日の番号と件数は、ゴミ箱にないノートだけで数え直します。
- **ゴミ箱を開く**: 日付一覧とその日の一覧の「ゴミ箱」から開きます（`/logs/trash`）。ゴミ箱に入れた日時の新しい順に、100件まで表示します。
- **元に戻す・完全に削除**: ゴミ箱の各ノートの「元に戻す」で元の日付に戻ります。「完全に削除」と「ゴミ箱を空にする」は確認のあとDBから消え、元に戻せません。ゴミ箱は自動では空になりません。
- **公開範囲**: 自分のノートだけを操作できます。管理者が他人の記録を表示しているときは、「ゴミ箱に入れる」も「ゴミ箱」も出ません。ゴミ箱の画面は `?user=` を読まず、常に自分のゴミ箱を表示します。

### 本番への反映

DBマイグレーション `20261008120000_add_note_trash`（`LearningEntry` に `deletedAt` 列を追加）が必要です。null を許す列を足すだけなので、今のコードのまま先に適用しても動作は変わりません。マージの前に、Vercelとリンク済みのリポジトリで、このPRのブランチを `git switch --detach` で開いて、前節と同じ手順（`vercel env pull` → `migrate deploy` → `migrate status`）で本番DB（Neon）へ適用し、`migrate status` で適用済みになっていることを確認してください。

マージを取り消した（revertした）場合、古いコードは `deletedAt` を見ないため、ゴミ箱に入っていたノートが一覧に戻って見えます。データは消えません。

## フォローと学習ノートの共有

メンバーは、ほかのメンバーをフォローして、相手が共有した学習ノートだけを読めます。

- **だれがフォローできるか**: メンバーと管理者が、ヘッダーの「フォロー」（`/follow`）からフォローできます。ゲストはフォローの画面を開けず、`/` に戻されます。
- **だれをフォローできるか**: メンバーだけです。管理者はDBに行がないため、一覧に出ず、フォローされません。自分自身もフォローできません。
- **一覧に出る情報**: 表示名だけです。ログインIDはログイン情報の半分にあたるため、ほかのメンバーには見せません（管理者は `/admin/accounts` で確認できます）。
- **共有の切り替え**: メンバーが自分の学習ノートの詳細画面（`/logs/年/月/日/番号`）で「共有する」「共有をやめる」を押します。共有中のノートには「共有中（フォロワーが見られます）」と表示されます。ノートは最初は共有されません。管理者が他人の記録を表示しているときは、共有のボタンは出ません。
- **タイムライン**: `/follow` の「フォロー中の人の共有ノート」に出るのは、フォロー中の人が共有中で、ゴミ箱にない学習ノートだけです。登録日時の新しい順に、最新100件まで表示します。ノートの詳細ページへのリンクは出しません。
- **フォロー関係**: 一覧の「フォローされています」で、自分をフォローしている人が分かります。「フォロー中 N人・フォロワー N人」の人数も同じ画面に出ます。管理者のフォローは、フォロワーの人数にだけ数えます。

### 本番への反映

DBマイグレーション `20261010000353_add_follows_and_shared_notes`（`Follow` テーブルの追加と、`LearningEntry` への `sharedAt` 列の追加）が必要です。マージの前に、Vercelとリンク済みのリポジトリで、このPRのブランチを `git switch --detach` で開いて、パスワードアカウントの節と同じ手順で本番DB（Neon）へ適用してください。

## LINE 連携

LINE に中国語や日本語の文を送ると、OpenAI（ChatGPT）で添削・翻訳し、送った人の学習ノートに追加します。会員と管理者が、それぞれ自分の LINE を結びつけて使います（ゲストは使えません）。Go API（`services/api/`）の `/v1/line/*` で動きます。

- **結びつけ**: Web の `/account/line`（ヘッダーの「LINE 連携」）で「連携コードを出す」を押し、出た 8 文字のコード（10 分で切れます）を LINE の公式アカウントに送ります。同じ画面から連携を解除できます。
- **添削と翻訳**: 漢字だけの文は添削、ひらがなやカタカナを含む文は中国語への翻訳です。結果は LINE に返信され、学習ノートに保存されます（翻訳は `kind=translation`）。500 文字までです。
- **結びついていない LINE**: 送った文は学習ノートにも OpenAI にも届きません。
- **失敗したとき**: 時間切れなどで結果が出なかった文は、1 日 1 回の Cron（毎日 06:00 JST）が 1 回だけ試し直し、できた結果か失敗を LINE に送ります。
- **設定**: Go API に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`（LINE を使うときは 3 つとも）と `CRON_SECRET`、Web に `LINE_ADD_FRIEND_URL`（友だち追加のリンク。無くても動きます）を入れます。設定が空のときは LINE 連携は使えず、画面には「LINE 連携は今は使えません。」と出ます。ローカルでは使えません。
- **本番への反映**: DBマイグレーション `20261023090000_add_line_link`（`LineLink`・`LineLinkCode`・`LineMessage` の追加）を、**main へのマージの前に** 本番のNeonへ適用してください。LINE の Webhook URL の設定など、切り替えの手順は [docs/api-deployment.md](docs/api-deployment.md) の「7. LINE 連携」にあります。

## ChatGPT との会話練習

管理者は `/chat`（ホームとヘッダーの「ChatGPT と話す」）で ChatGPT と中国語の会話練習ができます。会員とゲストには出ません。Go API（`services/api/`）の `POST /v1/chat` と `/v1/conversations` で動きます。

- **会話**: 回答は少しずつ表示されます。停止ボタンで止められます。途中で切れた回答は保存せず、その発言は入力欄に戻ります。
- **会話ノート**: 回答が届くたびに、会話をまるごと保存します。`/conversations` で話した日（日本時間）ごとに見返せ、「続きを話す」で続きから話せます。削除もできます（ゴミ箱はありません）。
- **上限**: 1 つの会話は 40 発言・合計 4 万字までです。上限に達した会話は読むだけになります。
- **設定**: Go API に `OPENAI_API_KEY`（と任意で `OPENAI_CHAT_MODEL`）を入れます。空のときは画面に「ChatGPT が設定されていません」と出ます。
- **本番への反映**: DBマイグレーション `20261024090000_add_chat_conversations`（`ChatConversation` の追加）を、**main へのマージの前に** 本番のNeonへ適用してください。手順は [docs/api-deployment.md](docs/api-deployment.md) の「8. 会話練習（ChatGPT）」にあります。

## 介詞の練習

`/practice/prepositions`（ヘッダーの「介詞練習」）で、名詞と日本語の意味に合う介詞を 4 つから選ぶ練習が 25 問ずつできます。ゲストも練習できます。

- **練習中**: 正答率（1 回目で正解した問題の割合）・ミス数（間違えて選んだ回数）・経過時間を問題の上に出します。
- **結果**: 25 問を解き終えると、正答率・ミス数・経過時間と、ミスした問題（正解と、間違えて選んだ介詞）を出します。
- **記録**: 会員と管理者の結果は、解き終えたときに Go API の `/v1/preposition-records` へ保存します。`/practice/prepositions/records`（練習画面の「過去の記録」）で新しい順に見返せ、1 件ずつ全問の結果も見られます。ゲストの練習は記録に残りません。
- **本番への反映**: DBマイグレーション `20261024150000_add_preposition_practice_records`（`PrepositionPracticeRecord` の追加）を、**main へのマージの前に** 本番のNeonへ適用してください（`vercel env pull` → `migrate deploy` → `migrate status`）。

## LINE・チャットのテーブルの削除

DBマイグレーション `20261020090000_drop_line_and_chat` は、LINEと管理者チャットを削除したあとに残っていたテーブル（`LineLearningJob`・`LineDevelopmentSession`・`ChatConversation`）を削除します。今のコードはどれも読み書きしないので、適用する前にデプロイしても、あとにデプロイしても動作は変わりません。**適用すると、保存されていたLINEのジョブとチャットの履歴は元に戻せません。** 残したいデータがあれば、先にNeonでバックアップを取ってください。手順は、パスワードアカウントの節と同じです（`vercel env pull` → `migrate deploy` → `migrate status`）。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
rm .env.production.local
```

## 日付別の学習ログ

学習ノートの登録日時は日本時間（JST）で表示します。`/logs` から登録日を選び、日別一覧とその日の連番詳細を開けます。

- 日別一覧: `/logs/2026/9/20`
- その日の2件目: `/logs/2026/9/20/2`

## 学習カードの表示

学習ノートと日付別ログのカードでは、最初の文と添削後の文を文字単位で比べ、削除された文字（赤の取り消し線）と追加された文字（緑の下線）を表示します。続けて変わった文字は1箇所に数え、見出しに「N箇所を添削」と表示します。大きく書き換えた文では、書き換えの間にたまたま残った短い共通部分（前後の書き換えの半分以下の長さ、または長めの書き換えに隣接する1文字）を書き換えに含め、差分が細切れにならないようにします。ヒントは番号付きの「覚えるポイント」として並べます。差分は `<del>` / `<ins>` で表し、文のテキスト自体は変えないため、コピーや検索にはそのままの文が使われます。比較する部分が約500文字を超える場合は、処理時間を抑えるため、その部分を1つの書き換えとして表示します。

## CSV形式

UTF-8のCSVを利用します。ヘッダー行は省略可能です。

```csv
最初の文,添削後の文,ピン音,ヒント1,ヒント2,...
我昨天去图书馆了。,我昨天去了图书馆。,Wǒ zuótiān qù le túshūguǎn.,場所の前では「去」を使う,動作完了の「了」
```

- 1〜3列目は必須です。
- 4列目以降の空でないセルは、すべて順番付きのヒントとして保存します。
- 「最初の文 / 添削後の文 / ピン音」のほか、「原文 / 添削文 / 拼音」または英語ヘッダーにも対応します。
- 1ファイル4MB、1回1,000行までです。
- 1項目1万文字・1行10万文字・ヒント100個までです（行ごとに個数を変えられます）。
- サンプルは [`examples/sample.csv`](examples/sample.csv) にあります。

## データ構造

- `ImportBatch`: インポートしたファイル名・件数・日時
- `LearningEntry`: 最初の文・添削後の文・ピン音・所有者（GitHubの数字のID、`password:<アカウントID>`、または `ffpf:<sub>`）
- `Hint`: 学習文に属する可変個数のヒントと表示順
- `PasswordAccount`: ID・パスワードのアカウント（ログインID・表示名・パスワードのハッシュ・`sessionVersion`）。`failedAttempts`・`lockedUntil` は旧ロック用で、今は使っていません
- `FfpfAccount`: FFPF ID でログインしたメンバー（`sub`・メールアドレス・表示名・`sessionVersion`・最終ログイン日時）。ログインのたびに最新の値で更新します
- `SignInThrottle`: ログイン試行回数の制限用のカウンター（キー・回数・期限）。Go API が使います

インポートはファイル単位のトランザクションです。途中の行でエラーになった場合、そのファイルのデータは1件も保存されません。

## セキュリティ

ページの保護は `src/proxy.ts` と各Server Componentで、書き込みはServer Action内で再検証します。管理者の許可リストは、Go API がリクエストのたびに確認します。リモートPostgreSQL接続は `sslmode=verify-full` に統一し、証明書とホスト名を検証します。

HTMLにはリクエストごとのnonce付きCSPを設定します。ログの秘匿化、監査範囲と制約は [2026-09-24 セキュリティレビュー](docs/security-review-2026-09-24.md) を参照してください（AI機能はその後削除しました）。

## Seedデータ

個人の学習ノートを公開リポジトリへ含めないよう、実データはGit管理外の `prisma/seed.private.json` に保存します。

```bash
cp prisma/seed.example.json prisma/seed.private.json
pnpm run db:seed
```

各エントリには固定IDと登録日時を指定します。seedは同じID、または同じ本文・添削文・ピン音の組み合わせを検出してスキップするため、再実行しても重複しません。公開してよいダミーデータの形式は [`prisma/seed.example.json`](prisma/seed.example.json) で確認できます。

## Playwright E2E

Node.js 24 または 26、起動済みのDocker（Compose v2）、Go（`services/api/go.mod` の版）が必要です。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:e2e
# 対話的な実行
pnpm run test:e2e:ui
# 終了後、専用DBを停止・破棄（テストデータのみ）
pnpm run test:e2e:stop
```

Desktop Chromiumとモバイル幅（Pixel 7 / Chromium）の両方で検証します。
テスト起動時に専用PostgreSQLを起動し、既存マイグレーションを適用してTurbopackでビルド、`127.0.0.1:3107`に本番モードのサーバーを起動します。Go API（`services/api`）もビルドして `127.0.0.1:3108` で起動し、Web はこれを通してログインとデータの読み書きを行います。
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
管理者セッションはテスト側で実行ごとのランダムな秘密鍵を使って作成します。本番コードに認証バイパスは追加していません。
GitHub OAuthの外部ログインは、このE2Eの対象外です。

失敗時のスクリーンショット・トレースは`test-results/`、HTMLレポートは`playwright-report/`に出力されます（Git管理外）。
`pnpm exec playwright show-report`で結果を確認できます。GitHub Actionsにも同じE2Eを追加しています。
設定の参考：[Playwright webServer](https://playwright.dev/docs/test-webserver)。

## コミット・プッシュ前のチェック（Lefthook）

`pnpm install --frozen-lockfile` / `pnpm install`でGitフックを自動設定します。再設定は`pnpm run hooks:install`です。CI・Vercel・Git管理外ではインストールをスキップします。

| タイミング | 順番に実行する処理                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| コミット前 | ステージ済みファイルのPrettier自動整形 → ESLint（警告もエラー）→ Next.js型生成・TypeScript型チェック |
| プッシュ前 | ESLint → 型チェック → Playwright E2E（Desktop / Mobile）                                             |

どれかが失敗するとコミット／プッシュを中止します。自動整形の結果はステージへ反映されます。部分ステージしたファイルの未ステージ部分はLefthookが一時退避・復元します。ただしLint・型チェック・E2Eは作業ツリー全体を対象とし、コミット済みスナップショットだけの検証ではありません。

プッシュには起動済みDockerとPlaywright Chromiumが必要です。上のE2E手順で準備し、`.next`の競合を避けるため開発サーバーを停止してください。フック終了時は成功・失敗にかかわらず専用E2Eコンテナを停止します。E2Eの手動実行との同時使用は避けてください。

既存コード全体の一括整形は行わず、コミット対象から段階的に整形します。生成コード・ロックファイル・秘密情報・テストレポートは整形対象外です。手動の全体整形は`pnpm run format`、全体の整形確認は`pnpm run format:check`（移行中は既存ファイルで失敗し得ます）、個別チェックは`pnpm run lint`と`pnpm run typecheck`で実行できます。

## pnpm移行の回帰テスト

`pnpm install --frozen-lockfile` 後、`pnpm run test:regression` で既存機能の検証を実行します。GitHub Actions では同じ内容を CI ワークフローが並列で実行します（`verify` と `e2e` を、本番の Vercel と同じ Node 24 で実行）。`package.json` の `engines` は `24.x` です（Vercel はまだ Node 26 に対応していないため）。
ブラウザーテストの前に `pnpm exec playwright install chromium` を実行してください。Webの回帰テストは本番ビルドを使い、既存サーバーを再利用しません。
