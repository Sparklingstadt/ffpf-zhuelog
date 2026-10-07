# 学习録

開発には `package.json` で指定した pnpm 11.25.0 を使用します。`corepack enable` 後、`pnpm install --frozen-lockfile` で依存関係をインストールしてください。

添削前後の中国語、ピン音、可変個数の学習ヒントをCSVから取り込んで表示する、Next.js製の中国語学習アプリです。

## 技術構成

- Next.js 16（App Router / Server Actions）
- PostgreSQL 17
- Prisma ORM 7
- shadcn/ui + Tailwind CSS 4
- Auth.js v5（GitHub OAuth / ID・パスワード）
- Vercel AI SDK + OpenAI Responses API

## アーキテクチャ

pnpm workspaces のモノレポです。ルートの Next.js アプリ（`@ffpf-zhuelog/web`）が、`packages/` のパッケージを使います。パッケージはビルドせず、TypeScript のまま読み込みます。

```text
.
├── src/                          # Next.js アプリ（@ffpf-zhuelog/web）
├── packages/
│   ├── core/                     # @ffpf-zhuelog/core
│   └── typle-integrate-plugin/   # @ffpf-zhuelog/typle-integrate-plugin
```

コードは依存関係が内側へ向くよう、機能別の関心事を層に分けています。

```text
packages/core/src/
├── domain/          # エンティティ、値オブジェクト、リポジトリの契約
├── application/     # ユースケースと外部サービスのポート
└── integration/     # 連携プラグインとの約束事（defineIntegration・登録）
src/
├── infrastructure/  # Prisma、Auth.js、CSV解析、OpenAIの実装
├── presentation/    # 画面部品、Server Action、HTTPコントローラー
├── composition/     # 実装を組み立ててユースケースを公開
└── app/             # Next.js App Routerのエントリーポイント
```

`domain` はフレームワークやデータベースに依存せず、`application` はドメインの契約だけを利用します。外部サービス固有のコードは `infrastructure` に閉じ込め、`composition` で依存性を注入します。

パッケージ間の依存は、次のルールをESLintで検査します。

- `packages/` からアプリの内部（`@/…`）、Next.js、React、Prismaを import しない
- `@ffpf-zhuelog/core` は個別の連携プラグインを import しない
- プラグインは `@ffpf-zhuelog/core/integration` だけを使う
- アプリでプラグインを import するのは `src/composition/` だけ

### 連携プラグインの追加

連携の画面（`/integrations/<id>`）、出力API（`/api/integrations/<id>/export`）、管理者・メンバーの確認はアプリ側が共通で用意します。プラグインは、学習ノートから表示内容と出力ファイルを作る処理だけを持ちます。

1. `packages/<名前>-plugin/` を作り、`package.json` の `name` を `@ffpf-zhuelog/<名前>-plugin`、`exports` を `{ ".": "./src/index.ts" }`、`dependencies` を `{ "@ffpf-zhuelog/core": "workspace:*" }` にします。
2. `src/index.ts` で、`@ffpf-zhuelog/core/integration` の `defineIntegration` を使って連携を定義し、default export します。`id` は英小文字・数字・ハイフンで、40文字以内です。
3. ルートの `package.json` の `dependencies` に `"@ffpf-zhuelog/<名前>-plugin": "workspace:*"` を追加して `pnpm install` を実行し、`src/composition/integration-container.ts` の `createIntegrationRegistry([...])` に加えます。

## 起動方法

