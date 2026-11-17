# 設計

学习録の全体の作りと、そう作った理由をまとめます。機能ごとの説明は [features.md](features.md)、手元での動かし方は [development.md](development.md)、機能を作ったときの設計と計画は [superpowers/specs/](superpowers/specs/) と [superpowers/plans/](superpowers/plans/) にあります。

## 1. 全体の図

```mermaid
flowchart LR
  subgraph Browser[ブラウザー]
    UI[画面]
  end
  subgraph Web[Web: Next.js 16 on Vercel]
    RSC[Server Components]
    SA[Server Actions]
    RH[Route Handlers<br/>チャット・クイック質問の答え・OAuth の callback・LINE の webhook と拾い直し・デモのリセット]
    PX[proxy.ts<br/>zl_session があるかだけを見る]
    CRON[Vercel Cron（Web の vercel.json）<br/>/api/cron/line-drain・/api/cron/demo-reset]
  end
  subgraph API[Go API on Vercel]
    HEALTH["/health だけ<br/>段階 12 で消す"]
  end
  DB[(PostgreSQL / Neon<br/>スキーマは Prisma)]
  OpenAI[OpenAI API]
  LINE[LINE Messaging API]
  GH[GitHub OAuth]
  FFPF[FFPF ID<br/>OpenID Connect]

  UI -->|HttpOnly Cookie| Web
  API -.->|health の確認だけ| DB
  Web -->|Prisma: ログインのセッション（Session）・ログインの試行回数・アカウントの確認・会員の管理・パスワード変更・単語帳・学習ノート・CSV の取り込み・復習・練習の記録・質問ノート・会話ノート・フォロー・タイムライン・学習ログ・AI の利用量の集計・LINE の連携とメッセージ・デモのリセット| DB
  Web -->|単語帳の下書き・クイック質問・チャット・LINE の添削と翻訳| OpenAI
  LINE -->|Webhook| Web
  Web -->|reply・push| LINE
  CRON -->|拾い直し・お知らせの push| LINE
  CRON --> OpenAI
  CRON -->|デモのリセット| DB
  Web -->|ログインの code の交換| GH
  Web -->|ログインの code の交換| FFPF
```

