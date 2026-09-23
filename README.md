# 学习録

添削前後の中国語、ピン音、可変個数の学習ヒントをCSVから取り込んで表示する、Next.js製の中国語学習アプリです。

## 技術構成

- Next.js 16（App Router / Server Actions）
- PostgreSQL 17
- Prisma ORM 7
- shadcn/ui + Tailwind CSS 4
- Auth.js v5 + GitHub OAuth
- Vercel AI SDK + OpenAI Responses API

## アーキテクチャ

コードは依存関係が内側へ向くよう、機能別の関心事を5層に分けています。

```text
src/
├── domain/          # エンティティ、値オブジェクト、リポジトリの契約
├── application/     # ユースケースと外部サービスのポート
├── infrastructure/  # Prisma、Auth.js、CSV解析、OpenAIの実装
├── presentation/    # 画面部品、Server Action、HTTPコントローラー
├── composition/     # 実装を組み立ててユースケースを公開
└── app/             # Next.js App Routerのエントリーポイント
```

`domain` はフレームワークやデータベースに依存せず、`application` はドメインの契約だけを利用します。外部サービス固有のコードは `infrastructure` に閉じ込め、`composition` で依存性を注入します。

## 起動方法

前提: Node.js 22以上、Docker Desktop

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate -- --name init
npm run dev
```

ブラウザで <http://localhost:3000> を開きます。

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

認可はProxyによるページ保護に加え、画面のServer ComponentとCSVインポートのServer Actionでも検証します。

ログイン画面からは、GitHub認証を使わずゲストとしてログインすることもできます。ゲストは共有ノートと日付別ログの閲覧、および本人のAPIキーでの個人添削を利用できます。共有ノートへの投稿・CSVインポート・管理者用ChatGPT・LINE添削は引き続き管理者専用です。共有データの書き込み権限はServer ActionとAPI Routeでも検証します。

## 本人のAPIキーでの添削（BYOK）

サインイン画面の「自分のAPIキーで添削」、またはログイン後の `/practice` から利用できます。管理者用の `OPENAI_API_KEY`、Codex、LINE処理とは独立しており、新しい環境変数やDBマイグレーションは不要です。

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

## ChatGPT会話機能の設定

OpenAI PlatformでAPIキーを作成し、`.env` に設定してください。ChatGPTのサブスクリプションとは別に、OpenAI APIの利用料金が発生します。

```env
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5-mini"
```

開発サーバーを再起動すると、`/chat` で会話できます。`OPENAI_MODEL` は省略可能です。会話はストリーミングで表示され、現時点ではデータベースへ保存されません。OpenAIへのリクエストでも会話の保存を無効化しています。

## 表示テーマ

全ページ右上の「システム / ライト / ダーク」から切り替えられます。初期値は「システム」で、OSの配色変更にも自動で追従します。手動で選んだテーマだけを端末の `zhuelog:theme:v1` に保存し、再読み込み・ページ移動・同じブラウザーの別タブでも反映します。DBやアカウントには保存しません。

ブラウザーの保存が制限されている場合でも、その画面での切り替えは利用できます。初期配色はCSP nonce付きの固定スクリプトで本文表示前に適用し、ライト画面が一瞬表示されるのを防ぎます。

## 日付別の学習ログ

学習ノートの登録日時は日本時間（JST）で表示します。`/logs` から登録日を選び、日別一覧とその日の連番詳細を開けます。

- 日別一覧: `/logs/2026/9/20`
- その日の2件目: `/logs/2026/9/20/2`

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

インポートはファイル単位のトランザクションです。途中の行でエラーになった場合、そのファイルのデータは1件も保存されません。

## セキュリティ

ページの保護は `src/proxy.ts` と各Server Componentで、書き込みはServer Action/API内で再検証します。管理者の許可リストはセッションを読むたびに確認されます。リモートPostgreSQL接続は `sslmode=verify-full` に統一し、証明書とホスト名を検証します。

HTMLにはリクエストごとのnonce付きCSPを設定します。AI通信・入力の上限、ログの秘匿化、監査範囲と制約は [2026-09-24 セキュリティレビュー](docs/security-review-2026-09-24.md) を参照してください。API利用料金の厳密な上限は利用者自身のOpenAIプロジェクト側でも管理してください。

## Seedデータ

個人の学習ノートを公開リポジトリへ含めないよう、実データはGit管理外の `prisma/seed.private.json` に保存します。

```bash
cp prisma/seed.example.json prisma/seed.private.json
npm run db:seed
```

各エントリには固定IDと登録日時を指定します。seedは同じID、または同じ本文・添削文・ピン音の組み合わせを検出してスキップするため、再実行しても重複しません。公開してよいダミーデータの形式は [`prisma/seed.example.json`](prisma/seed.example.json) で確認できます。

## Playwright E2E

Node.js 22以降と、起動済みのDocker（Compose v2）が必要です。

```bash
npm ci
npx playwright install chromium
npm run test:e2e
# 対話的な実行
npm run test:e2e:ui
# 終了後、専用DBを停止・破棄（テストデータのみ）
npm run test:e2e:stop
```

Desktop Chromiumとモバイル幅（Pixel 7 / Chromium）の両方で検証します。
テスト起動時に専用PostgreSQLを起動し、既存マイグレーションを適用してTurbopackでビルド、`127.0.0.1:3107`に本番モードのサーバーを起動します。
既存サーバーは再利用しません。通常の開発サーバーは停止してから実行してください（ビルド先の`.next`を共有します）。

- 認証前のリダイレクト、ゲストログイン／ログアウト、外部URLへのリダイレクト拒否
- ゲストのCSV操作・管理者用ChatGPT利用制限（古い管理者フォームからの投稿も拒否）
- 本人のAPIキーでの添削、同意、端末履歴、キーの非永続化、DB非保存、モバイル表示
- CSVの登録・リロード後の永続化・可変ヒント・BOM・引用符・改行・入力エラー
- 日付一覧・ノート詳細・前後移動・JST日付境界・無効なURL・折り畳み
- OpenAIキー未設定時のチャット利用拒否

DBは`127.0.0.1:55439/zhuelog_e2e`に固定され、`compose.e2e.yaml`の専用コンテナだけを使用します。
各テスト前にこのDBの学習データを初期化します。ポート55439を別のDBに割り当てないでください。
通常の`DATABASE_URL`、実際のOAuth情報、OpenAIキーは使用しません。
管理者セッションはテスト側で実行ごとのランダムな秘密鍵を使って作成します。本番コードに認証バイパスは追加していません。
GitHub OAuthの外部ログインとOpenAIの実API通信は、このE2Eの対象外です。

失敗時のスクリーンショット・トレースは`test-results/`、HTMLレポートは`playwright-report/`に出力されます（Git管理外）。
`npx playwright show-report`で結果を確認できます。GitHub Actionsにも同じE2Eを追加しています。
設定の参考：[Playwright webServer](https://playwright.dev/docs/test-webserver)。

## コミット・プッシュ前のチェック（Lefthook）

`npm ci` / `npm install`でGitフックを自動設定します。再設定は`npm run hooks:install`です。CI・Vercel・Git管理外ではインストールをスキップします。

| タイミング | 順番に実行する処理                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| コミット前 | ステージ済みファイルのPrettier自動整形 → ESLint（警告もエラー）→ Next.js型生成・TypeScript型チェック |
| プッシュ前 | ESLint → 型チェック → Playwright E2E（Desktop / Mobile）                                             |

どれかが失敗するとコミット／プッシュを中止します。自動整形の結果はステージへ反映されます。部分ステージしたファイルの未ステージ部分はLefthookが一時退避・復元します。ただしLint・型チェック・E2Eは作業ツリー全体を対象とし、コミット済みスナップショットだけの検証ではありません。

プッシュには起動済みDockerとPlaywright Chromiumが必要です。上のE2E手順で準備し、`.next`の競合を避けるため開発サーバーを停止してください。フック終了時は成功・失敗にかかわらず専用E2Eコンテナを停止します。E2Eの手動実行との同時使用は避けてください。

既存コード全体の一括整形は行わず、コミット対象から段階的に整形します。生成コード・ロックファイル・秘密情報・テストレポートは整形対象外です。手動の全体整形は`npm run format`、全体の整形確認は`npm run format:check`（移行中は既存ファイルで失敗し得ます）、個別チェックは`npm run lint`と`npm run typecheck`で実行できます。
