# Go バックエンドを廃止し、Next.js だけにする

## 目的と理由

`services/api/` の Go API をなくし、その処理をすべて Next.js（このリポジトリの Web）に移して、アプリを 1 つにする。

理由は、**利用者が Go の処理を自分で読んで理解できないため**。全部を自分が読める TypeScript／Next.js にそろえ、処理を自分で追えるようにする。迷ったときは、この理由に照らして決める。

## 今の作り（2026-11-16 時点）

- 段階 2〜3（`2026-10-21-web-auth-via-go-api-design.md`、`2026-10-22-web-data-via-go-api-design.md` ほか）で、Web は画面だけになった。データの読み書き、ログイン、チャット、LINE、AI の利用量は、すべて Go API が持っている。
- Web は `src/infrastructure/go-api/` の約 20 個のアダプタで Go を呼ぶ。画面と Server Action の制御は `src/presentation/`、組み立ては `src/composition/*-container.ts`、型とユースケースは `src/domain/`・`src/application/` にある。
- Go はテストを除いて約 1.3 万行ある（`httpapi` 4.4k、`store` 3.4k、`auth` 1.9k、`linebot` 0.6k、ほか）。API は約 70 本ある。
- Go の Vercel プロジェクトには 2 つの cron がある（`/v1/line/drain` 毎日 21:00 UTC、`/v1/cron/demo-reset` 毎日 19:00 UTC）。
- ログイン：Go が JWT（HS256、`API_JWT_SECRET`）のアクセストークンと refresh token（`ApiRefreshToken` テーブル）を発行する。Web はそれを `zl_access`・`zl_refresh` の Cookie に入れ、`src/proxy.ts`（`go-proxy.ts`）で更新する。管理者の「メンバーとして見る」は `zl_act_as` の Cookie を使う。
- DB のスキーマとマイグレーションは Prisma（`prisma/schema.prisma`、出力は `src/generated/prisma`、`@prisma/adapter-pg`）にある。Web は実行時には DB にさわっていない。
- 以前の TypeScript のデータ層は小さかったので、昔の実装を戻せる部分はほとんどない。

## ゴール

- Go のコード・Go の Vercel プロジェクト・Go 向けの CI とスクリプトがすべてなくなり、Web だけで今の機能がすべて動く。
- 移した処理は、今の Web の作り（domain／application／infrastructure／presentation、Server Actions、Route Handler）にならい、Next.js として素直な書き方になっている。
- 画面の動きは今と変わらない。今の e2e（約 90 件）が、Go なしで通る。

## 非ゴール

- モバイルアプリ（ネイティブアプリ）向けの JSON API は残さない（利用者が決定）。`/v1/...` の外向けの API、JWT と refresh token による認証はなくす。
- 新しい機能を足したり、画面を作り変えたりはしない。
- DB のデータは移さない。スキーマを大きく変えることもしない。

## アンチゴール（動いても失敗とみなすこと）

- Go の処理を 1 行ずつ TypeScript に写しただけで、Next.js として読みにくいコードになること。読みやすさを、Go との細かな一致より優先する。
- 移している途中で、本番の機能が止まったりログインが切れたりすること。
- 1 つの PR が大きすぎて、利用者が中身を追えないこと。

## 進め方の候補（検討したもの）

- **A. 機能ごとに少しずつ移す**（**採用**）。まず Next.js が `zl_access` を自分で確かめ、Prisma で DB に直接つなげるようにする。次に機能ごとに 1 本ずつ PR にして移し、最後にログインを移して Go を消す。どの PR も単独で本番に出せ、差分が 1 機能ぶんで読みやすい。PR は十数本になり、途中しばらく Go と Next.js が同じ DB を使う。
- **B. ログインを先に移す**。途中で Go を「Next.js のセッションを受け取る側」に作り変える必要があり、読めない Go を最初にさわることになるため、採用しない。
- **C. まとめて書き直して一度に切り替える**。数万行の差分を一度に確かめることになり、理解するという目的に反するため、採用しない。

## 決めたこと

利用者が決めたこと：

1. Go をやめて Next.js だけにする。
2. モバイル向けの API は残さない。
3. 進め方は A（機能ごとに少しずつ移す）。
4. PR のプレビューのデプロイは、本番とは別の Neon のブランチを使う。段階 0 で Web が実行時に DB を読み書きするようになると、プレビューが本番のデータを書き換えたり、本物の利用者に LINE を送ったりしかねないため（Go のプレビューと同じルール）。Web の Vercel プロジェクトの Preview の `DATABASE_URL`（と `API_JWT_SECRET` などの秘密の値。本番とは別のもの）は、段階 0 を出す前に利用者が設定する。段階 0 の PR の説明に、その手順を書く。プレビューのビルドは、今と同じくマイグレーションを当てない。そのため、プレビュー用のブランチのスキーマは、本番から作り直すか `prisma migrate deploy` で合わせる（手順は段階 0 で書く）。