- ブラウザーが話す相手は Web だけです。Web は Go API を呼びません。Go API は `/health` と `/ping` を返すだけで、段階 12 で消します。
- Web は、ログイン中の人を決めるために、実行時に `Session` の行と DB のアカウント（`PasswordAccount`・`FfpfAccount`）を Prisma（`src/infrastructure/prisma/`）で読みます。単語帳（一覧・保存・削除）と学習ノート（一覧・検索・カレンダー・日ごとの表示・ゴミ箱・共有・CSV の取り込み）と練習の記録（介詞・補語）も Prisma で読み書きし（CSV は Web が自分で検証・解析し、1 つのトランザクションで保存します）、「AI で下書き」・クイック質問・ChatGPT と話すは Web が OpenAI を直接呼んで、使った量を `AiUsage` に記録し、質問ノートと会話ノートも Prisma で読み書きし、フォロー（会員の一覧・タイムライン・フォローする／外す）も Prisma で読み書きし、会員の管理（作成・一覧・パスワードの再設定）と自分のパスワードの変更も Prisma で書き（ハッシュは Web が scrypt で作り、確かめます）、学習ログ（カレンダー）と AI の利用量の月ごとの集計は Prisma で読むだけです。LINE も Web が受け、webhook の署名を確かめ、添削・翻訳の OpenAI を直接呼んで reply し、連携とメッセージ（`LineLink`・`LineLinkCode`・`LineMessage`）を Prisma で読み書きします。デモのリセットも Web が 1 つのトランザクションで行います。ログイン（GitHub・ID とパスワード・FFPF ID・ゲスト・デモ）とログアウトも Web が行い、`Session` を読み書きします（段階 11）。機能は、設計書（[2026-11-16-deprecate-go-backend-design.md](superpowers/specs/2026-11-16-deprecate-go-backend-design.md)）の段階ごとに、Go から Web へ移してきました。残りの Go（`services/api`）は、段階 12 で、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET`・`ApiRefreshToken`・`docs-site/` と一緒に消します。
- LINE は Web の `POST /api/line/webhook` に Webhook を送ります。Web が署名を確かめ、OpenAI で添削・翻訳し、結果を reply で返します。拾い直しと朝のお知らせは Web の `GET /api/cron/line-drain` で、Web の `vercel.json` の Cron が毎日 06:00 JST ごろに呼びます。Go API には LINE のコードも Cron もありません。

## 2. Web と Go API を分けた理由

最初は Next.js だけのアプリで、Auth.js と Prisma で DB を直接読んでいました。iOS アプリから自分の学習ノートを読み書きできるようにするため、ネイティブアプリ向けの Go API を作りました（[2026-10-20-go-mobile-api-design.md](superpowers/specs/2026-10-20-go-mobile-api-design.md)）。

すると、同じ規則（だれのノートを読めるか、CSV の上限、ログインの試行回数）を Web と Go の 2 か所に持つことになりました。そこで「画面は Next.js、データと認証は Go」に、3 段で寄せました（[2026-10-21-go-api-on-vercel-design.md](superpowers/specs/2026-10-21-go-api-on-vercel-design.md)）。

1. Go API を AWS ECS ではなく、Vercel の別プロジェクトで動かす。1 人で運用するので、置き場所を 1 つにまとめる。
2. Web のログインを Go API に移し、Auth.js をやめる（[web-auth-via-go-api](superpowers/specs/2026-10-21-web-auth-via-go-api-design.md)）。
3. Web のデータの読み書きを Go API に移し、Web の実行時から Prisma をなくす（[web-data-via-go-api](superpowers/specs/2026-10-22-web-data-via-go-api-design.md)）。

スキーマとマイグレーションは Prisma に残しました。Go は pgx で SQL を書きます。

**その後**：段階 1 から 11 で、Web のデータの読み書きとログインを、順に Web（Prisma）へ戻しました。いまの Go は `/health` と `/ping` だけです。

**守っている決まり**：Prisma を import してよいのは `src/infrastructure/prisma/` だけで、pg と next-auth は import できません。これを `tests/architecture.test.ts` が検査します。

**捨てた案**：Go API を AWS ECS に置く案（最初の計画）。Vercel だけで足りると分かったので、置き場所を 1 つにしました。

## 3. Web の層

```text
src/
├── domain/          # エンティティ、値オブジェクト、リポジトリの契約（Next.js・React に依存しない）
├── application/     # ユースケースと外部サービスのポート
├── infrastructure/  # Prisma、Cookie とセッション、OAuth、OpenAI、設定の実装
├── presentation/    # 画面部品、Server Action、コントローラー、表示用の変換
├── composition/     # 実装を組み立ててユースケースを公開
└── app/             # Next.js App Router のエントリーポイント
```

依存は内側へ向けます。ESLint と `tests/architecture.test.ts` が、次のことを検査します。

- `domain`・`application` から、外側の層・Next.js・React・Prisma を import しない。
- `domain` から `application` を import しない。
- ポートには `Request`・`Response`・`Headers` を使わない。
- `domain`・`application` で `console` を使わない。

Web から Go API を呼ぶ処理は、段階 11b からありません。`src/infrastructure/go-api/` の呼び出しの部品とエラーの型だけが残っていて、`GO_API_URL`・`API_WEB_PROXY_SECRET` を読みますが、どこからも呼びません。段階 12 で消します。

- **ログインの切れ目**：Cookie `zl_session` が無いときは Proxy が、行が無い・期限切れのときは各ページと Server Action が、ログイン画面へ送ります。
- **接続元の IP**：`x-real-ip` / `x-forwarded-for` から Web が自分で決め、ログインの試行回数に使います。

## 4. 認証

ログインとログアウトは、すべて Web が行います（段階 11）。Go API は関わりません。

| ログイン        | 中身                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub OAuth    | PKCE つき。管理者だけ。管理者は GitHub の数字の ID の許可リスト（`AUTH_ALLOWED_GITHUB_IDS`）で決める。code の交換は Web（`AUTH_GITHUB_ID` と `GITHUB_WEB_CLIENT_SECRET`）                                           |
| ID とパスワード | 管理者が発行する会員。パスワードは scrypt（N=2^15, r=8, p=1）で、書き込みも確認も Web（`src/infrastructure/security/scrypt-password-hasher.ts`）。`tests/fixtures/scrypt-golden.json` は、Go が書いた固定のファイル |
| FFPF ID         | 自作の ID 基盤の OpenID Connect。ES256 の署名、iss・aud・nonce・exp を確かめる。code の交換は Web（`FFPF_ID_CLIENT_SECRET`）                                                                                        |
| ゲスト          | データを持たない。練習だけ使える                                                                                                                                                                                    |
| デモ            | `DEMO_LOGIN_ID` のアカウントに、パスワードなしで入る。全員で 1 つのアカウントを使う                                                                                                                                 |

GitHub と FFPF ID が code を交換するときの `redirect_uri` は、`AUTH_URL` の origin から決まります（GitHub は `/api/auth/callback/github/go`、FFPF ID は `/api/auth/callback/ffpf`）。GitHub の OAuth App と FFPF ID の portal に登録した URL と 1 文字でも違うと、ログインできません。

**セッション（`zl_session`）**

- ブラウザーの Cookie `zl_session`（HttpOnly・SameSite=Lax）に、ランダムな 32 バイトのトークンを置きます。DB の `Session` には、トークンの SHA-256 のハッシュだけを保存します。
- ログインのたびに、新しいトークンを出します。そのブラウザーの前のセッションの行は消し、`zl_act_as` と、Go の時代の Cookie（`zl_access`・`zl_refresh`）も消します。
- 期限は固定です。会員と管理者は 30 日、ゲストは 24 時間で、使っても延びません（Go の refresh のようには延ばしません）。期限が来たら、ログインし直します。
- 期限切れの行は、ログインのたびに最大 100 行まで消します。別のジョブは要りません。
- ログアウトは、自分の行を消し、Cookie を消します。DB が失敗しても、Cookie は消します。

**毎回の確かめ**：リクエストのたびに、Cookie のトークンから `Session` の行を引き、次を確かめます。許可リストなどを変えたら、すぐ効きます。

- 行が無い・期限切れ・形が違うときは、未ログインです。
- 管理者は、`AUTH_ALLOWED_GITHUB_IDS` に載っているときだけ管理者です。外れていると `revoked` で、どのページも使えません。この許可リストは、モジュールを読み込むときに 1 度だけ読むので、値を変えたら再デプロイが要ります。
- 会員は、アカウントがあり、`sessionVersion` が行に書いた値と同じときだけ通ります。デモのアカウントには、デモの印を付けます。
- ゲストは、DB のアカウントを読みません。

**Proxy**：`src/proxy.ts` は、Cookie `zl_session` があるかだけを見ます。DB は読まず、更新もしません。無ければログイン画面へ送ります。中身の確かめは、上の「毎回の確かめ」を各ページ・Server Action・Route Handler が行います。

**失効**

- 会員がパスワードを変えると、またはパスワードを管理者が再設定すると、Web が 1 つの `UPDATE` でハッシュと `sessionVersion` を変え、その人の `Session` の行をすべて消します。ほかの端末も、次のリクエストでログインし直しになります。
- 管理者は、許可リストから外れた時点で `revoked` になります（行は期限まで残ります）。
- 全員をログアウトさせたいときは、`DELETE FROM "Session"` を実行します（[api-deployment.md](api-deployment.md) の「運用上の注意」）。

**試行回数**

- 接続元ごと、接続元とログイン ID の組ごとに、15 分の窓で数えます（`SignInThrottle`）。Web が数えます。
- アカウントそのものはロックしません。ほかの場所からの失敗で、本人が締め出されないようにするためです。

**会員として操作**：管理者は、会員の画面を閲覧のみで見られます。管理者がメニューから会員を選ぶと、Web が Cookie `zl_act_as`（会員の `ownerId`）を書きます。Web は、リクエストのたびに、管理者であることを確かめ、`zl_act_as` が `password:` ＋英小文字と数字だけの形で、そのパスワードアカウントが DB にあることを確かめます。1 つでも外れると、`zl_act_as` は無視して、管理者自身の画面を出します。管理者以外には効きません。LINE の連携はできず（LINE 連携の画面は `/` に戻ります）、AI の利用量は管理者のほうに数えます。新しくログインすると、`zl_act_as` は消えます。

## 5. 復習

- **計算**：FSRS v4 で次の期日を決めます。Web が `src/domain/review/fsrs.ts`（[go-fsrs](https://github.com/open-spaced-repetition/go-fsrs) を手で移した TypeScript）で計算し、`ReviewItem` と `ReviewLog` も Prisma で直接読み書きします。Go の `review` パッケージは消えていて、`tests/fixtures/fsrs-golden.json`（go-fsrs の結果を書いた固定のファイル）と同じ結果になることを、Web のテストで確かめます。定着率 90%、学習中のステップは 1 分と 10 分です。評価は「もう一度・難しい・できた・簡単」の 4 段階です。
- **1 つの列にまとめる**：学習ノート、介詞と補語の練習の間違い、単語帳の語句を、どれも `ReviewItem`（`kind` と `targetId`）として同じ表に置きます。そのため、「今日の復習」は 1 つの列で済みます。FSRS のカードの状態（stability、difficulty、due など）は列に持ち、`(ownerId, due)` の索引で期日の来たものを引きます。
- **答えの記録**：答えは `ReviewLog` に残します。あとで FSRS のパラメーターを本人の記録に合わせられるようにするためです。
- **ゴミ箱との関係**：ゴミ箱に入れた学習ノートは、復習の列から外します。

## 6. 練習

**共通の部品**：介詞・補語・量詞・了・过・着の練習は、4 択の部品 `ChoicePractice` を共有します。間違えた選択肢には線を引き、正解するまで同じ問題を出します。

**記録**

- 介詞は `PrepositionPracticeRecord`、それ以外は `ComplementPracticeRecord` に `mode` を付けて残します。
- 量詞と了・过・着は、新しい表を作らずに `mode` の値（`measure`・`aspect`）を足しました。記録の一覧と「今日の復習」の作りを、そのまま使えるからです。
- 記録は Web が Prisma で読み書きします。保存と同じトランザクションで、間違えた問題を `ReviewItem` に入れます。同じ id の保存をやり直しても記録は 1 つのままで、ほかの人の id は上書きしません。すでに列にある問題は、期日が先なら期日だけを今に戻し、FSRS の状態は残します。
- 列に入れる処理は、読んでから書くのではなく、1 つの文（`INSERT … ON CONFLICT … DO UPDATE … WHERE "due" > EXCLUDED."due"`）です。復習の答えは同じ行を `FOR UPDATE` で取って FSRS の列を書き換えるので、読んでから書くと同時に起きたとき片方が消えます。1 つの文なら、答えのロックを待ってから、確定した行に対して条件を確かめるので、どちらの書き込みも消えません。

**HSK の級**：問題を、HSK 3.0 の「4 級まで・5 級・6 級以上」で絞れます。級の決め方は 2 通りあり、画面で切り替えられます。

- **手作りの表**：難しい語の表に載っている語が文に含まれるかで決めます。
- **公式の語彙表**：11,092 語の公式の語彙表で、文を最長一致で区切ります。いちばん難しい語の級を、生成スクリプトで前もって表にしておきます（[hsk-levels-official.md](hsk-levels-official.md)）。

**スマホ**：幅 640px 未満では、問題と 4 つの選択肢が下のタブより上に収まるように詰めます。正解すると「次へ」まで、次の問題では問題の上まで自動でスクロールします。

## 7. LINE

```mermaid
sequenceDiagram
  participant U as 利用者の LINE
  participant L as LINE
  participant W as Web
  participant D as DB
  participant O as OpenAI
  U->>L: 中国語の文を送る
  L->>W: Webhook（署名つき。POST /api/line/webhook）
  W->>D: LineMessage に保存（pending）
  alt 時間が 30 秒以上残っている
    W->>O: 添削（JSON スキーマつき）
    W->>D: 学習ノートに保存（done）
    W->>L: reply で結果を返す
  else 時間が足りない
    Note over W,D: pending のまま残す
  end
  Note over W: 毎朝 06:00 JST ごろの拾い直し（Vercel Cron が GET /api/cron/line-drain を呼ぶ）
  W->>D: 5 分以上 pending の行を拾い直す（2 回まで）
  W->>L: 結果か失敗を push。期日の来た復習のお知らせ