前提: Node.js 24 または 26、Docker Desktop

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm run db:migrate --name init
pnpm run dev
```

ブラウザで <http://localhost:3000> を開きます。

## Cloud Runへのデプロイ

Web画面の本番はVercel、LINE連携はGoogle Cloud Runで動かしています。Cloud Runへはルートの `Dockerfile` でデプロイし、`AUTH_URL`（公開URL）の設定とCloud Tasksが必要です。30分おきの取り残しの拾い直しはVercel Cronが行い、VercelがCloud Runに取り次ぎます。手順は [`docs/cloud-run.md`](docs/cloud-run.md) を参照してください。

## 認証・認可の設定

GitHubの **Settings → Developer settings → OAuth Apps** でOAuth Appを作成します。

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

`.env` に以下を設定してください。

```env
AUTH_SECRET="openssl rand -base64 32 で生成した値"
AUTH_GITHUB_ID="OAuth AppのClient ID"
AUTH_GITHUB_SECRET="OAuth AppのClient Secret"
AUTH_ALLOWED_GITHUB_LOGINS="github-login-1,github-login-2"
```

許可リストは大文字・小文字を区別しません。空の場合は安全側に倒し、すべてのGitHubユーザーを拒否します。本番環境では本番URL専用のGitHub OAuth Appを作成し、コールバックURLを `https://本番ドメイン/api/auth/callback/github` にしてください。

### ロールとID・パスワードのアカウント

ロールは4種類です。

- **admin（管理者）**: GitHub認証で許可リストに載っているユーザー。共有ノートの投稿・CSVインポート・Typle連携・LINE連携とアカウント管理を使えます。
- **member（メンバー）**: ID・パスワードでログインするアカウント。共有ノートの閲覧と本人のAPIキーでの添削に加えて、ChatGPT会話（`/chat`）、自分の会話ノート、CSVインポート、Typle連携を使えます。CSVインポートでは、全員が見る共有ノートに記録を追加できます。LINE連携とアカウント管理は使えません。
- **guest（ゲスト）**: ログイン画面の「ゲストとして閲覧」。共有ノートの閲覧と本人のAPIキーでの添削だけです。
- **revoked**: 許可リストから外れた管理者や、再設定・変更でセッションが失効したメンバー。どのページも使えず、ログイン画面に戻されます。

memberのアカウントは、GitHub管理者が `/admin/accounts` で作ります。セルフ登録はありません。最初のアカウントも、まずGitHubで管理者としてログインして作成してください。

- **作成・再設定**: ログインID（英小文字・数字・`.` `_` `-` の3〜32文字）と表示名を入力します。パスワードは12〜128文字で、空欄にすると自動生成します。パスワードは作成・再設定の直後に一度だけ画面に表示され、あとから確認できません。管理者から本人に別の経路で伝えてください。
- **パスワード変更**: memberは、ヘッダーの「パスワード変更」（`/account/password`）から自分で変更できます。変更するとログアウトされ、新しいパスワードでログインし直します。
- **ロック**: 5回続けて間違えると、そのアカウントは15分間ロックされます。ロック中は正しいパスワードでもログインできません。ログイン画面には、IDの有無やロックの状態を区別せず「IDまたはパスワードが違うか、一時的にロックされています。」とだけ表示します。ロック中のアカウントは `/admin/accounts` に「ロック中」と表示され、管理者がパスワードを再設定すると解除されます。
- **セッションの失効**: パスワードを再設定・変更すると、そのアカウントの既存のセッションは、すべて使えなくなります。セッションの有効性（`sessionVersion`）は、サーバー側でユーザーを読むたびにDBで確認します。
- **パスワードの保存**: scrypt（N=2^15, r=8, p=1）でハッシュ化したものだけを保存します。平文はDBにもログにも残しません。
- **会話ノートの公開範囲**: memberの保存した会話は、所有者 `password:<アカウントID>` に紐づき、本人だけが見られます。

