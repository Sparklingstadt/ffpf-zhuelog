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

開発用PostgreSQLはDockerホストの `127.0.0.1` にだけ公開されます。`.env` はGit管理対象外です。秘密情報をコミットせず、公開・漏洩した可能性がある場合は該当する認証情報を直ちに失効・再発行してください。

## ChatGPT会話機能の設定

OpenAI PlatformでAPIキーを作成し、`.env` に設定してください。ChatGPTのサブスクリプションとは別に、OpenAI APIの利用料金が発生します。

```env
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5-mini"
```

開発サーバーを再起動すると、`/chat` で会話できます。`OPENAI_MODEL` は省略可能です。会話はストリーミングで表示され、現時点ではデータベースへ保存されません。OpenAIへのリクエストでも会話の保存を無効化しています。

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
- サンプルは [`examples/sample.csv`](examples/sample.csv) にあります。

## データ構造

- `ImportBatch`: インポートしたファイル名・件数・日時
- `LearningEntry`: 最初の文・添削後の文・ピン音
- `Hint`: 学習文に属する可変個数のヒントと表示順

インポートはファイル単位のトランザクションです。途中の行でエラーになった場合、そのファイルのデータは1件も保存されません。