設計者（Claude）の判断（利用者が直せる）：

5. **移している途中のログイン中の人の見分け方。** Next.js が `zl_access` の JWT を `API_JWT_SECRET` で自分で検証し、その中の利用者 ID と役割を使う。DB から読む必要があれば Prisma で読む。トークンの発行と更新（ログイン・`proxy.ts` での refresh）は、段階の最後まで Go のままにする。
   検証は、Go の `Authenticate`（`services/api/auth/session.go`）と同じ結果にする。どれか 1 つでも抜けると、Go と Next.js が並んで動くあいだに、見られる範囲が黙って広がってしまうため。具体的には次の 5 つ。
   - `iss`（`ffpf-zhuelog-api`）と `aud`（`ffpf-zhuelog-mobile`）を確かめる。
   - 管理者は、毎回 `AUTH_ALLOWED_GITHUB_IDS` に入っているかを確かめる。この環境変数を Web にも入れる。
   - 会員は、トークンの `sv` がそのアカウント（パスワード会員・FFPF ID 会員それぞれ）の今の `sessionVersion` と同じかを確かめる。
   - `zl_act_as` は、ほかの人として見ていない管理者だけが使える。相手は、`^password:[a-z0-9]{1,64}$` に合い、実在するアカウントの ownerId に限る。
   - デモのアカウントは、Go で `notForDemo` の操作をさせない。
6. **最後のログインのしくみ。** JWT と refresh token はやめる。どこを読めば何が起きるかを、いちばん追いやすい形にするための判断。
   - ログインしたら、推測できない乱数のトークンを作る。そのハッシュを DB の新しい `Session` テーブルに保存し、トークンは httpOnly の Cookie に入れる。
   - 失効は今と同じにする。ログアウトでは、その行を消す。パスワードの変更と管理者による再設定では、`sessionVersion` を上げ、その持ち主のセッションをすべて消す（今のセッションも含む）。管理者は、毎回 `AUTH_ALLOWED_GITHUB_IDS` を確かめる（外されたらすぐ使えなくなる）。
   - 長さは、ふつうのセッションが 30 日、ゲストが 24 時間。ゲストは今と同じく全員が ownerId `guest` を共有する。
   - 切り替えた時点で、今のログインはすべて切れる（一度ログインし直してもらう）。これは許容する。
   - OAuth のコールバックのパス（`/api/auth/callback/github/go`、`/api/auth/callback/ffpf`）は変えない。GitHub と FFPF ID に登録してある URL を、利用者が直さなくて済むようにするため。
7. **DB の読み書き。** Next.js の実行時に Prisma Client（`src/generated/prisma`、`@prisma/adapter-pg`）を使う。Go の SQL のうち Prisma で素直に書けないもの（`pg_trgm` の検索など）は、`$queryRaw` で書き、そのわけをコメントに書く。
8. **移した機能の Go のコードは、同じ PR で消す。** そのハンドラ・store・テスト・Web の Go アダプタと、そのテストを消す。Go がどこまで残っているかが、いつでも見て分かるようにするため。ただし、ほかの Go のコードが使う部分は、使う側を移すまで残す。
9. **コードの書き方。** 機能ごとに、今の `src/domain` の型と `src/application` のポートを使う。実装は `src/infrastructure/prisma/<機能>-repository.ts`（などのアダプタ）に置き、`src/composition/<機能>-container.ts` で Go のアダプタと差し替える。コメントは今のコードに合わせて英語にする。各 PR の説明（日本語）には「Go ではどこで何をしていたか → TypeScript ではどのファイルで行うか」の対応表を書き、利用者が処理をたどれるようにする。
10. **cron と LINE。** LINE の webhook とリンク、drain、デモのリセットは、Next.js の Route Handler（`src/app/api/...`）に移す。cron は Web の `vercel.json` の `crons` に移す。cron の認証は Vercel の `CRON_SECRET`（Go と同じやり方）で行う。
11. **OpenAI を呼ぶ処理**（チャット・クイック質問・単語帳の下書き・LINE の添削）は Next.js のサーバー側から呼ぶ。チャットのストリーミングは、今の `src/app/api/chat/route.ts` の中継をやめ、Route Handler から直接ストリームを返す。AI の利用量（`AiUsage`）の記録も同じところで行う。

## 段階（PR の順番）

順番は設計者の判断。依存の少ないものから始め、ログインと LINE を最後にする。各 PR は main にマージして本番に出してから、次へ進む。

