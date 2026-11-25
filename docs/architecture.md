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
  DB[(PostgreSQL / Neon<br/>スキーマは Prisma)]
  OpenAI[OpenAI API]
  LINE[LINE Messaging API]
  GH[GitHub OAuth]
  SID[Sparklingstadt ID<br/>OpenID Connect]

  UI -->|HttpOnly Cookie| Web
  Web -->|Prisma: ログインのセッション（Session）・ログインの試行回数・アカウントの確認・会員の管理・パスワード変更・単語帳・学習ノート・CSV の取り込み・復習・練習の記録・質問ノート・会話ノート・フォロー・タイムライン・学習ログ・AI の利用量の集計・LINE の連携とメッセージ・デモのリセット| DB
  Web -->|単語帳の下書き・クイック質問・チャット・LINE の添削と翻訳| OpenAI
  LINE -->|Webhook| Web
  Web -->|reply・push| LINE
  CRON -->|拾い直し・お知らせの push| LINE
  CRON --> OpenAI
  CRON -->|デモのリセット| DB
  Web -->|ログインの code の交換| GH
  Web -->|ログインの code の交換・ログアウト| SID
```

- アプリは Next.js 1 つです。ブラウザーが話す相手は Web だけで、Vercel のプロジェクトも 1 つです。
- Web は、ログイン中の人を決めるために、実行時に `Session` の行と DB のアカウント（`PasswordAccount`・`SidAccount`）を Prisma（`src/infrastructure/prisma/`）で読みます。単語帳（一覧・保存・削除）と学習ノート（一覧・検索・カレンダー・日ごとの表示・ゴミ箱・共有・CSV の取り込み）と練習の記録（介詞・補語）も Prisma で読み書きし（CSV は Web が自分で検証・解析し、1 つのトランザクションで保存します）、「AI で下書き」・クイック質問・ChatGPT と話すは Web が OpenAI を直接呼んで、使った量を `AiUsage` に記録し、質問ノートと会話ノートも Prisma で読み書きし、フォロー（会員の一覧・タイムライン・フォローする／外す）も Prisma で読み書きし、会員の管理（作成・一覧・パスワードの再設定）と自分のパスワードの変更も Prisma で書き（ハッシュは Web が scrypt で作り、確かめます）、学習ログ（カレンダー）と AI の利用量の月ごとの集計は Prisma で読むだけです。LINE も Web が受け、webhook の署名を確かめ、添削・翻訳の OpenAI を直接呼んで reply し、連携とメッセージ（`LineLink`・`LineLinkCode`・`LineMessage`）を Prisma で読み書きします。デモのリセットも Web が 1 つのトランザクションで行います。ログイン（GitHub・ID とパスワード・Sparklingstadt ID・ゲスト・デモ）とログアウトも Web が行い、`Session` を読み書きします。以前はこれらを Go の API が受け持っていましたが、段階 0〜12 で Web に移し、Go を消しました（下の「2.」）。
- LINE は Web の `POST /api/line/webhook` に Webhook を送ります。Web が署名を確かめ、OpenAI で添削・翻訳し、結果を reply で返します。拾い直しと朝のお知らせは Web の `GET /api/cron/line-drain` で、Web の `vercel.json` の Cron が毎日 06:00 JST ごろに呼びます。

## 2. Go API をやめて Next.js 1 つにした理由

**以前の形**：最初は Next.js だけのアプリで、Auth.js と Prisma で DB を直接読んでいました。2026 年 10 月、iOS アプリから自分の学習ノートを読み書きできるようにするため、ネイティブアプリ向けの Go API を作りました（[2026-10-20-go-mobile-api-design.md](superpowers/specs/2026-10-20-go-mobile-api-design.md)）。同じ規則を Web と Go の 2 か所に持たないように、「画面は Next.js、データと認証は Go」に寄せ、Web も Go の API を呼ぶ形にしました（[2026-10-21-go-api-on-vercel-design.md](superpowers/specs/2026-10-21-go-api-on-vercel-design.md)）。Go は Vercel の別のプロジェクトで動き、Web は `src/infrastructure/go-api/` のアダプタで Go を呼び、ログインは Go の JWT と refresh token でした。

**やめた理由**：利用者（このリポジトリの持ち主）が、Go の処理を自分で読んで理解できなかったためです。全部を自分が読める TypeScript／Next.js にそろえ、処理を自分で追えるようにしました（[2026-11-16-deprecate-go-backend-design.md](superpowers/specs/2026-11-16-deprecate-go-backend-design.md)）。ネイティブアプリ向けの `/v1/...` の API と JWT も、一緒にやめました。

**進め方**：機能ごとに 1 本ずつ PR にして移しました（段階 0〜12。2026 年 11 月）。まず Web が Prisma で DB に直接つなげるようにし、単語帳・学習ノート・CSV・復習・練習の記録・質問・チャット・学習ログ・フォロー・会員の管理・LINE とデモのリセットの順に移し、最後にログインを移して（段階 11）、Go を消しました（段階 12）。どの PR も単独で本番に出せ、差分は 1 機能ぶんです。各段階の本番への反映の手順は、[deployment.md](deployment.md) の「移行の記録」に残しています。段階 12b で `ApiRefreshToken` を消し、Go の移行が終わりました（2026 年 11 月）。

**捨てた案**

- **ログインを先に移す**：途中で Go を「Next.js のセッションを受け取る側」に作り変える必要があり、読めない Go を最初にさわることになるため、採りませんでした。
- **まとめて書き直して一度に切り替える**：数万行の差分を一度に確かめることになり、理解するという目的に反するため、採りませんでした。

**守っている決まり**：Prisma を import してよいのは `src/infrastructure/prisma/` だけで、pg と next-auth は import できません。これを `tests/architecture.test.ts` が検査します。

**コードのコメントと Go**：`src/`・`tests/`・`e2e/` のコメントは、いまのコードが何をし、なぜそうするかだけを書いています。消した Go のファイルや関数を基準にした説明はありません。残っているのは、Go が書いた固定のテストデータ（`tests/fixtures/` の `scrypt-golden.json`・`fsrs-golden.json`・`demo-seed-golden.json`）の由来と、復習の計算が従っているライブラリ go-fsrs の名前だけです。Go のどの処理を移したかは、下の表の計画と `*-go-reference.md` に残しています。

**どこを読めば何が分かるか**

| 知りたいこと                        | 読む所                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 層の分け方と、どこから読むか        | `docs/architecture.md`（3. Web の層）、`src/composition/*-container.ts`（機能ごとの組み立て。ここから application と store へたどれる）                                                |
| ログイン中の人の決め方              | `src/composition/current-user.ts` → `src/infrastructure/identity/session-current-user-provider.ts` → `src/infrastructure/prisma/session-store.ts`                                      |
| ログイン・ログアウト                | `src/composition/identity-container.ts`・`sign-in-container.ts` → `src/application/identity/sign-in.ts`。OAuth は `src/infrastructure/auth/`、コールバックは `src/presentation/http/`  |
| ページの門番（Proxy）               | `src/proxy.ts` → `src/presentation/http/session-gate.ts`（Cookie があるかだけを見る）                                                                                                  |
| 学習ノート・ゴミ箱・共有・検索・CSV | `src/application/learning/learning-notes.ts`、`src/infrastructure/prisma/learning-note-reads.ts`・`learning-note-writes.ts`・`learning-csv-import.ts`                                  |
| 復習（FSRS）                        | `src/application/review/review-queue.ts`、`src/domain/review/`、`src/infrastructure/prisma/review-store.ts`                                                                            |
| 練習の記録・質問・チャット          | `src/application/practice/`・`src/application/chat/`、`src/infrastructure/prisma/practice-record-store.ts`・`question-store.ts`・`conversation-store.ts`、`src/app/api/chat/route.ts`  |
| 単語帳・学習ログ・AI の利用量       | `src/application/vocabulary/`・`study-log/`・`ai-usage/`、対応する `src/infrastructure/prisma/*-store.ts`、OpenAI は `src/infrastructure/openai/`                                      |
| フォロー・会員の管理・パスワード    | `src/application/social/social-network.ts`、`src/application/identity/member-accounts.ts`・`own-password.ts`、`src/infrastructure/prisma/social-store.ts`・`password-account-store.ts` |
| LINE と cron                        | `src/app/api/line/webhook/route.ts`・`src/app/api/cron/*/route.ts` → `src/application/line/line-bot.ts`・`src/application/demo/demo-reset.ts`、`vercel.json` の `crons`                |
| 失敗したときの画面の文言とログ      | `src/presentation/controllers/action-state.ts`・`load-or.ts`                                                                                                                           |
| 各段階で Go の何をどこへ移したか    | 各段階の計画（`docs/superpowers/plans/2026-11-16-deprecate-go-stage*.md`）と、`*-go-reference.md`（Go の処理の `file:line` の記録）、各 PR の説明の対応表                              |
| 消した Go のファイルの中身          | 計画と `*-go-reference.md` に出てくる Go のファイル（`services/api/` の下にありました）を、`git show "$(git log -1 --format=%H -- <道>)^:<道>"` で読む                                 |
| 本番への反映と、各段階で行った手順  | `docs/deployment.md`（「移行の記録（段階 1〜12）」）                                                                                                                                   |

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

- **ログインの切れ目**：Cookie `zl_session` が無いときは Proxy が、行が無い・期限切れのときは各ページと Server Action が、ログイン画面へ送ります。
- **接続元の IP**：`x-real-ip` / `x-forwarded-for` から Web が自分で決め、ログインの試行回数に使います。

## 4. 認証

ログインとログアウトは、すべて Web が行います。

| ログイン          | 中身                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub OAuth      | PKCE つき。管理者だけ。管理者は GitHub の数字の ID の許可リスト（`AUTH_ALLOWED_GITHUB_IDS`）で決める。code の交換は Web（`AUTH_GITHUB_ID` と `GITHUB_WEB_CLIENT_SECRET`）                                                                                                                                                                                                     |
| ID とパスワード   | 管理者が発行する会員。パスワードは scrypt（N=2^15, r=8, p=1）で、書き込みも確認も Web（`src/infrastructure/security/scrypt-password-hasher.ts`）。`tests/fixtures/scrypt-golden.json` は、以前の Go が書いた固定のファイル                                                                                                                                                    |
| Sparklingstadt ID | 自作の ID サーバー（sparklingstadt-id）の OpenID Connect。ID トークンは `jose` で検証する（ES256 の署名、iss・aud・exp。鍵は ID サーバーの JWKS を 10 分覚え、exp の猶予は 60 秒）。nonce・email_verified・email・sub は Web が確かめる（`src/infrastructure/auth/sid-oidc-client.ts`）。code の交換は Web（`SID_CLIENT_SECRET`）。ログアウトでは ID サーバーのログインも消す |
| ゲスト            | データを持たない。練習だけ使える                                                                                                                                                                                                                                                                                                                                              |
| デモ              | `DEMO_LOGIN_ID` のアカウントに、パスワードなしで入る。全員で 1 つのアカウントを使う                                                                                                                                                                                                                                                                                           |

GitHub と Sparklingstadt ID が code を交換するときの `redirect_uri` は、`AUTH_URL` の origin から決まります（GitHub は `/api/auth/callback/github/go`、Sparklingstadt ID は `/api/auth/callback/sid`）。GitHub の OAuth App と Sparklingstadt ID のサーバーに登録した URL と 1 文字でも違うと、ログインできません。

**セッション（`zl_session`）**

- ブラウザーの Cookie `zl_session`（HttpOnly・SameSite=Lax）に、ランダムな 32 バイトのトークンを置きます。DB の `Session` には、トークンの SHA-256 のハッシュだけを保存します。
- ログインのたびに、新しいトークンを出します。そのブラウザーの前のセッションの行は消し、`zl_act_as` と、Go の時代の Cookie（`zl_access`・`zl_refresh`）も消します。
- 期限は固定です。会員と管理者は 30 日、ゲストは 24 時間で、使っても延びません。期限が来たら、ログインし直します。
- 期限切れの行は、ログインのたびに最大 100 行まで消します。別のジョブは要りません。
- ログアウトは、自分の行を消し、Cookie を消します。DB が失敗しても、Cookie は消します。

**毎回の確かめ**：リクエストのたびに、Cookie のトークンから `Session` の行を引き、次を確かめます。アカウントの `sessionVersion` や `zl_act_as` を変えたら、次のリクエストから効きます。許可リスト（`AUTH_ALLOWED_GITHUB_IDS`）とデモの `DEMO_LOGIN_ID` は、モジュールを読み込むときに 1 度だけ読むので、変えたら再デプロイのあとに効きます。

- 行が無い・期限切れ・形が違うときは、未ログインです。
- 管理者は、`AUTH_ALLOWED_GITHUB_IDS` に載っているときだけ管理者です。外れていると `revoked` で、どのページも使えません（外したのが効くのは、再デプロイのあとです）。
- 会員は、アカウントがあり、`sessionVersion` が行に書いた値と同じときだけ通ります。デモのアカウントには、デモの印を付けます。
- ゲストは、DB のアカウントを読みません。

**Proxy**：`src/proxy.ts` は、Cookie `zl_session` があるかだけを見ます。DB は読まず、更新もしません。無ければログイン画面へ送ります。中身の確かめは、上の「毎回の確かめ」を各ページ・Server Action・Route Handler が行います。

**失効**

- 会員がパスワードを変えると、またはパスワードを管理者が再設定すると、Web が 1 つの `UPDATE` でハッシュと `sessionVersion` を変え、その人の `Session` の行をすべて消します。ほかの端末も、次のリクエストでログインし直しになります。
- 管理者は、許可リストから外して再デプロイしたあと、`revoked` になります（行は期限まで残ります）。
- 全員をログアウトさせたいときは、`DELETE FROM "Session"` を実行します（[deployment.md](deployment.md) の「7. 運用上の注意」）。

**試行回数**

- 接続元ごと、接続元とログイン ID の組ごとに、15 分の窓で数えます（`SignInThrottle`）。Web が数えます。
- アカウントそのものはロックしません。ほかの場所からの失敗で、本人が締め出されないようにするためです。

**会員として操作**：管理者は、会員の画面を閲覧のみで見られます。管理者がメニューから会員を選ぶと、Web が Cookie `zl_act_as`（会員の `ownerId`）を書きます。Web は、リクエストのたびに、管理者であることを確かめ、`zl_act_as` が `password:` ＋英小文字と数字だけの形で、そのパスワードアカウントが DB にあることを確かめます。1 つでも外れると、`zl_act_as` は無視して、管理者自身の画面を出します。管理者以外には効きません。LINE の連携はできず（LINE 連携の画面は `/` に戻ります）、AI の利用量は管理者のほうに数えます。新しくログインすると、`zl_act_as` は消えます。

## 5. 復習

- **計算**：FSRS-6（重みが 21 個の版のアルゴリズム）で次の期日を決めます。計算は npm の [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 6.0.1 が行い、`src/domain/review/fsrs.ts` は、`ReviewItem` の列とライブラリのカードの形を変換するだけです。定着率 90%、学習中のステップは 1 分と 10 分、再学習のステップは 10 分、ばらつき（fuzz）はなしです。評価は「もう一度・難しい・できた・簡単」の 4 段階です。
- **ライブラリの組み立て方**：ts-fsrs の `DefaultScheduler({ version: "FSRS-6" })` はモデルを非同期で読み込むので、同じ部品（モデルと、定着率・学習ステップ・最大間隔などの決まり）を同じ順に `defineScheduler` で組み立て、同期の関数のまま呼べるようにしています。`DefaultScheduler` と同じ答えになることを `tests/review-fsrs.test.ts` で確かめています。6.0 で非推奨になった `fsrs()` は使いません。
- **以前の計算との違い**：2026 年 11 月まで、計算は [go-fsrs](https://github.com/open-spaced-repetition/go-fsrs) v4.0.0 を手で移した TypeScript でした。そのころに保存したカードは、そのまま続きから計算できます（状態・回数・残りのステップは変わりません）。期日が変わるのは次の場合だけで、`tests/fixtures/fsrs-golden.json`（go-fsrs の結果を書いた固定のファイル）でこの範囲に収まることを確かめています。
  - 新しいカードと学習中のカードの「難しい」は 5.5 分後です（以前は 6 分に丸めていました）。
  - 学習中・再学習中の「簡単」は、「できた」より必ず 1 日以上あとになります。そのため、以前より 1 日遅くなることがあります。
  - stability と difficulty は小数 8 桁に丸めます。乱数で作った 50 万回の回答では、復習中のカードの期日が 1 日ずれたのが 7 回でした。
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

- Web の入口は `src/app/api/line/webhook/route.ts`（Webhook）と `src/app/api/cron/line-drain/route.ts`（拾い直しと朝のお知らせ）です。Webhook は署名を、リクエストの生のバイト列に対して確かめます。連携の画面（`/account/line`）と Server Actions も Web が Prisma で読み書きします。
- **Cron は Web の `vercel.json` に登録しています**：`/api/cron/line-drain` は `0 21 * * *`（06:00 JST）、`/api/cron/demo-reset` は `0 19 * * *`（04:00 JST）で、どちらも UTC です。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて `GET` します。Hobby の Cron は時刻が 1 時間単位で、最大 59 分遅れることがあります。
- 同じ Webhook が 2 回届いても、`webhookEventId` の一意制約で 1 回だけ処理します。
- Vercel の関数の時間切れで添削が終わらなかった文は、`pending` のまま残し、毎朝の拾い直しが拾い直します。
- 無料プランの push は月 200 通です。お知らせの前に残りを確かめ、拾い直しの返信のために 30 通を残します。

## 8. AI と費用

**呼ぶところ**：OpenAI を呼ぶのは次の 4 か所で、すべて Web（`src/infrastructure/openai/`）です（LINE の添削・翻訳は `line-learning.ts`）。どれも Responses API を使います。

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

| 種類       | 数                                           | 中身                                                                                                    |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 単体（TS） | 797 件                                       | ドメインの規則、表示の変換、層の検査、ログインとセッション、サーバーアクションとページ用ガード          |
| E2E        | 269 件（PC 164 件、うち 105 件はスマホでも） | Playwright。Docker の Postgres、Web、OpenAI と LINE と Sparklingstadt ID のスタブを立ち上げて画面を通す |

- **E2E の幅**：PC とスマホ（Pixel 7）の 2 つの幅で走らせます。リダイレクト、入力の検査、権限、HTTP ヘッダーのようにサーバーのふるまいだけを見る 59 件は、幅で結果が変わらないので PC だけで走らせます（`e2e/fixtures.ts` の `anyWidth`）。
- **E2E の土台**：`e2e/server.ts` が、マイグレーション、`next build`、スタブの起動を行います。ログインは Web の `Session` で行い、テストの側が行を書いて `zl_session` を作ります。テストのたびに表を空にします。
- **CSV のパースの検証**：CSV の取り込みを Web に戻したので、約 45 件の CSV の見本は `tests/fixtures/learning-csv/` にあり、TS のパーサー（csv-parse）がその見本と同じ結果を返すことを確かめています。
- **lefthook**：commit の前に format・lint・型チェック、push の前に単体と E2E を走らせます。
- **CI**：GitHub Actions の `verify`（`.github/workflows/verify.yml`）が、プルリクエストと main で、`pnpm audit`・型チェック・lint・単体・本番ビルド・E2E を走らせます。lefthook と同じ検査に、手元では走らせていない `pnpm audit` と本番ビルドを足したものです。

## 10. デプロイ

- **1 つのプロジェクト**：Vercel に Web の 1 つのプロジェクトがあります。main にマージすると本番のビルドが走り、Ready になったら `vercel promote` で切り替えます。毎日の定期実行は Vercel Cron（`vercel.json`）です。手順は [deployment.md](deployment.md) にあります。
- **リリースと切り替え**：main で `verify` が通り、そのマージが `package.json` の version を変えていれば、`release`（`.github/workflows/release.yml`）がタグと GitHub Release を作り、続けて `deploy`（`deploy.yml`）がそのコミットの本番ビルドを `vercel promote` で切り替えます。version を変えないマージは、ビルドされるだけで本番には出ません。
- **マイグレーション**：本番のマイグレーションは、Web の本番ビルド（`scripts/vercel-build.sh`）が `prisma migrate deploy` で当てます。切り替えるまでは前のデプロイが新しいスキーマの上で動くので、マイグレーションは前のデプロイのコードと両立する形（表の追加、null を許す列の追加）にします。表や列の削除は 2 回のリリースに分けます。
- **DB**：Neon のプール接続を使い、ローカル以外では TLS の検証（`verify-full`）を強制します。

## 11. いまの課題

- **Go の古い Cookie を消す処理が残っている**：`LEGACY_SESSION_COOKIES`（Go の古い Cookie の `zl_access`・`zl_refresh` を、ログインとログアウトのたびに消す処理）は、11b の切り替えから 30 日たてば要りません。2026 年 12 月の末を過ぎたら消してよいです。
- **セッションは延びない**：Web のセッションは、30 日（ゲストは 24 時間）で必ず切れます。使っていても延ばしません。長く使う人は、月に 1 回ログインし直します。
- **外部キーがない**：管理者は DB に行を持たないので、`ownerId` に外部キーがありません。持ち主の整合性はコードで守っています（フォローは、相手のアカウントがあるときだけ行を足す 1 つの SQL）。
- **層の検査に抜けがある**：`presentation` から `infrastructure` への import は、まだ制限していません。