新しい環境変数はありません。ただしDBマイグレーション `20261007090000_password_accounts`（`PasswordAccount` テーブルの追加）が必要です。本番へデプロイする前に、Vercelとリンク済みのmainのチェックアウトで、次の手順で本番DB（Neon）へ適用してください。`prisma.config.ts` は `.env` だけを読み込むので、`vercel env pull` だけでは本番の `DATABASE_URL` が使われません。`--environment=production` で取得したファイルを、`--env-file` で明示して渡します。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
rm .env.production.local
```

適用前にデプロイすると、ID・パスワードでのログインと `/admin/accounts` だけがエラーになります。GitHubログインとゲストログインは影響を受けません。

認可はProxyによるページ保護に加え、画面のServer ComponentとCSVインポートのServer Actionでも検証します。

ログイン画面からは、GitHub認証を使わずゲストとしてログインすることもできます。ゲストは共有ノートと日付別ログの閲覧、および本人のAPIキーでの個人添削を利用できます。共有ノートへの投稿・CSVインポート・ChatGPT・Typle連携は管理者・メンバー専用、LINE連携は管理者専用です。共有データの書き込み権限はServer ActionとAPI Routeでも検証します。

## 本人のAPIキーでの添削（BYOK）

サインイン画面の「自分のAPIキーで添削」、またはログイン後の `/practice` から利用できます。管理者用の `OPENAI_API_KEY` を使うChatGPT会話・LINE処理とは独立しており、新しい環境変数やDBマイグレーションは不要です。

1. OpenAI Platformで本人のAPIキーを作成し、APIの支払い・利用権限を設定します。必要な権限に絞った、このアプリ専用のプロジェクト／キーを推奨します。
2. 画面の課金・送信・保存に同意し、キーを登録します。キーの有効性は添削時に確認します。
3. 500文字以内の文を送信すると、GPT-5 miniで添削文・ピン音・日本語のヒントを生成します。

- **料金**: API料金は本人のOpenAIアカウントに発生します。ChatGPTの定額契約とは別です。運営者のキーへのフォールバックや自動再試行はありません。エラー／切断時もOpenAI側では処理・課金が行われている可能性があります。
- **APIキー**: この画面を開いている間のメモリー内のみで保持します。移動・再読み込み・ログアウト後は再入力が必要です。localStorage、sessionStorage、Cookie、DB、アプリのログには保存しません。キーと原文は同一オリジンのAPIを経由してOpenAIに送信するため、運営サーバーはリクエスト処理中のキーを扱います。公開時はHTTPSを使用してください。分析・エラー収集基盤でも、このエンドポイントのリクエスト本文を記録しないでください。
- **履歴**: 原文・添削結果・日時をこのブラウザーのlocalStorageに最大100件保存します。アプリDB・共有ノート・LINEには転送しません。ログアウト後も残ります。同じブラウザーを使う人には見えるため、共用端末では「履歴をすべて削除」を実行してください。ブラウザーのデータ削除によって失われ、別端末への同期・復元はできません。保存が禁止／容量不足の場合は警告し、結果は画面内だけに保持します。
- **OpenAI側の保持**: Responses APIには `store: false` を指定しますが、これはOpenAI側のあらゆるログの不保持を保証しません。[OpenAIのデータ保持ポリシー](https://developers.openai.com/api/docs/guides/your-data)を確認してください。
- **制限**: 固定モデル `gpt-5-mini`、最大出力4,000トークン、サーバー45秒、送信本文8KiB。同一プロセス内で1キー同時1件・1分10件、全体同時16件に制限します。キーの識別子（プロセスごとのランダムな秘密鍵によるHMAC-SHA-256）とカウンターだけを一時メモリーに保持し、DBには保存しません。サーバーレスの別インスタンス間では制限を共有しないため、厳密な課金上限ではありません。Vercelの無料枠やOpenAIの利用上限によって利用できない場合があります。
- **権限と安全性**: Auth.jsのゲスト／管理者セッションと同一オリジンを検証し、外部からのブラウザー送信・任意モデル／接続先・キー未指定を拒否します。生成結果はスキーマ検証後に通常のテキストとして表示します。

実装は `domain/practice` → `application/practice`（ポート・ユースケース）→ `infrastructure/practice`（OpenAI・端末保存）を分離し、`composition/practice-container.ts` からAPIを構成しています。API成功系はモック応答で単体／E2E検証し、テストで有料の外部APIは呼びません。

開発用PostgreSQLはDockerホストの `127.0.0.1` にだけ公開されます。`.env` はGit管理対象外です。秘密情報をコミットせず、公開・漏洩した可能性がある場合は該当する認証情報を直ちに失効・再発行してください。

## LINEでの添削・翻訳

自分のLINE（公式アカウントとの1対1トーク）に送った文を、Cloud Run上でOpenAI API（`gpt-5-mini`）が処理し、同じトークに返信して学習ノートに保存します。MacやCodexは不要です。

- ひらがな・カタカナを含む日本語の文は、中国語（簡体字）に翻訳します。返信は「元の文」「中国語訳」「ヒント」で、ノートには「翻訳」として保存されます。
- 漢字を含むそれ以外の文は、中国語として添削します。返信は「元の文」「添削後」「ヒント」です。
- 500文字を超える文は上限を通知し、生成も保存もしません。コマンドはありません（`/battery`・開発モードは廃止しました）。
- webhookはCloud Tasksに処理を頼んでから返答し、処理は `GET /api/line/drain` のリクエストの中で動きます（Cloud Runの課金をリクエスト中だけにするため）。取り残しは次のwebhookと、Vercel Cron（30分おき、`GET /api/line/drain`）が拾い直します。LINEが無効なVercelは、この呼び出しを `LINE_DRAIN_FORWARD_URL`（Cloud RunのURL）の `/api/line/drain` に取り次ぎます。

必要な環境変数は `LINE_INTEGRATION_ENABLED`・`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`LINE_BOT_USER_ID`・`LINE_ALLOWED_USER_ID`・`OPENAI_API_KEY`、そして `/api/line/drain` を保護する `CRON_SECRET`（`openssl rand -hex 32` で生成した32文字以上の値）です。`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` はE2Eテスト専用（ループバックのアドレスだけを受け付けます）で、本番では設定しません。設定手順、v0.12.0への切り替え（Macのworkerの停止など）、失敗時の扱いは [`docs/line-integration.md`](docs/line-integration.md) を参照してください。