0. **土台。** Prisma Client を Web の実行時に使えるようにする（`DATABASE_URL` を Web に戻す）。`zl_access` の JWT を Next.js で検証して、ログイン中の人を取る `CurrentUserProvider` を作り、`/v1/me` の代わりにする（決めたこと 5）。e2e で Next.js が DB を使えるようにする。
1. **単語帳**（`/v1/vocabulary*`、OpenAI の下書きを含む）。
2. **学習ノート・ゴミ箱・共有・カレンダー・検索**（`/v1/entries*`、`/v1/trash*`、`/v1/log-dates*`、`/v1/batches`）。
3. **CSV の取り込み**（`/v1/imports/csv`）。
4. **復習**（`/v1/reviews*`、`/v1/entries/{id}/review`）。
5. **補語・前置詞の練習記録**（`/v1/complement-records*`、`/v1/preposition-records*`）。
6. **質問・クイック質問**（`/v1/questions*`、`/v1/quick-question`）。
7. **チャット**（`/v1/chat`、`/v1/conversations*`）。
8. **学習ログ・AI の利用量**（`/v1/study-log`、`/v1/admin/ai-usage`）。
9. **フォロー・タイムライン・会員の一覧・会員管理・パスワード変更**（`/v1/follows*`、`/v1/timeline`、`/v1/members`、`/v1/admin/accounts*`、`/v1/account/password`）。
10. **LINE とデモのリセットの cron**（`/v1/line/*`、`/v1/cron/demo-reset`）。
11. **ログイン**（GitHub・パスワード・FFPF ID・ゲスト・デモ・ログアウト・ログイン制限）。決めたこと 6 のセッションに切り替え、`proxy.ts` を Next.js のセッション向けに直す。
12. **後片付け。** `services/api/` と `src/infrastructure/go-api/` の残り、Go の CI・スクリプト（`api:*`）・`compose.api.yaml`、`docs-site/`（API ドキュメント）、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す。`ApiRefreshToken` テーブルを消すマイグレーションを足す。README・`docs/development.md`・`.env.example` を Next.js だけの構成に直す。Go の Vercel プロジェクトの削除は利用者が行う。

途中で PR が大きくなりすぎた段階は、さらに分けてよい。

### 動いている Go の止め方（設計者の判断）

- Go のコードを消しても、すでにデプロイされた Go は古いルートを返し続ける。そのため、各段階を本番に出したあと、Go もそのコードで Vercel CLI から出し直す。デプロイは利用者の確認のうえで行う。
- 段階 0 では、Web の本番の `DATABASE_URL` が Neon の pooled の URL か確かめる（Go と同じ）。実行時には pooled、マイグレーションには direct を使う。今の値が direct なら、実行時用の変数を別に足し、利用者に設定してもらう。
- 段階 10 は、LINE の返信や OpenAI の呼び出しが二重に走らないよう、次の順で切り替える。
  1. LINE の Route Handler を入れた Web を出す。この時点では cron は入れない。
  2. LINE Developers の webhook の URL を、利用者が Web のものに変える。
  3. LINE と cron を消した Go を出し直す。
  4. Web の `vercel.json` に cron を足して出す。

  途中で drain が 1 回飛ぶことと、webhook を変える数分のあいだに LINE が届かないことは許容する。

- 段階 12 で `ApiRefreshToken` を消すマイグレーションは、利用者が Go の Vercel プロジェクトを消したあとにだけ本番に出す。

## 各 PR の共通の進め方

- Go の該当のハンドラ・store・テストを読み、入力の検証・権限・エラーの文言・並び順を TypeScript でも同じにする。
- Go のテストにあった確かめごとは、意味のあるものを Web の unit テスト（`tests/`、`pnpm test:unit`）に移す。DB を使う確かめは、e2e か、Docker の Postgres を使うテストで行う。
- `pnpm test:regression`（typecheck・lint・unit・build・e2e）が通ること。
- 本番の Web の環境変数に、その段階で必要になるもの（`DATABASE_URL`、`OPENAI_API_KEY`、LINE の秘密鍵など）を足す手順を、PR の説明に書く。環境変数の設定とデプロイは、利用者の確認のうえで行う。

## 制約

- Next.js はこのリポジトリのバージョン（16.4 系）で、知っている API と違うことがある。書く前に `node_modules/next/dist/docs/` を読む（`AGENTS.md`）。
- Node 24、pnpm、Prisma 7。
- 本番は Vercel。GitHub の CI の時間を使い切っているため、ローカルでテストを通してから Vercel CLI でデプロイする運用が続いている。
- e2e は 1 度に 1 本しか走らせられない（compose の名前とポートが固定）。

## 作る人に任せること

- 各機能の中のファイルの分け方、関数の名前、Prisma のクエリの書き方。
- Go のエラーの文言は日本語で、今の画面に出ている。Next.js でも同じ文言にするが、置き場所は任せる。
- 段階 0 の JWT の検証に使うライブラリ（依存を増やさず `node:crypto` で HS256 を確かめてもよい）。

## 範囲外

- モバイルアプリと、その API。
- 画面の作り変え、新しい機能。
