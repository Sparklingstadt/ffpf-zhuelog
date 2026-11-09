# 学习録

中国語の作文を添削してもらったあと、その学びを置きっぱなしにしないための学習ノートです。書いた文と添削後の文を、ピンインと覚えるべきヒントと一緒に残し、間隔反復の復習、単語帳、文法の練習問題へつなげます。

**本番**：<https://ffpf-zhuelog.sparklingstadt.com/>

| 学習ノート（PC）                                               | 練習（スマホ）                                            | 今日の復習（PC）                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| ![学習ノートの一覧と添削の差分](docs/images/notes-desktop.png) | ![介詞の練習の正解の画面](docs/images/practice-phone.png) | ![今日の復習のカード](docs/images/review-desktop.png) |

## 試す

- **ゲスト**：ログイン画面の「ゲストとして使う」で、介詞・補語・量詞・了・过・着の練習を試せます。データは残りません。
- **会員**：ID とパスワードのアカウントは管理者が発行します。FFPF ID を持っている人は、自分でログインできます。

## できること

- **学習ノート**：添削前後の文、ピンイン、ヒントを CSV や LINE から取り込み、差分を色で見せます。日付別のログ、検索、ゴミ箱、フォローした人との共有があります。
- **今日の復習**：学習ノート、練習で間違えた問題、単語帳の語句を、FSRS（間隔反復）で忘れかけたころにもう一度出します。期日が来た朝には LINE で知らせます。
- **練習**：介詞、補語（結果・可能・程度・方向の 8 モード）、量詞、了・过・着の 4 択問題です。HSK 3.0 の級で絞れ、級の決め方は手作りの表と公式の語彙表（11,092 語）を切り替えられます。
- **単語帳**：例文や学習ノートから語句を入れ、ピンインと意味の下書きを AI が作ります。
- **AI**：LINE に送った文を添削・翻訳して学習ノートに入れます。「ChatGPT と話す」と「クイック質問」もあります。OpenAI を呼ぶたびにトークン数を記録し、管理者が月ごとの費用を見られます。
- **読み上げ・テーマ・スマホ**：例文と学習ノートの読み上げ、ライトとダーク、スマホの下のタブがあります。

機能ごとの詳しい説明は [docs/features.md](docs/features.md) にあります。

## 技術構成

| 部分         | 使っているもの                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Web          | Next.js 16（App Router、Server Components、Server Actions）、React 19、TypeScript、Tailwind CSS 4、shadcn/ui                |
| API          | Go（標準の `net/http`）。ログイン、学習ノート、復習、練習の記録、LINE、OpenAI のすべてを受け持ちます                        |
| DB           | PostgreSQL 17（本番は Neon）。スキーマとマイグレーションは Prisma 7。読み書きするのは Go API だけです                       |
| 認証         | GitHub OAuth（PKCE）、ID とパスワード（scrypt）、FFPF ID（OpenID Connect）、ゲスト。Go が JWT と refresh token を発行します |
| 外部サービス | OpenAI API、LINE Messaging API、Web Speech API（読み上げ）                                                                  |
| テスト       | Node の test runner、Go の testing、Playwright（PC とスマホの幅）、lefthook                                                 |
| デプロイ     | Vercel（Web と Go API の 2 プロジェクト）。本番のマイグレーションは Web のビルドで当てます                                  |

## 設計の要点

- **Web は DB に触らない**：Web は画面と Server Actions だけを持ち、データはすべて Go API を通します。Web とネイティブアプリが同じ API を使えるようにするためで、`src` から Prisma や pg を import しないことをテストで確かめています。
- **層を分ける**：Web のコードは `domain`・`application`・`infrastructure`・`presentation`・`composition` に分け、内側の層が Next.js や React に依存しないことを ESLint とテストで検査します。
- **復習を 1 つの列にする**：学習ノート、練習の間違い、単語帳の語句を、同じ FSRS のカードとして 1 つの「今日の復習」に並べます。
- **AI の費用を測ってから考える**：OpenAI を呼ぶ 4 か所のトークン数を記録し、料金や無料枠はその数字を見てから考える順にしました。

全体の図、認証の流れ、選んだ理由と捨てた案は [docs/architecture.md](docs/architecture.md) にまとめています。

## 品質

- 単体テスト 371 件（TypeScript）、Go のテスト（DB を使うものを含む）、E2E 200 件（Playwright、PC とスマホの 2 つの幅）があります。
- E2E は、Docker の Postgres、Go API、Web、OpenAI と FFPF ID のスタブを立ち上げて、本物の画面を通して確かめます。
- commit の前に format・lint・型チェック、push の前に単体テストと E2E を lefthook が走らせます。
- 本番の表示速度とアクセシビリティ（axe-core）の記録は [docs/quality.md](docs/quality.md) にあります。

## 手元で動かす

前提は Node.js 24 か 26、pnpm 11.25.0（`corepack enable`）、Docker、Go です。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run api:db    # Go API 用の DB を起動し、マイグレーションとサンプルデータを入れる
pnpm run api:dev   # Go API を 127.0.0.1:8081 で起動（起動したまま、別のターミナルで次へ）
pnpm run dev
```

<http://localhost:3000> を開き、ゲストか、サンプルの会員（[docs/api-local.md](docs/api-local.md) の表）でログインします。認証の設定、テスト、本番への反映の手順は [docs/development.md](docs/development.md) にあります。

## 文書

| 文書                                                       | 中身                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| [docs/architecture.md](docs/architecture.md)               | 全体の設計と、選んだ理由                 |
| [docs/features.md](docs/features.md)                       | 機能ごとの説明                           |
| [docs/quality.md](docs/quality.md)                         | 表示速度とアクセシビリティの記録         |
| [docs/development.md](docs/development.md)                 | 手元での動かし方、認証の設定、テスト     |
| [docs/api-local.md](docs/api-local.md)                     | Go API を手元で試す                      |
| [docs/api-deployment.md](docs/api-deployment.md)           | 本番への反映                             |
| [docs/releases/](docs/releases/)                           | リリースノート                           |
| [docs/roadmap.md](docs/roadmap.md)                         | これから取り組むこと                     |
| [docs/job-hunting-roadmap.md](docs/job-hunting-roadmap.md) | このアプリをポートフォリオに仕上げる計画 |

## ライセンス

All rights reserved です。ソースコードを読んでもらうために公開しています。詳しくは [LICENSE](LICENSE) を見てください。