## ChatGPT会話機能の設定

OpenAI PlatformでAPIキーを作成し、`.env` に設定してください。ChatGPTのサブスクリプションとは別に、OpenAI APIの利用料金が発生します。

```env
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-6.1-sol"
```

開発サーバーを再起動すると、GitHubで管理者として、またはID・パスワードでメンバーとしてログインした後に `/chat` で会話できます。`OPENAI_MODEL` を省略した場合は `gpt-6.1-sol` を使用し、推論強度は `medium`（中）を明示して送信します。既存の `.env` や Vercel に `OPENAI_MODEL` が設定されている場合は、`gpt-6.1-sol` へ変更して再起動または再デプロイしてください。会話はストリーミングで表示されます。OpenAIへのリクエストでは会話の保存を無効化しています。

## 会話の保存と会話ノート

`/chat` の「会話を保存する」を押すと、その時点の会話を本人のGitHub IDに紐づけてアプリのDBへ保存します。DBへの自動保存はしません。同じ会話を再保存すると、新しく作らずに同じ会話を更新します。保存操作はAIを呼び出しません。

- **会話を終える**: 生成を停止し、内容を残したまま入力を閉じます。「新しい会話」で次の練習を始められます。
- **会話ノート**（`/conversations`）: 保存した会話を、学習ノートと同じく日本時間の保存日ごとに開けます。ホームと会話練習の「会話ノート」から移動できます。
  - 日別一覧: `/conversations/2026/10/4`
  - その日の2件目: `/conversations/2026/10/4/2`
- **端末にダウンロード**: 発言・日時・モデル情報をMarkdownとして出力します。会話練習と会話ノートの詳細から使えます。
- **端末バックアップ**: 会話はLocalStorageにも自動バックアップします（最新20会話・合計1MiBまで、古いものから除外）。進行中の会話は再読み込みで復元し、勝手に再送信しません。DB保存失敗時もローカルバックアップとダウンロードを使えます。容量不足・保存禁止・破損時は警告を表示します。会話練習の「保存した会話」から、DB履歴と端末バックアップを開けます。
- **上限**: DB保存は最大40発言・総テキスト40,000文字です。タイトルは最初の発言から作ります。
- **公開範囲**: 会話は保存した本人だけが見られます。ゲストや別の管理者には表示されず、APIでも本人以外の閲覧・上書きを拒否します。古いログインセッションでは、一度ログアウトしてGitHubでログインし直してください。
- **端末の注意**: バックアップはGitHub IDごとに分かれますが、ログアウト後も端末に残ります。共用端末では、ほかの利用者がブラウザーデータを確認できる場合があります。ブラウザーデータを削除するとローカル履歴は消えます。別の端末では、DBに保存した履歴を参照してください。