```

- Web の入口は `src/app/api/line/webhook/route.ts`（Webhook）と `src/app/api/cron/line-drain/route.ts`（拾い直しと朝のお知らせ）です。Webhook は署名を、リクエストの生のバイト列に対して確かめます。連携の画面（`/account/line`）と Server Actions も Web が Prisma で読み書きし、Go を呼びません。
- **Cron は Web の `vercel.json` に登録しています**：`/api/cron/line-drain` は `0 21 * * *`（06:00 JST）、`/api/cron/demo-reset` は `0 19 * * *`（04:00 JST）で、どちらも UTC です。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて `GET` します。Hobby の Cron は時刻が 1 時間単位で、最大 59 分遅れることがあります。Go に Cron はありません。
- 同じ Webhook が 2 回届いても、`webhookEventId` の一意制約で 1 回だけ処理します。
- Vercel の関数の時間切れで添削が終わらなかった文は、`pending` のまま残し、毎朝の拾い直しが拾い直します。
- 無料プランの push は月 200 通です。お知らせの前に残りを確かめ、拾い直しの返信のために 30 通を残します。

## 8. AI と費用

**呼ぶところ**：OpenAI を呼ぶのは次の 4 か所で、すべて Web（`src/infrastructure/openai/`）です（LINE の添削・翻訳は `line-learning.ts`。Go は OpenAI を呼びません）。どれも Responses API を使います。

| 機能              | モデル                           | 返し方                                                    |
| ----------------- | -------------------------------- | --------------------------------------------------------- |
| LINE の添削・翻訳 | `gpt-5-mini`                     | JSON スキーマで構造化した出力                             |
| 単語帳の下書き    | `gpt-5-mini`                     | JSON スキーマで構造化した出力                             |
| ChatGPT と話す    | 環境変数で変えられる（既定あり） | ストリーミング（Web の Route Handler から NDJSON で直接） |
| クイック質問      | 同上                             | ストリーミング（Web の Route Handler から NDJSON で直接） |

ストリーミングの 2 つは、テキストが出る前の失敗なら 502、出たあとの失敗なら `error` の行で伝えます。ChatGPT と話すは、トークンの上限で切れた答えもそのまま保存します。クイック質問は、途中で切れた答えを保存しません。

**利用量の記録**：呼ぶたびに、機能・モデル・入出力のトークン数を `AiUsage` に記録します。管理者は `/admin/ai-usage` で月ごとに見られます。入力した文や答えは記録しません。

**費用を測ってから考える**：はじめは有料化を考えていたので、料金や無料枠を決める前に、まず 1 人あたりの費用を測れるようにしました（v0.26.0）。商用利用はしないと決めたので、いまは費用を見張るための記録として使っています。

## 9. テスト

| 種類       | 数                    | 中身                                                                                                             |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 単体（TS） | 762 件                | ドメインの規則、表示の変換、層の検査、ログインとセッション                                                       |
| Go         | テストファイル 7 本   | health・設定・ミドルウェア。`store` は本物の Postgres に対して走る                                               |
| E2E        | 320 件（PC とスマホ） | Playwright。Docker の Postgres、Web、OpenAI と LINE と FFPF ID のスタブを立ち上げて画面を通す（Go は起動しない） |

- **E2E の土台**：`e2e/server.ts` が、マイグレーション、`next build`、スタブの起動を行います。Go は起動しません。ログインは Web の `Session` で行い、テストの側が行を書いて `zl_session` を作ります。テストのたびに表を空にします。
- **CSV のパースの検証**：CSV の取り込みを Web に戻したので、約 45 件の CSV の見本は `tests/fixtures/learning-csv/` にあり、TS のパーサー（csv-parse）がその見本と同じ結果を返すことを確かめています。
- **lefthook**：commit の前に format・lint・型チェック、push の前に単体と E2E を走らせます。GitHub Actions の CI は置いていないので、このローカルの確認が関門です。

## 10. デプロイ

- **2 つのプロジェクト**：Vercel に Web と Go API の 2 つのプロジェクトがあります。Go API は Vercel の Go ランタイム（Fluid compute）で動き、`/health` と `/ping` だけを返します。段階 12 で Go API のプロジェクトごと消します。
- **マイグレーション**：本番のマイグレーションは、Web の本番ビルド（`scripts/vercel-build.sh`）が `prisma migrate deploy` で当てます。Go API は別にデプロイするので、マイグレーションは今動いている Go API と両立する形（表の追加、null を許す列の追加）にします。表や列の削除は 2 回のリリースに分けます。
- **DB**：Neon のプール接続を使い、ローカル以外では TLS の検証（`verify-full`）を強制します。

## 11. いまの課題

- **Go が残っている**：Go（`services/api`）は `/health` と `/ping` だけで、使っていません。段階 12 で、`services/api`・`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET`・`ApiRefreshToken`・`docs-site/` を消します。それまでは、本番の Go API のプロジェクトが残ります。
- **セッションは延びない**：Web のセッションは、30 日（ゲストは 24 時間）で必ず切れます。使っていても延ばしません。長く使う人は、月に 1 回ログインし直します。
- **外部キーがない**：管理者は DB に行を持たないので、`ownerId` に外部キーがありません。持ち主の整合性はコードで守っています（フォローは、相手のアカウントがあるときだけ行を足す 1 つの SQL）。
- **CI がない**：GitHub Actions の CI は外しました。確認は lefthook のローカルの検査だけで、`pnpm audit` と `pnpm run build` は自動では走りません。
- **層の検査に抜けがある**：`presentation` から `infrastructure` への import は、まだ制限していません。