公開前に `pnpm run db:deploy` で `prisma/migrations/20261001100000_chat_conversations` と `20261004090000_chat_conversation_created_at` を対象DBへ適用し、API版の `OPENAI_MODEL=gpt-6.1-sol` 設定を確認してデプロイします。マイグレーションを適用していない場合、DB保存・履歴取得・会話ノートはエラーになります。端末保存とダウンロードは独立して利用できます。

## 表示テーマ

全ページ右上の「システム / ライト / ダーク」から切り替えられます。初期値は「システム」で、OSの配色変更にも自動で追従します。手動で選んだテーマだけを端末の `zhuelog:theme:v1` に保存し、再読み込み・ページ移動・同じブラウザーの別タブでも反映します。DBやアカウントには保存しません。

ブラウザーの保存が制限されている場合でも、その画面での切り替えは利用できます。初期配色はCSP nonce付きの固定スクリプトで本文表示前に適用し、ライト画面が一瞬表示されるのを防ぎます。

## 日付別の学習ログ

学習ノートの登録日時は日本時間（JST）で表示します。`/logs` から登録日を選び、日別一覧とその日の連番詳細を開けます。

- 日別一覧: `/logs/2026/9/20`
- その日の2件目: `/logs/2026/9/20/2`

## Typle用の復習リスト

管理者とメンバーはホームの「Typle用リスト」（`/integrations/typle`）から、学習ノートをTyple向けの復習リストへ変換できます。処理は連携プラグイン `@ffpf-zhuelog/typle-integrate-plugin`（`packages/typle-integrate-plugin/`）にあります。

- ヒント内の「引用語」と、添削によって追加された短い中国語を抽出します。
- 3文字以下の語（图书馆など）は分割せず1語として扱います。語順を入れ替えただけの部分は、追加された語に数えません。
- 同じ語をまとめ、中国語を表示・入力対象、元のヒント・例文・拼音を補足にします。
- 新しい学習ノートから最大1,000件、重複を除いて最大500語を扱います。
- `/api/integrations/typle/export` から、`typle-r` v1保存形式のJSONをダウンロードできます。

画面と出力APIは管理者・メンバー専用です。現在の `typle-r` には外部JSONを読み込む画面がないため、現時点の連携範囲は自動抽出・プレビュー・互換JSON出力までです。Typleアカウントへ直接保存するには、`typle-r` 側にインポート導線を追加してください。

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
- 1ファイル5MB、1回1,000行までです。
- 1項目1万文字・1行10万文字・ヒント100個までです（行ごとに個数を変えられます）。
- サンプルは [`examples/sample.csv`](examples/sample.csv) にあります。

## データ構造

- `ImportBatch`: インポートしたファイル名・件数・日時
- `LearningEntry`: 最初の文・添削後の文・ピン音
- `Hint`: 学習文に属する可変個数のヒントと表示順
- `PasswordAccount`: ID・パスワードのアカウント（ログインID・表示名・パスワードのハッシュ・`sessionVersion`・失敗回数・ロック期限）
- `ChatConversation`: 保存した会話（所有者のGitHub IDまたは `password:<アカウントID>`・タイトル・モデル・終了状態・発言・保存日時・更新日時）

インポートはファイル単位のトランザクションです。途中の行でエラーになった場合、そのファイルのデータは1件も保存されません。

## セキュリティ

ページの保護は `src/proxy.ts` と各Server Componentで、書き込みはServer Action/API内で再検証します。管理者の許可リストはセッションを読むたびに確認されます。リモートPostgreSQL接続は `sslmode=verify-full` に統一し、証明書とホスト名を検証します。

HTMLにはリクエストごとのnonce付きCSPを設定します。AI通信・入力の上限、ログの秘匿化、監査範囲と制約は [2026-09-24 セキュリティレビュー](docs/security-review-2026-09-24.md) を参照してください。API利用料金の厳密な上限は利用者自身のOpenAIプロジェクト側でも管理してください。

## Seedデータ

個人の学習ノートを公開リポジトリへ含めないよう、実データはGit管理外の `prisma/seed.private.json` に保存します。

```bash
cp prisma/seed.example.json prisma/seed.private.json
pnpm run db:seed
```

各エントリには固定IDと登録日時を指定します。seedは同じID、または同じ本文・添削文・ピン音の組み合わせを検出してスキップするため、再実行しても重複しません。公開してよいダミーデータの形式は [`prisma/seed.example.json`](prisma/seed.example.json) で確認できます。

## Playwright E2E

Node.js 24 または 26 と、起動済みのDocker（Compose v2）が必要です。

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
テスト起動時に専用PostgreSQLを起動し、既存マイグレーションを適用してTurbopackでビルド、`127.0.0.1:3107`に本番モードのサーバーを起動します。
既存サーバーは再利用しません。通常の開発サーバーは停止してから実行してください（ビルド先の`.next`を共有します）。

- 認証前のリダイレクト、ゲストログイン／ログアウト、外部URLへのリダイレクト拒否
- ID・パスワードのアカウント（管理者による作成、作成直後のパスワード表示（再表示できない旨の注記つき）、memberのChatGPT利用、アカウント管理画面の拒否、ログイン失敗の共通メッセージ、5回失敗でのロック、再設定によるセッション失効、パスワード変更、会話ノートの非公開）
- ゲストのCSV操作・管理者用ChatGPT利用制限（古い管理者フォームからの投稿も拒否）
- 本人のAPIキーでの添削、同意、端末履歴、キーの非永続化、DB非保存、モバイル表示
- CSVの登録・リロード後の永続化・可変ヒント・BOM・引用符・改行・入力エラー
- 日付一覧・ノート詳細・前後移動・JST日付境界・無効なURL・折り畳み
- OpenAIキー未設定時のチャット利用拒否
- 会話の終了・DB保存・再保存・端末バックアップの復元・ダウンロード・他人の会話の閲覧／上書き拒否（AI応答はモック）
- 会話ノートの日付一覧・日別一覧・詳細・前後移動・JST日付境界・無効なURL・ゲストと他人からの非表示
- LINEの署名付きwebhook・重複排除・日本語の翻訳と中文の添削・生成失敗の返信・同時受信・Cronでの取り残しの処理（OpenAIとLINEは `127.0.0.1:3108` / `3109` の偽サーバー）
- Typle用リストの抽出・管理者・メンバー限定表示・互換JSON出力・先頭20件の表示・存在しない連携の404

DBは`127.0.0.1:55439/zhuelog_e2e`に固定され、`compose.e2e.yaml`の専用コンテナだけを使用します。
各テスト前にこのDBの学習データを初期化します。ポート55439を別のDBに割り当てないでください。
通常の`DATABASE_URL`、実際のOAuth情報、OpenAIキーは使用しません。
管理者セッションはテスト側で実行ごとのランダムな秘密鍵を使って作成します。本番コードに認証バイパスは追加していません。
GitHub OAuthの外部ログインとOpenAI・LINEの実API通信は、このE2Eの対象外です。

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

`pnpm install --frozen-lockfile` 後、`pnpm run test:regression` で既存機能の検証を実行します。GitHub Actions では同じ内容を CI ワークフローが並列で実行します（`verify` を本番の Vercel と同じ Node 24 と、次の版の Node 26 で、`e2e` を Node 24 で実行）。`package.json` の `engines` は `24.x || 26.x` で、Vercel はこの中で対応している一番新しい版を使います。
ブラウザーテストの前に `pnpm exec playwright install chromium` を実行してください。Webの回帰テストは本番ビルドを使い、既存サーバーを再利用しません。
