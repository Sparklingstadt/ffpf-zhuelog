# 本番への反映（Vercel）

Web（Next.js）を Vercel の 1 つのプロジェクトで動かします。main にマージすると本番のビルドが走り、未適用の Prisma のマイグレーションを当ててからビルドします（`scripts/vercel-build.sh`）。Web の本番は、Ready になったあと `vercel promote` で切り替えます。

以前の名前は `docs/api-deployment.md` です（段階 12 で改名）。Go の API のプロジェクトは、段階 12 の 12a のあとに、利用者が消します（手順は「段階12（後片付け）のマージの前と後」）。

## 1. 本番の DB とマイグレーション

スキーマは Prisma のマイグレーションで管理します。ログインのセッションは `Session`、ログインの試行回数は `SignInThrottle` です。`ApiRefreshToken` は段階 12b で消しました（末尾の「移行の記録」の「段階12（後片付け）のマージの前と後」）。マイグレーションは、Web の **本番ビルド** が自動で適用します。`vercel.json` の `buildCommand` が `scripts/vercel-build.sh` を動かし、`VERCEL_ENV=production` のときだけ `prisma migrate deploy` を実行してから `next build` します（Preview のビルドは自分の Neon ブランチを使い、マイグレーションは当てません）。そのため、Web の Production には `DATABASE_URL` が必要です。無い・つながらない・DDL が失敗すると、本番の Web のデプロイが失敗します（失敗したビルドの本番は、前のバージョンのままです）。

**マイグレーションの制約**: 本番のビルドがマイグレーションを当ててから `vercel promote` で切り替えるまでは、前のデプロイの Web が新しいスキーマの上で動きます。そのため、マイグレーションは前のデプロイのコードとそのまま両立する形にします。足してよいのは、表の追加と、null を許す列（または既定値のある列）の追加だけです。列・表の削除や名前の変更、型の変更、NOT NULL の追加のような壊す変更は、2 回のリリースに分けます（1 回目で新しい形を足してコードを切り替え、2 回目のリリースで古い形を削除します）。

マイグレーションが当たったことの確認と、自動で当たらなかったときの手動の適用は、次のとおりです。`migrate status` で未適用が無いこと（「Database schema is up to date!」）を確かめます。

```bash
vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.production.local node_modules/prisma/build/index.js migrate status
rm .env.production.local
```

会員の一覧（Web の `/follow`）は、DB の日本語の照合順序 `ja-x-icu` で並べます。本番の Neon にあるかを一度確かめてください（1 行返れば問題ありません。無いと `/follow` がエラーになります）。

```sql
SELECT 1 FROM pg_collation WHERE collname = 'ja-x-icu';
```

## 2. Web の設定

Web（Next.js）は、ログインも学習ノートの読み書きも自分で行います。ログイン中の人は、Cookie `zl_session` のトークンの SHA-256 で DB の `Session` の行を引いて決め、DB の `PasswordAccount`・`FfpfAccount` を Prisma（`src/infrastructure/prisma/`）で読みます。ログインとログアウトも Web が行います（GitHub・ID とパスワード・FFPF ID・ゲスト・デモ）。会員の管理とパスワードの変更は `PasswordAccount`・`SignInThrottle` に書き、パスワードの変更と管理者の再設定は、そのアカウントの `Session` も同じトランザクションで消します。設計は `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md` にあります。

Web の Vercel プロジェクトの Production に入れる、ログインの値は次のとおりです。

| 名前                       | 内容                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_URL`                 | Web の公開されている origin（例: `https://ffpf-zhuelog.sparklingstadt.com`）。GitHub と FFPF ID の `redirect_uri` を決める |
| `AUTH_GITHUB_ID`           | Web 用 GitHub OAuth App の Client ID                                                                                       |
| `GITHUB_WEB_CLIENT_SECRET` | Web 用 GitHub OAuth App の Client Secret（段階 11 までは Go に入れていた値。読み戻せないときは、新しく作る）               |
| `FFPF_ID_ISSUER`           | FFPF ID（portal）の issuer（段階 11 までは Go に入れていた値）                                                             |
| `FFPF_ID_CLIENT_ID`        | portal に登録した zhuelog のクライアント ID（段階 11 までは Go に入れていた値）                                            |
| `FFPF_ID_CLIENT_SECRET`    | portal の `pnpm run oidc:client zhuelog` で作ったシークレット（段階 11 までは Go に入れていた値）                          |

注意:

- `AUTH_URL` は必ず設定し、利用者が開く Web の origin と同じにします。GitHub の `redirect_uri` は `<AUTH_URL の origin>/api/auth/callback/github/go`、FFPF ID の `redirect_uri` は `<AUTH_URL の origin>/api/auth/callback/ffpf` です。どちらも、GitHub の OAuth App と FFPF ID の portal に登録した URL と **1 文字も違わず** 同じにします。
- GitHub の OAuth App の callback URL は、以前から登録している `https://<Web>/api/auth/callback/github` のままにします。GitHub は登録した callback URL の **下の階層** を `redirect_uri` に使えるので、`/api/auth/callback/github/go` はその下になり、設定を変える必要はありません。FFPF ID の portal に登録した redirect URI も変えません。
- `AUTH_GITHUB_ID` と `GITHUB_WEB_CLIENT_SECRET` は、同じ OAuth App の組にします。違うと、GitHub が `code` の交換を断り、GitHub ログインが失敗します。
- 足りないときの症状：
  - `GITHUB_WEB_CLIENT_SECRET`（または `AUTH_GITHUB_ID`）が無いと、ログイン画面の GitHub のボタンが押せません。
  - `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` のどれかが無い（または `FFPF_ID_ISSUER` が `https://` でない。`localhost`・`127.0.0.1` を除く）と、「FFPF IDでログイン」が出ません。
  - `AUTH_URL` が違う（または無くて、リクエストの origin と登録した URL が合わない）と、GitHub と FFPF ID が `redirect_uri` を登録した URL と合わないと判断して、ログインできません。ログイン画面に戻り、エラーが出ます。
- パスワード・ゲスト・デモのログインは、上の値が無くても使えます（`DATABASE_URL` は要ります）。
- Preview には、`GITHUB_WEB_CLIENT_SECRET` と `FFPF_ID_CLIENT_SECRET` を **入れません**。プレビューの URL は、GitHub と FFPF ID に登録した URL と合わないためです（下の「Web のプレビュー（Preview）」）。
- `AUTH_SECRET`・`AUTH_GITHUB_SECRET` は、Web では使いません。`DATABASE_URL` は、Web の実行時にも、**本番のビルド**の `prisma migrate deploy` にも使います（「1. 本番の DB とマイグレーション」）。消すと、ログイン中の人を決められず、本番の Web のデプロイも失敗します。

LINE 連携を使うときは、Web の Vercel プロジェクトに、もう 1 つ次の値を入れます（無くても Web は動きます）。

| 名前                       | 内容                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `LINE_ADD_FRIEND_URL`      | LINE 公式アカウントの友だち追加のリンク（例: `https://line.me/R/ti/p/@your-account`）。`https://` で始まるものだけ使います   |
| `LINE_OFFICIAL_ACCOUNT_ID` | 連携 QR と「LINEで開く」の送信先となる公式アカウントの公開 ID（`@393bohaw`）。コードは入力欄に入るだけで、自動送信はしません |

`LINE_ADD_FRIEND_URL` が無い・`https://` で始まらないときは、「LINE 連携」画面（`/account/line`）に友だち追加のリンクを出しません（連携コードの発行と解除はできます）。

FFPF ID でのログインを使うときは、上の表の `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` の 3 つを入れます（「5. FFPF ID でのログイン」）。3 つがそろっていないときは、ログイン画面に「FFPF IDでログイン」を出しません。

### Web が実行時に使う DB と秘密

Web は実行時に、次の値を使います。Web の Vercel プロジェクトの Production に入れます。

| 名前                        | 内容                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | Neon の接続文字列。実行時の読み取りに使う。pooled の URL か **確かめる**（下の注を参照）                                                                                          |
| `AUTH_ALLOWED_GITHUB_IDS`   | 管理者にする GitHub ユーザーの数字の ID（カンマ区切り。空なら管理者は誰も通らない）。Web がモジュールを読み込むときに 1 度だけ読むので、変えたら再デプロイが要る                  |
| `DEMO_LOGIN_ID`             | デモアカウントのログイン ID。Web がデモのログインとリセット（`/api/cron/demo-reset`）に使い、空ならデモのボタンは出ず、リセットのルートは `404`。デモを使わないなら入れなくてよい |
| `OPENAI_API_KEY`            | 単語帳の「AI で下書き」に使う OpenAI の API キー。無いと下書きは「今は使えません」になる                                                                                          |
| `OPENAI_LEARNING_MODEL`     | 単語帳の下書きと LINE の添削・翻訳のモデル（任意。無ければ `gpt-5-mini`）                                                                                                         |
| `LINE_CHANNEL_SECRET`       | LINE の Messaging API のチャネルシークレット。**Production だけ**（下の注を参照）                                                                                                 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE の長期のチャネルアクセストークン。**Production だけ**                                                                                                                        |
| `CRON_SECRET`               | `/api/cron/line-drain` と `/api/cron/demo-reset` の認証用の秘密。**Production だけ**。Vercel が Cron の呼び出しに `Authorization: Bearer <値>` を付ける                           |
| `LINE_API_BASE_URL`         | テスト専用。LINE の API の接続先の差し替え（ループバックの URL だけ。本番には設定しない）                                                                                         |
| `OPENAI_CHAT_MODEL`         | クイック質問と ChatGPT と話すのモデル（任意。無ければ `gpt-6.1-sol`）                                                                                                             |

注意:

- ログインの値（`AUTH_URL` など）は、上の「Web の設定」の表のとおりです。
- `DATABASE_URL` が pooled か、マージの前に確かめます（ホスト名に `-pooler` が付くのが pooled です）。マイグレーション（`prisma migrate deploy`）は direct の URL を使うのが本来の形です。今の Production の値が **direct** のときは、実行時用に pooled の値を別の変数で足します。ただし、今の Web のコード（`src/infrastructure/prisma/prisma-client.ts`）が読むのは `DATABASE_URL` だけです。その場合は、実行時用の変数を読むコードの変更を先に入れてから、値を設定します。
- 単語帳（一覧・保存・削除）は、Web が Prisma で DB を読み書きします。「AI で下書き」も Web が OpenAI を直接呼び、使った量を、操作している人の `AiUsage` に記録します。AI の機能を使うには、Web の Production に `OPENAI_API_KEY` を入れます。
- `OPENAI_API_BASE_URL` はテスト専用です。`127.0.0.1` などのループバックの URL だけを受け付けます。**Production と Preview には設定しません。**
- LINE の `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`CRON_SECRET` は、**Production だけ** に入れ、Preview には入れません。入れると、プレビューのデプロイが本物の LINE のチャネルに返事をしてしまうためです（Webhook は本番の URL にだけ届きますが、プレビューから push を送れてしまいます）。LINE を使うには、LINE の 2 つと `OPENAI_API_KEY` がそろっている必要があります。LINE の 2 つのどちらか、または `OPENAI_API_KEY` が無い（`LINE_API_BASE_URL` がループバックでないときも同じ）Web は、`POST /api/line/webhook` と `GET /api/cron/line-drain` が `404`、`/account/line` が「LINE 連携は今は使えません。」になります（起動時には止まりません）。`CRON_SECRET` だけが無いときは、拾い直しとデモのリセットが常に `401` です。LINE の 2 つは、LINE Developers の値です。`CRON_SECRET` は `openssl rand -hex 32` で作ります。
- `LINE_API_BASE_URL` はテスト専用です。`OPENAI_API_BASE_URL` と同じく、**Production と Preview には設定しません。**
- 秘密の値は、このリポジトリのファイルやログに書きません。
- `AUTH_ALLOWED_GITHUB_IDS`（数字の ID）・`DEMO_LOGIN_ID`・`DATABASE_URL` は、**マージ（本番のデプロイ）の前に** Web の Production に入れておきます。Vercel の環境変数は、変えたあとに再デプロイしないと効きません。
- 足りない・値が違うときの症状：`DATABASE_URL` が無いと、ログインもできず、会員向けのページがエラーになります。`AUTH_ALLOWED_GITHUB_IDS` が空だと、GitHub でログインしても、管理者として断られます。
- Web に Auth.js の時代の `AUTH_ALLOWED_GITHUB_IDS` が残っていないか確かめます（末尾の「移行の記録」の「段階3のマージの前に行うこと」で残すとしていた値です）。数字でない項目（ログイン名など）は捨てられ、管理者が権限を失います。数字の ID に直します。

### Web のプレビュー（Preview）

PR ごとの Web のプレビューも、ログインとデータの読み書きを Web が行います。Web の Vercel プロジェクトの **Preview** の環境変数には、次を入れます。

| 名前                      | Preview に入れる値                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | **本番と別の Neon ブランチ**の pooled の URL                                                   |
| `AUTH_ALLOWED_GITHUB_IDS` | 管理者にする GitHub の数字の ID（任意。GitHub ログインはプレビューで使えないので、空でもよい） |
| `DEMO_LOGIN_ID`           | デモを試すときだけ                                                                             |

注意:

- `GITHUB_WEB_CLIENT_SECRET` と `FFPF_ID_CLIENT_SECRET` は、Preview に **入れません**。プレビューの URL はデプロイごとに変わり、GitHub と FFPF ID に登録した URL と合わないので、どちらのログインも使えないためです（GitHub のボタンは押せず、「FFPF IDでログイン」は出ません）。パスワード・ゲスト・デモのログインは使えます。
- 同じ DB や秘密を本番と使うと、プレビューが本番のデータを書き換えかねません。必ず別の Neon ブランチにします。
- プレビューのビルドはマイグレーションを当てません（`scripts/vercel-build.sh`）。そのため、Preview 用の Neon ブランチのスキーマは、手で合わせます。次のどちらかです。
  - 本番から Neon のブランチを作り直す（スキーマも本番と同じになる）。
  - そのブランチの direct の URL に向けて、手元で `DATABASE_URL=<そのブランチの direct の URL> pnpm exec prisma migrate deploy` を実行する。
- プレビューのログインのセッションは、Preview の Neon ブランチの `Session` に入ります。本番の `Session` とは別です。

### 戻す手順

Web を戻すときは、Vercel の **Instant Rollback** で前のデプロイに戻します。マイグレーションは戻りません（DB は新しいスキーマのまま）。上の「1. 本番の DB とマイグレーション」の制約を守っていれば、前のデプロイは新しいスキーマでも動きます。11b より前のデプロイ（ログインを Go が行っていたころ）には、もう戻せません（Go のプロジェクトを消すと戻せなくなるため。消すのは 12a のあとの利用者の手順です。末尾の「移行の記録」の「段階12（後片付け）のマージの前と後」）。

### e2e

`pnpm run test:e2e` は、Docker の Postgres と Web（本番モードでビルド）と、外部サービスのスタブだけで動きます。テストの側が `Session` の行を DB に書き、そのトークンを Cookie `zl_session` に入れてログインした状態を作ります。パスワードとゲストのログインは、画面から実際に行います。FFPF ID は、`e2e/fixtures/ffpf-oidc-stub.ts` の小さな OIDC スタブ（`127.0.0.1:3110`）を issuer にして、Web に `FFPF_ID_*` を渡します。スタブは実行ごとに P-256 の鍵を作り、`/oauth/authorize` は画面を出さずにすぐ `redirect_uri?code=stub&state=…` へ戻し、`/oauth/token` は ES256 の ID トークンを、`/oauth/jwks` はその公開鍵を返します。本物の portal には接続しません。

## 3. LINE 連携

LINE に送った文を OpenAI で添削・翻訳し、送った人の学習ノートに追加する機能です。会員と管理者が、Web の「LINE 連携」画面（`/account/line`）で連携コードを出し、それを LINE に送ると、その LINE とアカウントが結びつきます。ゲストは使えません。仕様は `docs/superpowers/specs/2026-10-23-line-via-go-api-design.md` にあります。

以前は Go の API が受けていましたが、段階 10 で Web に移しました（手順は末尾の「移行の記録」の「段階10（LINE とデモのリセットの cron）のマージの前と後」）。連携の画面と Server Actions（コードを出す・解除する・お知らせの入り切り）は、Web が Prisma で `LineLink`・`LineLinkCode`・`LineMessage` を読み書きします。

Web の次の 2 つの Route Handler で動きます。LINE の設定（上の「Web が実行時に使う DB と秘密」）が足りないときは、どちらも `404` です。

| メソッド | パス                   | 認証                                  | 内容                                                                                                   |
| -------- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| POST     | `/api/line/webhook`    | LINE の署名（`X-Line-Signature`）     | LINE からの通知を受け取り、添削・翻訳して返信する（`src/app/api/line/webhook/route.ts`）               |
| GET      | `/api/cron/line-drain` | `Authorization: Bearer <CRON_SECRET>` | 結果が出ないまま残ったメッセージの拾い直しと、復習のお知らせ（`src/app/api/cron/line-drain/route.ts`） |

- 送った文は、webhook のリクエストの中で処理します（保存 → OpenAI → 学習ノートに保存 → reply）。reply は無料です。添削・翻訳の結果は、バッチ名 `LINE` のノートとして保存します。1 回の通知の処理は、リクエストの開始から 45 秒までで、残りが 30 秒を切った文は、保存だけして OpenAI は呼ばず、「時間がかかっています」と返します（翌朝の拾い直しが処理します）。イベントは 55 秒を過ぎると新しく始めません。
- 拾い直しは、5 分以上 `pending` のまま残ったメッセージを 1 回だけ試し直し、できたら push で、できなければ失敗を push で知らせます。1 回の実行は 50 秒で止まり、残りが 30 秒を切ったら、新しい生成は始めず次の実行に回します（試す回数を使い切った行は、生成せずに失敗にします）。push は、LINE の無料プランでは月 200 通の枠を使います。同じ実行が、希望した人へ復習のお知らせも送ります（「LINE 連携」画面で入り切りします）。お知らせは今月の残りから 30 通を拾い直しのために残し、その範囲だけ送ります。
- **Cron は Web の `vercel.json` に登録しています**：`/api/cron/line-drain` は `0 21 * * *`（UTC。06:00 JST）です。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶので、Web の Production に `CRON_SECRET` が要ります。Hobby の Cron は時刻が 1 時間単位で、06:00 から最大 59 分遅れることがあります。Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までなので、この拾い直しとデモのリセットの 2 つ（どちらも 1 日 1 回）は収まります。手で呼ぶときは、`Authorization: Bearer $CRON_SECRET` を付けて `GET` します。
- `maxDuration` は、route の中で決めています（拾い直しは 60 秒、デモのリセットは 30 秒）。Web のプロジェクトにはすでに 90 秒の route（クイック質問・チャット）があるので、プロジェクトの設定を変える必要はありません。
- ログには、イベント ID・メッセージの ID・コードだけを出し、本文・生成結果・鍵・LINE のユーザー ID・連携コード・reply token は出しません。
- 使う表は `LineLink`・`LineLinkCode`・`LineMessage` の 3 つで、Prisma のマイグレーション `20261023090000_add_line_link` で作ります（本番にはすでにあります）。
- OpenAI の利用量は、操作している人ではなく LINE を結びつけた人の `AiUsage` に、機能名 `line` で記録します。
- e2e は、偽の LINE API（`e2e/line-stub.ts`）に `LINE_API_BASE_URL` を向けて確かめます。

### 切り替えの手順

LINE Developers で設定するのは、**Webhook URL** を `https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook` にすることと、「Webhook の利用」をオンのまま、「**応答メッセージ**」をオフのままにすることです（オンだと、LINE の自動応答とこちらの返信が二重に届きます）。

LINE の連携を最初から作り直すとき（以前のチャネルが無いとき）は、LINE Developers で Messaging API のチャネルを用意し、Web の Production に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`CRON_SECRET` と、任意で `LINE_ADD_FRIEND_URL` を入れてデプロイしてから、Webhook URL を設定して「検証」を押します（成功は `200`）。

## 4. ChatGPT と話す（会話ノート）

会員と管理者が Web の `/chat` で ChatGPT と中国語で話し、会話を会話ノート（`/conversations`）で見返すための設定です。Web の `POST /api/chat`（Route Handler が OpenAI を直接呼ぶ）で動き、会話ノートは Web が Prisma で読み書きします。

- Web の Production に `OPENAI_API_KEY` があれば話せます。無いときは Web の `/chat` に「ChatGPT が設定されていません」と出ます（会話ノートは読めて、消せます）。
- モデルは Web の `OPENAI_CHAT_MODEL`（無ければ `gpt-6.1-sol`）です。クイック質問と同じ変数です。
- 使えるのは会員と管理者です。デモは会話ノートを読む・消すことはできますが、チャットで新しく聞くことはできません。ゲストには入口が出ません。
- 履歴：テーブル `ChatConversation` は、以前の Go の API のころに作ったものです（マイグレーション `20261024090000_add_chat_conversations`）。いまは新しい手順は要りません。Web へ移したときの手順は、末尾の「移行の記録」の「段階7（チャット）のマージの前と後」にあります。

## 5. FFPF ID でのログイン

FFPF ID（ffpf-portal が提供する OpenID Connect のプロバイダー）のアカウントで、会員（`member`）としてログインする機能です。ログイン画面の「FFPF IDでログイン」から使います。仕様は ffpf-portal の `docs/superpowers/specs/2026-10-27-ffpf-id-design.md` の「4. zhuelog」にあります。

- 流れ：Web が PKCE・`state`・`nonce` を作って `zl_oauth` Cookie に入れ、portal の `/oauth/authorize` へ送ります。戻り先 `/api/auth/callback/ffpf` で `state` を確かめてから、Web が portal の `/oauth/token` で `code` を交換し（client_secret_basic。`FFPF_ID_CLIENT_SECRET` を使う）、ID トークンを `/oauth/jwks` で検証します（ES256・`iss`・`aud`・`exp`・`nonce`・`email_verified`）。discovery は使わず、エンドポイントは `FFPF_ID_ISSUER` から組み立てます。検証が通ったら、`FfpfAccount` を更新して `Session` の行を作り、`zl_session` を発行します。`redirect_uri` は `AUTH_URL` の origin に `/api/auth/callback/ffpf` を付けた値です。
- 持ち主の ID は `ffpf:<sub>` です。`FfpfAccount` にメールアドレスと表示名を保存し、ログインのたびに最新の値で更新します。メールアドレスは表示用で、認可には使いません。許可リストは無く、メールアドレスを確認済みの FFPF ID なら誰でも会員になれます。
- FFPF ID の会員は、パスワード会員と同じく学習ノート・共有・フォロー・タイムライン・LINE 連携を使えます。メンバー一覧にも出ます。パスワードはこのサービスに無いので、`/account/password` には portal のマイページ（`<FFPF_ID_ISSUER>/id`）へのリンクだけを出します（パスワードを変えるフォームは出しません）。
- 誤りの扱い：`state` の不一致、`code` の交換と ID トークンの検証の失敗、portal に届かない・5xx・JWKS が取れないときは、どれも固定のコードだけをログに出し（秘密や `code` は出さない）、「認証サービスからの結果を確認できませんでした。」と出してログイン画面に戻します。
- 使う表は `FfpfAccount` で、Prisma のマイグレーション `20261027120000_add_ffpf_accounts` で作ります。

### 設定の手順

1. ffpf-portal で `pnpm run oidc:client zhuelog` を実行し、シークレット（`secret=…`）とクライアントの JSON を作ります。JSON の `redirectUris` に `https://<Web のホスト>/api/auth/callback/ffpf` を入れて portal の `FFPF_OIDC_CLIENTS` に足し、portal を再デプロイします（詳しくは ffpf-portal の README）。
2. マイグレーション `20261027120000_add_ffpf_accounts`（`FfpfAccount` の追加）は、main へのマージで Web の本番ビルドが自動で当てます（「1. 本番の DB とマイグレーション」）。
3. Web の Vercel プロジェクトの Production に `FFPF_ID_ISSUER`・`FFPF_ID_CLIENT_ID`・`FFPF_ID_CLIENT_SECRET` を入れます。`redirect_uri`（`<AUTH_URL の origin>/api/auth/callback/ffpf`）は、portal に登録した redirect URI と **1 文字も違わず** 合わせます。Preview には入れません。
4. 本番の Web で、FFPF ID のログイン・ログアウトを試します。

## 6. デモアカウント

採用担当など、アカウントを持たない人が会員向けの画面（学習ノート・今日の復習・単語帳・会話ノート・練習の記録）を試せるようにする機能です。ログイン画面の「デモで試す」から入ります。

- アカウント：`DEMO_LOGIN_ID` の ID の、普通のパスワード会員です。パスワードのハッシュは使えない値なので、ID とパスワードではログインできません。「デモで試す」は、Web が `Session` の行を作り（会員として、30 日）、`zl_session` を発行します。アカウントは下のリセットが作ります（手で作る必要はありません）。ログインの試行回数は、`SignInThrottle` で、1 つのクライアントから 15 分に 20 回まで（キーは `demo:<IP>`）に制限します。
- データ：デモを試す全員で 1 つのアカウントを共有します。毎晩 04:00（日本時間）ごろに、Web の `vercel.json` の Cron（`0 19 * * *`、UTC）が `GET /api/cron/demo-reset` を呼び、1 つのトランザクションで、デモの持ち物（学習ノートとヒント、CSV の取り込みの記録、復習の項目と記録、単語帳、会話ノート、クイック質問、練習の記録（介詞・補語）、フォロー（デモがしたものと、デモをフォローしているもの）、LINE の連携・連携コード・受け取った文）を消してから、`src/domain/demo/demo-fixture.json` の内容を、Web の FSRS で復習の項目にして入れ直します（例のデータは、以前の Go が最後に作った内容と同じであることを `tests/fixtures/demo-seed-golden.json` で確かめています）。消さないものは、AI の利用量（`AiUsage`。管理者が費用を見る記録）とログインのセッション（`Session`）です。日付は「リセットの何日前か」で書いてあるので、いつ見ても直近 7 日の記録に見えます。ログイン中のセッションは消しません（デモに入っている人は、リセットのあとも `zl_session` のまま続けて使えます）。
- 使えないもの：OpenAI を呼ぶルート（Web の `POST /api/chat` と `POST /api/quick-question`）は、デモには `403`（「デモでは使えません。」）です。Web の LINE 連携の画面（`/account/line`）は `/` に戻します。パスワードの変更も、デモには使えません。断るのは Web です。フォロー・会員の一覧・タイムライン・共有（ほかの会員に届くため）は、Web が断ります（`/follow` は `/` に戻し、フォローや共有を直接送ると画面には「ログインし直してください。」と出ます）。管理者がデモとして操作しているときや、ほかの会員には当てはまりません。Web の AI のルート（単語帳の下書き・クイック質問・ChatGPT と話す）は、Web が自分でデモかどうかを確かめて断ります。Web は、自分の DB の確認（`passwordHash` が使えない値で、ログイン ID が `DEMO_LOGIN_ID` と同じ）でデモかどうかを決め、すべてのページに「デモアカウントです。…」を出し、メニューから使えない機能を外します。
- リセットは Web が行います（`DEMO_LOGIN_ID` が空なら、Web のルートは `404` です）。Hobby の Cron は時刻が 1 時間単位なので、04:00 から最大 59 分遅れることがあります。Vercel が `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶので、Web の Production に `CRON_SECRET` が要ります。`maxDuration` は route に 30 秒と書いてあります。すぐ戻したいときは、下の `curl` で手でリセットします。
- 手でリセットする：`curl -i -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset -H "Authorization: Bearer $CRON_SECRET"` が `204` を返します（`GET` でも同じです）。`CRON_SECRET` を知っている人だけが呼べます。`$CRON_SECRET` は Web の Production の値です。
- マイグレーションは要りません（既存の表だけを使います）。Vercel Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までなので、LINE の拾い直しとこのリセットの 2 つ（どちらも 1 日 1 回）は収まります（どちらも Web の `vercel.json` にあります）。

### 切り替えの手順

1. Web の Vercel プロジェクトの Production に、`DEMO_LOGIN_ID`（例: `demo`）と `CRON_SECRET` を入れます。
2. Web を main からデプロイします。
3. 上の `curl` でリセットを 1 回呼び、デモアカウントとデータを作ります（呼ぶまではアカウントが無く、「デモで試す」を押すと「デモは今は利用できません。」になります）。
4. 本番の Web の `/signin` に「デモで試す」が出ること、押すと学習ノートと「デモアカウントです。」が出ることを確かめます。

やめるときは、Web から `DEMO_LOGIN_ID` を消して再デプロイします。ボタンが消え、Web のリセットのルートも `404` になります。デモの `Session` の行が残っていても、`DEMO_LOGIN_ID` が無いと、そのアカウントはデモと見分けられません（普通の会員として扱われるので、パスワードの無いアカウントのまま残ります）。気になるときは、`DELETE FROM "Session" WHERE "ownerId" = 'password:<デモのアカウントの id>'` で消します。アカウントとデータは残ります。

## 7. 運用上の注意

### ログインのセッション

- **長さ**：会員と管理者は 30 日、ゲストは 24 時間です。作ったときに期限を決め、使っても延ばしません。切れたら、ログインし直します。
- **期限切れの行の掃除**：ログインのたびに、期限の切れた行を最大 100 行まで消します。別のジョブはありません。ログインが少ないと、期限切れの行が残りますが、読まれません（期限を確かめます）。
- **ログアウト**：そのブラウザーの `Session` の行を消し、`zl_session` を消します。DB が失敗しても、Cookie は消します。
- **パスワードの変更と管理者の再設定**：そのアカウントの `Session` の行を、同じトランザクションですべて消します。ほかの端末もログインし直しです。
- **全員をログアウトさせたいとき**：Neon の SQL Editor で `DELETE FROM "Session";` を実行します（全員が次のリクエストでログイン画面に戻ります）。秘密が漏れたかもしれないときも、これを使います。
- **管理者を外すとき**：`AUTH_ALLOWED_GITHUB_IDS` から ID を消して、再デプロイします。許可リストは、Web がモジュールを読み込むときに 1 度だけ読むので、環境変数を変えただけでは効きません。再デプロイすると、外れた管理者は次のリクエストから `revoked` になります。
- **見る**：`SELECT "role", count(*) FROM "Session" GROUP BY 1;` で、役割ごとの行数が分かります。

### レート制限とクライアントの IP

ログインには、次の制限があります。どれも DB の `SignInThrottle` で数えるので、インスタンスが増えても合計で数えます。

- **ログイン全体**：1 つのクライアントから、1 分に 10 回まで（ID とパスワード・ゲスト・GitHub・FFPF ID・デモの入り口で共有）。パスワードの変更も、同じ鍵（`route:auth:<IP>`）の枠に入ります。
- **パスワードログインの試行回数**：15 分の枠で、1 つのクライアントからは 20 回まで、同じクライアントから同じ loginId へは 5 回まで（成功すると 0 に戻ります）。超えると、正しいパスワードでもログインできません（画面には、IDの有無を区別しない同じ文が出ます）。
- **デモ**：1 つのクライアントから 15 分に 20 回まで（キーは `demo:<IP>`）。

クライアントのアドレスは、Web が `x-real-ip` / `x-forwarded-for` から決めます。Vercel はこのヘッダーをクライアントの IP で上書きし、クライアントが送った値は渡さないので、偽装されません。**Vercel の前に別のプロキシ（CDN など）を置かないでください。** 置くと、すべてのクライアントがそのプロキシの 1 つのアドレスとして数えられます。

### DB の接続数とパスワードの計算

Web は Prisma で DB につなぎます。Vercel がインスタンスを増やすと接続数も増えるので、実行時の `DATABASE_URL` には Neon の pooled 接続文字列を使ってください（「2. Web の設定」）。

パスワードのハッシュ（作成・再設定・変更）と検証は、Web が `crypto.scrypt`（N=2^15・r=8）で計算します（1 回ごとに 32 MiB を使います）。専用の上限は付けていませんが、Node の threadpool（既定は 4 本）が上限になり、同時に動くのは 4 件まで、残りは待ちます。この threadpool はファイルや DNS の処理と共有です。ログインのときは、ID が無い場合でも同じ時間がかかるよう、ダミーのハッシュで同じ計算をします（ログイン画面を開いたときに、先に温めておきます）。

### 公開範囲

外から呼べる API は、Web の Route Handler だけです。LINE の webhook（`/api/line/webhook`）は LINE の署名を、2 つの cron（`/api/cron/*`）は `CRON_SECRET` を確かめます。チャットとクイック質問（`/api/chat`・`/api/quick-question`）は、ログイン中の `Session` を確かめます。CORS は設定していません。

## 移行の記録（段階 1〜12）

Go API を Next.js へ移したときの、各段階の本番への反映の手順です。もう使わない手順ですが、何をいつ変えたかの記録として残します（設計：`docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`）。

この記録は、改名する前のこの文書（`docs/api-deployment.md`）から中身を変えずに移しました。そのころの 1.〜5. は Go のプロジェクトの節（段階 12 で消しました）、6.〜10. は今の 2.〜6. です。記録の中の「4. 本番の DB の確認」は、今の「1. 本番の DB とマイグレーション」に直してあります。

### 段階1のマージの前と後

単語帳を Web に移した変更（段階1）を本番に出す順番です。

マージの前:

- Web の Production に `OPENAI_API_KEY` を入れます（Go API と同じ値でよい）。
- Go に `OPENAI_LEARNING_MODEL` を入れている場合は、Web にも同じ値を入れます。今の Go には入っておらず、既定の `gpt-5-mini` なので、Web も入れなくて同じになります。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/vocabulary*` のルートが本番から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go を再デプロイしたあとで Web だけを戻すと、単語帳が壊れます（古い Web が `/v1/vocabulary*` を呼び、`404` になります）。Web と Go を **いっしょに** 戻します。

### 段階2のマージの前と後

学習ノート（一覧・検索・カレンダー・日ごとの表示・ゴミ箱・共有）を Web に移した変更（段階2）を本番に出す順番です。

マージの前:

- この段階で新しい環境変数はありません。Web の Production に `DATABASE_URL` などが入っていれば足ります（段階1のとおり）。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/entries`（一覧・詳細・編集・削除）、`/v1/batches`、`/v1/trash*`、`/v1/entries/{id}/share`、`/v1/log-dates*` が本番の Go から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- 逆に、Go を再デプロイしたあとで Web だけを戻すと、古い Web が呼ぶルートが新しい Go にないため、学習ノートの画面が `404` で壊れます。Web を戻すなら Go も戻します（Go を再デプロイする前なら Web だけで足ります）。
- いっしょに戻すのがいちばん安全です。

### 段階3（CSV の取り込み）のマージの前と後

学習ノートの CSV の取り込みを Web に移した変更（段階3）を本番に出す順番です。Web が CSV を自分で検証・解析し、1 つのトランザクションで DB に保存します。Go の `POST /v1/imports/csv` はなくなりました（LINE とデモのリセットが使う書き込みは Go に残ります）。下の「段階3のマージの前に行うこと」（Go API を入れたときの段階）とは別のものです。

マージの前:

- この段階で新しい環境変数はありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/imports/csv` が本番の Go から実際に消えます。それまでは、本番の Go に古いルートが残っています。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/imports/csv` を呼んで `404` になり、CSV の取り込みが一般的な文言で失敗します。Web を戻すなら Go も戻します（Go を再デプロイする前なら Web だけで足ります）。
- いっしょに戻すのがいちばん安全です。

### 段階4（復習）のマージの前と後

復習（今日の復習の一覧・件数・回答、ノートを復習に入れる・出す）を Web に移した変更（段階4）を本番に出す順番です。Web が `ReviewItem` と `ReviewLog` を Prisma で直接読み書きし、FSRS も Web（`src/domain/review/fsrs.ts`）で計算します。Go の `/v1/reviews*` と `/v1/entries/{id}/review` はなくなりました。Go に残るのは、LINE の復習のお知らせの件数とデモのリセットです（練習の間違いを列に入れる処理は段階5で Web に移りました）。

マージの前:

- この段階で新しい環境変数も、マイグレーションもありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/reviews/*` と `/v1/entries/{id}/review` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ列に答えを書いても問題ありません。FSRS の計算は同じで（`tests/fixtures/fsrs-golden.json` で Go と Web の結果が同じことを確かめています）、行のロック（`FOR UPDATE`・`FOR SHARE`）も同じです。

戻すとき:

- Go だけを戻しても害はありません（古い Go に、使われないルートが増えて残るだけです）。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/reviews/*` を呼んで `404` になります。今日の復習は失敗の表示になり、ホームの復習のカードとバッジは消え、答えると「この問題は復習の一覧にありません。」になります。ノートのページの「復習に入れる」と、ホームのノートごとのボタンも使えなくなります（`/v1/entries/{id}/review` の呼び出しが `404` になるためです）。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

### 段階5（練習の記録）のマージの前と後

介詞と補語の練習の記録（保存・一覧・1 件の表示）と、間違えた問題を復習の列に入れる処理を Web に移した変更（段階5）を本番に出す順番です。Web が問題の中身を確かめ、記録の保存と復習の列への登録を 1 つのトランザクションで Prisma に書きます。Go の `/v1/complement-records*` と `/v1/preposition-records*` はなくなりました。Go に残るのは、デモのリセットが使う型と挿入と、Go の学習ログと LINE の通知がこれらのテーブルを今も読む処理です。

マージの前:

- この段階で新しい環境変数も、マイグレーションもありません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/preposition-records*` と `/v1/complement-records*` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ表に記録を書き、同じ列に間違いを入れても問題ありません。行の形（問題の JSON）と、列に入れる文（`ON CONFLICT … WHERE "due" > EXCLUDED."due"`）が同じだからです。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/*-records` を呼んで `404` になります。練習を終えると「処理できませんでした。時間をおいてもう一度お試しください。」と出て、記録も復習も残りません。`/practice` のカードから前回の記録が消え、記録の一覧のページはエラーの表示、1 件のページは `404` になります。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

### 段階6（質問）のマージの前と後

クイック質問（OpenAI の答えを NDJSON でブラウザへ流す）と質問ノート（保存した質問の一覧・保存）を Web に移した変更（段階6）を本番に出す順番です。Web の Route Handler が OpenAI を直接呼んで答えを流し、使った量を `quick_question` として操作している人の `AiUsage` に記録し、質問ノートを Prisma で読み書きします。ブラウザが止めると、Web は OpenAI への要求も中断します。Go の `/v1/questions*` と `/v1/quick-question` はなくなりました。Go に残るのは、LINE、フォローとタイムライン、学習ログ、管理、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。
- `OPENAI_CHAT_MODEL` は任意です。Go の Production には入っていないので、Web も入れなければ、どちらも既定の `gpt-6.1-sol` になります。
- クイック質問のルートは `maxDuration = 90` を出しています。Web のプロジェクトで 90 秒が許されること（Fluid compute か、上限が 90 秒以上のプラン）を確かめます。許されないとビルドが失敗します。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/quick-question` と `/v1/questions*` が本番の Go から実際に消えます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `QuickQuestion` の表に書いても問題ありません。行の形と、「同じ id は同じ内容のときだけ成功」の決まりが同じだからです。利用量も同じ `feature`（`quick_question`）で同じ表に入ります。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/quick-question` と `/v1/questions*` を呼んで `404` になります。質問すると「見つかりません。」と出て、質問ノートのページはエラーの表示になり、`/quick-question` は「クイック質問を利用できません」になります。Web を戻すなら Go も戻します。
- いっしょに戻すのがいちばん安全です。

### 段階7（チャット）のマージの前と後

ChatGPT と話す（OpenAI の答えを NDJSON でブラウザへ流す）と会話ノート（保存した会話の一覧・読み・削除）を Web に移した変更（段階7）を本番に出す順番です。Web の Route Handler が OpenAI を直接呼んで答えを流し、使った量を `chat` として操作している人の `AiUsage` に記録し、会話ノートを Prisma で読み書きします。ブラウザが止めると、Web は OpenAI への要求も中断します。Go の `/v1/chat` と `/v1/conversations*` はなくなりました。Go に残るのは、LINE、フォローとタイムライン、学習ログ、管理、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。`ChatConversation` の表はすでにあります。Web の `OPENAI_API_KEY` は段階 1 から入っています。`OPENAI_CHAT_MODEL` は任意で、どちらにも入っていないので、既定の `gpt-6.1-sol` になります。
- `/api/chat` も `maxDuration = 90` を出しています。段階6で Web のプロジェクトに 90 秒が通っているので、そのままでかまいません。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/chat` と `/v1/conversations*` が本番の Go から実際に消えます。
4. Go の `OPENAI_API_KEY` は LINE が使うので、残します（当時。段階 10b で Go から LINE が消えたので、今は消してよい値です）。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `ChatConversation` の表に書いても問題ありません。行の形と、「ほかの人の id は書き換えない」決まりが同じだからです。開いたままの画面も、同じ `/api/chat` を呼びます。利用量も同じ `feature`（`chat`）で同じ表に入ります。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/chat` と `/v1/conversations*` を呼んで `404` になります。話すと「見つかりません。」と出ます。`/chat` は「ChatGPT が設定されていません」、`/conversations` は設定されていない表示になり、日付のページは `404`、削除は一般的な文言になります。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

### 段階8（学習ログ・AI の利用量）のマージの前と後

学習ログ（日本時間の日ごとの、復習・練習・ノート・単語の数）と、管理者の AI の利用量（日本時間の月ごとの集計）を Web に移した変更（段階8）を本番に出す順番です。どちらも読むだけで、Web が Prisma で Go と同じ SQL を流します。Go の `/v1/study-log` と `/v1/admin/ai-usage` はなくなりました。Go に残るのは、LINE（LINE の分の `AiUsage` の記録を含む）、フォローとタイムライン、会員の管理、パスワード変更、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。表はすべてすでにあります。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS` で決めています。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/study-log` と `/v1/admin/ai-usage` が本番の Go から実際に消えます。
4. 本番で、学習ログ（会員）と「AI 利用量」（管理者）を 1 回ずつ開いて、数が出ることを確かめます。

切り替えのあいだ:

- どちらも読むだけなので、古い Go と新しい Web が同時に動いても、DB は変わりません。LINE の利用量は、今までどおり Go が同じ表に書き、Web の集計に出ます（当時。段階 10b で Go から消えました。今は Web が書きます）。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が `/v1/study-log` と `/v1/admin/ai-usage` を呼んで `404` になります。学習ログは「処理できませんでした。時間をおいてもう一度お試しください。」、AI 利用量は「利用量を読めませんでした。Go API が最新かを確認してください。」と出ます。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

### 段階9a（フォロー・タイムライン・会員の一覧）のマージの前と後

フォロー（する・外す）、フォロー中の人の共有ノートのタイムライン、会員の一覧を Web に移した変更（段階9a）を本番に出す順番です。Web が Prisma で Go と同じ SQL を流し、フォローは「相手の会員がいるときだけ行を足す」1 つの SQL にしました。Go の `/v1/members`・`/v1/follows/{ownerId}`・`/v1/timeline` はなくなりました。Go に残るのは、LINE、会員の管理、パスワード変更、ログイン、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。表はすべてすでにあります。会員の一覧の照合順序 `ja-x-icu` も、Go のときに確かめた同じ DB です。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/members`・`/v1/follows/{ownerId}`・`/v1/timeline` が本番の Go から実際に消えます。
4. 本番で `/follow` を開き、会員の一覧と共有ノートが出ること、1 人をフォローして外せることを確かめます。

切り替えのあいだ:

- 古い Go と新しい Web が同じ `Follow` 表を同じ形で読み書きするので、どちらで書いた行も、もう一方に出ます。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になります。`/follow` はエラーの画面になり、フォローのボタンは「見つかりませんでした。画面を更新してください。」と出ます。
- Web を戻すなら Go も戻します。いっしょに戻すのがいちばん安全です。

### 段階9b（会員の管理・パスワード変更）のマージの前と後

会員の作成・一覧・パスワードの再設定（管理者）と、自分のパスワードの変更を Web に移した変更（段階9b）を本番に出す順番です。Web が scrypt で Go と同じ形のハッシュを書き（`tests/fixtures/scrypt-golden.json` で Go と同じことを確かめています）、ハッシュと `sessionVersion` を 1 つの `UPDATE` で変えます。Go の `/v1/admin/accounts`・`/v1/admin/accounts/{id}/password`・`/v1/account/password` はなくなりました。Go に残るのは、LINE、ログイン（ハッシュの確かめと `sessionVersion` の確かめを含む）、Cron です。

マージの前:

- この段階で必須の環境変数も、マイグレーションもありません。`PasswordAccount` と `SignInThrottle` はすでにあります。Web は段階 0 から `DATABASE_URL` で DB を読み、管理者を `AUTH_ALLOWED_GITHUB_IDS`、デモを `DEMO_LOGIN_ID` で決めています。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。これで、削除した `/v1/admin/accounts`・`/v1/admin/accounts/{id}/password`・`/v1/account/password` が本番の Go から実際に消えます。
4. 本番で、管理者が試しの会員を 1 人作ります。その会員でログインできること（Go のログインが Web のハッシュを受け付けること）と、パスワードを再設定すると前のログインが切れることを確かめます。確かめたあと、試しの会員は DB から手で消します（Web に削除の画面はありません）。

切り替えのあいだ:

- 古い Go と新しい Web は同じ形のハッシュを書き、同じ `sessionVersion` と同じ試行回数の鍵を使います。どちらで変えても、もう一方のログインとセッションの確かめに効きます。

戻すとき:

- Go だけを戻しても害はありません。
- Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になります。管理画面の一覧はエラーの画面に、パスワードの変更は「処理できませんでした。時間をおいてもう一度お試しください。」になります。
- Web を戻すなら Go も戻します。Web が書いたハッシュは、古い Go でも確かめられます。

### 段階10（LINE とデモのリセットの cron）のマージの前と後

LINE の webhook・連携・拾い直しと、デモのリセットの cron を Web に移す段階（段階10）を本番に出す順番です。1 つの PR には大きいので、3 つの PR（10a・10b・10c）に分けました。

- **10a**：LINE の webhook（`POST /api/line/webhook`）、「LINE 連携」の画面と Server Actions、拾い直しと朝のお知らせ（`GET /api/cron/line-drain`）を Web に足します。Cron はまだ登録しません。Go は変えません。
- **10b**：Go から LINE のルートと 2 つの Cron（`services/api/vercel.json`）を消し、デモのリセットを Web（`/api/cron/demo-reset`）に足します。
- **10c**：Web の `vercel.json` に `crons` を足して、2 つの Cron を Web で動かします。

順番は 4 つの手順で、LINE の返信と OpenAI の呼び出しが二重にならないように切り替えます。LINE の Webhook URL は同時に 1 か所にしか向けられないので、「Go が答える」か「Web が答える」かのどちらか一方になります。この途中で、拾い直しが 1 回（1 晩）飛ぶことと、Webhook URL を変える数分のあいだに届いた LINE の文に返事が無いことがあります。この 2 つは、わかったうえで受け入れています。

#### 手順 1（10a のマージの前と後）

この PR（10a）が行うのは、Web に LINE の受け口を足すところまでです。LINE の Webhook URL は変えません。マージしても、LINE の文は Go に届き続けます。

マージの前:

- Web の Vercel プロジェクトの **Production** に、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`（どちらも Go のプロジェクトと同じ値）と `CRON_SECRET`（Go と同じ値にするか、`openssl rand -hex 32` で新しく作る）を入れます。Preview には入れません。`OPENAI_API_KEY` は段階 1 から入っています。
- Go に `OPENAI_LEARNING_MODEL` を入れている場合は、Web にも同じ値を入れます（今の Go には入っておらず、どちらも既定の `gpt-5-mini` です）。
- マイグレーションはありません（`LineLink`・`LineLinkCode`・`LineMessage` は本番にあります）。
- Vercel の環境変数は、変えたあとに再デプロイしないと効きません。入れてから、マージのデプロイを出します。

マージのあと:

1. Web の Production のデプロイが Ready になったことを確かめます。
2. その Web のデプロイを `vercel promote` でカスタムドメインに切り替えます。
3. 次の `curl` で、Webhook が Web で答えていることを確かめます。署名の無い呼び出しは、`401` と次の JSON を返します。

   ```bash
   curl -s -X POST https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook
   # {"error":{"code":"unauthorized","message":"認証が必要です。"}}
   ```

   - `404` のときは、LINE の値（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`）が Production に入っていません。入れて再デプロイします。
   - `{"error":"認証が必要です。"}`（`code` と `message` の入れ子が無い形）のときは、まだ古い Web のデプロイが答えています（`vercel promote` が済んでいません）。

4. `/account/line` を開き、「LINE 連携は今は使えません。」が出ないことを確かめます。Preview のデプロイでは、この文が出るのが正しい動きです（LINE の値は Production だけに入れるため）。
5. **Go は、まだ再デプロイしません。** Go の LINE のコードは、この PR では消えません（段階 10b で消します）。

次の `curl` は、**まだ叩きません**。

```bash
curl -s -o /dev/null -w '%{http_code}' https://ffpf-zhuelog.sparklingstadt.com/api/cron/line-drain -H "Authorization: Bearer $CRON_SECRET"
```

叩くと `204` が返ります。Go の Cron と時間をずらして順に呼ぶ分には、結果は同じで困りません（Go と Web は同じ表を同じ意味で使い、1 回の試しは 1 つの文に 1 回だけ取られるため）。困るのは次の 2 つです。Go の Cron と **同時に** 走ると、同じ文の生成を両方が行い、OpenAI の呼び出しが二重になりえます。また、OpenAI の失敗が続いているあいだに呼ぶと、試す回数（1 つの文に 2 回まで）を使い切って失敗にされる文が出ます。そのため、段階 10c までは叩きません。Web の Cron は、段階 10c まで登録しません。

この時点では、LINE の文はまだ Go に届き、拾い直しの Cron も Go が動かします。Web の画面で出した連携コードは、Go の Webhook でも使えます（同じ表を同じ意味で使うため）。Web で切り替えた復習のお知らせの設定は、Go の Cron がそのまま送ります。Go のコードは出し直しません。

運用の注意：1 つのイベントの処理は、最悪の場合、route の `maxDuration`（60 秒）を超えます（OpenAI に 20 秒、利用量の記録に 5 秒、学習ノートを保存するトランザクション、そのあと reply に 10 秒）。超えると reply は届きませんが、行は `done` か `pending` のまま残るので、データは壊れません（`pending` の行は拾い直しが処理します）。Go にも同じ種類の危険がありました。

#### 手順 2（利用者が行う）

マージと確認が済んでから、LINE の Webhook URL を Web に変えます。

1. LINE Developers のコンソールで、Messaging API のチャネルの **Webhook URL** を、Go の `https://ffpf-zhuelog-api.vercel.app/v1/line/webhook` から、Web の `https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook` に変えます。
2. 「**検証**」を押し、成功（`200`）になることを確かめます。「Webhook の利用」はオンのまま、「応答メッセージ」はオフのままにします。
3. 自分の LINE で、添削・翻訳・コードでの連携を 1 回ずつ試します。結果が Web の学習ノートに入ること、`AiUsage` に機能名 `line` の行が増えること（管理者の `/admin/ai-usage`）を確かめます。
4. 変えてから数分のあいだに届いた文は、返事が無いことがあります（許容します）。

#### 手順 3（10b のマージの前と後）

手順 2 が済んでから、10b をマージします。この PR（10b）は、Go から LINE のルートと 2 つの Cron とデモのリセットを消し、デモのリセットを Web の `GET`/`POST /api/cron/demo-reset` として足します。

マージの前:

- 10a が本番にあり、手順 2（LINE の Webhook URL の変更）が済んでいること。自分の LINE で、Web が返事をすることを確かめてあること。**手順 2 より先にマージしない**（Go の LINE のルートが消えるので、Webhook が Go に向いたままだと、LINE の文は `404` で失われます）。
- Web の Production に `CRON_SECRET` と `DEMO_LOGIN_ID`（Go と同じ値）があること。
- マイグレーションはありません。

マージのあと:

1. Web の Production のデプロイが Ready になるのを待ちます。
2. `vercel promote` で、そのデプロイを本番に切り替えます。
3. 次のコマンドが `204` を返し、「デモで試す」で例のデータが出ることを確かめます（Go のログインは、Web が作ったアカウントを使います）。`<CRON_SECRET>` は Web の Production の値です。

   ```sh
   curl -i -X POST https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset \
     -H "Authorization: Bearer <CRON_SECRET>"
   ```

4. main から Go を再デプロイします（実行の前に、使う人に確かめます）。これで、Go の LINE のルート・`/v1/cron/demo-reset`・Go の 2 つの Cron が消えます。
5. 次の 2 つを確かめます。`curl -i -X POST https://ffpf-zhuelog-api.vercel.app/v1/line/webhook` が `404` を返すこと。Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いこと。
6. Go の Vercel プロジェクトから、`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`・`OPENAI_LEARNING_MODEL`・`CRON_SECRET`・`OPENAI_API_BASE_URL`・`LINE_API_BASE_URL` を消してよくなります（`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` は、入れていた場合だけです）。`DEMO_LOGIN_ID` は残します（Go のログインが使います）。Go が読む値は、`PORT`・`DATABASE_URL`・`API_JWT_SECRET`・`GITHUB_MOBILE_*`・`GITHUB_WEB_*`・`API_WEB_PROXY_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` で、`FFPF_ID_*` と `DEMO_LOGIN_ID` は任意です。

10c を出すまで、拾い直し（`/api/cron/line-drain`）とデモのリセットは、定期には動きません。拾い直しが 1 晩飛ぶのは、設計どおりです。デモのリセットが要るときは、上の手順 3 の `curl` で手でできます（10c のマージのあとは Cron が呼びます）。

戻すとき（10b）:

- 10c を出したあとは、**先に** 手順 4 の「戻すとき（10c）」に従って、Web の Cron を消します。Web の Cron が登録されたまま Go だけを戻し、Go に 7 つの値が残っていると、拾い直しが Go と Web の両方で動きます（OpenAI の呼び出しが二重になりえます）。
- Go だけを戻すと、Go の LINE のルートと Cron が戻ります。ただし、手順 3 の 6 で上の 7 つの値を Vercel から消したあとは、戻した Go はそれらの値を読めず、LINE も Cron も動きません（消した値は Vercel から読み戻せないので、動かすなら入れ直します）。動くとすれば、値を残している間だけです。ただし、Webhook の URL は Web を向いているので、Go の Webhook は使われません。Web に Cron が無いうちは、Go の拾い直しの Cron が動いても害はありません。
- Web だけを戻すと、デモのリセットのルートが無くなり、Go にも無いので、リセットは手でもできなくなります（デモのデータは、そのときのまま残ります）。Web を戻すなら、Go も戻します。
- 症状の見分け方：LINE の文に返事が無く、LINE Developers の Webhook の確認が `404` なら、Webhook が Go に向いたままです（手順 2 をやり直します）。「デモで試す」が「デモは今は利用できません。」になるなら、デモのアカウントが無いので、手順 3 の `curl` でリセットします。リセットの `curl` が `404` なら、Web の `DEMO_LOGIN_ID` がありません。`401` なら、`CRON_SECRET` が違います。リセットの `curl` が `204` を返すのに「デモで試す」が「デモは今は利用できません。」になるなら、Web と Go の `DEMO_LOGIN_ID` が違います（Web がリセットしたのとは別の loginId を、Go のログインが探しています）。2 つが同じ値か確かめます。

#### 手順 4（10c のマージの前と後）

手順 3 で Go を出し直したあとで、10c をマージします。この PR（10c）は、Web の `vercel.json` に `crons` を足すだけです（アプリのコードは、コメントのほかは変えません。テストを 1 つ足しました）。これで段階 10 の 4 つの手順はすべて終わり、Go に残るのはログインだけになります。

Cron は Production のデプロイで登録されます。時刻は UTC で、`/api/cron/line-drain` は `0 21 * * *`（06:00 JST）、`/api/cron/demo-reset` は `0 19 * * *`（04:00 JST）です。Hobby の Cron は時刻が 1 時間単位で、指定の時刻から最大 59 分遅れることがあります（[Vercel の説明](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing)）。

マージの前:

- 手順 3 が済んでいること。Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いこと（Go と Web の両方で同じ拾い直しが動くと、OpenAI の呼び出しが二重になりえます）。
- Web の Production に `CRON_SECRET` があること。Vercel が Cron の呼び出しに `Authorization: Bearer <CRON_SECRET>` を自動で付けるので、ほかに設定は要りません。
- Hobby の Cron は 1 つのプロジェクトに 100 個まで、どれも 1 日 1 回までで、時刻は最大 59 分遅れることがあります。この 2 つ（どちらも 1 日 1 回）は収まります。マイグレーションはありません。

マージのあと:

1. Web の Production のデプロイが Ready になるのを待ちます。
2. `vercel promote` で、そのデプロイを本番に切り替えます（Cron は Production のデプロイで登録されます）。
3. Web の Vercel プロジェクトの **Settings → Cron Jobs** に、ちょうど 2 つ、`/api/cron/line-drain`（`0 21 * * *`）と `/api/cron/demo-reset`（`0 19 * * *`）が出ることを確かめます。
4. 待たずに確かめるなら、同じ画面から、それぞれの Cron を 1 回だけ実行できます（任意）。ただし、実行には副作用があります。`line-drain` を実行すると、本物の復習のお知らせを送り、LINE の送信数の枠を使い、その日（JST）の実行として数えられます。`demo-reset` を昼間に実行すると、今デモを試している人のデータが元に戻ります。成功すると、Web のログ（Vercel の **Logs**）に、リクエストの結果として `204` が出ます。`demo-reset` は `DEMO_RESET_DONE`、`line-drain` は `LINE_REVIEW_NOTIFY_SENT`（お知らせを送ったとき）が出ます。`401` なら `CRON_SECRET` が無いか違い、`404` なら、`demo-reset` では Web の `DEMO_LOGIN_ID` が、`line-drain` では LINE の値（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`OPENAI_API_KEY`）がありません。
5. 次の朝（04:00 JST ごろと 06:00 JST ごろ。遅れても 1 時間以内）に、Web のログで、2 つの実行があったことを確かめます。

戻すとき（10c）:

- この PR だけを戻す（Web を戻す）と、Web の Cron が消えるだけで、ほかは動きます。拾い直しとデモのリセットが定期には動かなくなります（手で `curl` すれば呼べます）。Go に Cron は無いので、二重には動きません。
- Go の Cron を戻したいときは、先にこの PR を戻し、戻した Web を promote して、Web の **Settings → Cron Jobs** の一覧が空になったことを確かめてから、Go を 10b の前に戻します（2 つの Cron を並べない）。

#### 戻すとき（10a）

- 手順 2 の前なら、Web だけを戻せば足ります。LINE の Webhook は Go に向いたままで、Go がまだ連携のルートも持っているからです。戻した Web の `/account/line` は、前の Web のとおり Go を呼びます。
- 手順 2 のあとで Web だけを戻す場合は、**先に** LINE Developers の Webhook URL を Go（`https://ffpf-zhuelog-api.vercel.app/v1/line/webhook`）に戻します。戻さずに Web を戻すと、古い Web には Webhook のルートが無いので、LINE の文は `404` で失われます。
- Go は、10a では何も変えていないので、戻す必要はありません。
- ただし、10b を出したあとの Go には Webhook のルートがありません。Webhook URL を Go に戻す前に、Go も 10a の状態に戻します。

### 段階11（ログイン）のマージの前と後

ログインを Go から Web に移す段階（段階11）を本番に出す順番です。2 つの PR（11a・11b）に分けました。

- **11a**：ログインのセッションを置く `Session` の表と、Web がログインを行うための部品（セッションの保存、パスワード・ゲスト・デモ・GitHub・FFPF ID のログインのユースケース、GitHub と FFPF ID のクライアント）を足します。どこからも呼ばないので、ログインは Go のままです。
- **11b**：ログインの画面とルートを、この部品につなぎます（Go から Web への切り替え）。Go はログインのコードを失い、`/health` だけになります。
- 11a の PR では、ログインの動きは変わりません。ただし、Preview の Neon ブランチに `Session` の表を足すまでは、Preview でパスワードの変更と管理者による再設定が `500` で失敗します（下の「11a のマージの前と後」）。

#### 11a のマージの前と後

マージの前:

- 本番で行うことはありません。
- `Session` の表を足すマイグレーション（`20261117090000_add_session`）は、表と索引を作るだけで、今の Go と両立します。
- **Preview の Neon ブランチ**には、マージの前に手で `prisma migrate deploy` を当てることを勧めます（プレビューのビルドは当てません。「Web のプレビュー（Preview）」の手順です）。`DATABASE_URL=<そのブランチの direct の URL> pnpm exec prisma migrate deploy` です。
  - 表を足すだけなので、今の Preview にも害はありません。
  - 当てておくと、この PR のプレビューでも、パスワードの変更と管理者による再設定を試せます。当てるまでは、この 2 つが `500` で失敗します。同じトランザクションで `Session` から消す（その人のセッションを失効させる）ためです。

マージのあと:

1. Web の本番のビルドが、`prisma migrate deploy` で `Session` の表を足します（「1. 本番の DB とマイグレーション」）。
2. `migrate status` で「Database schema is up to date!」を確かめます。
3. マージの前に **Preview の Neon ブランチ**へ当てていなければ、ここで同じ手順で当てます。当てるまでは、Preview でパスワードの変更と管理者による再設定が `500` で失敗します。
4. ログインの動きは変わりません。ログインは Go のままで、`Session` の表は空のままです。

11b の前に、Web の Production に次の 2 つを入れておいてよいです（11a には読む関数がありますが、まだどこからも呼びません。11a で入れていなければ、11b のマージの前に入れます）。

- `GITHUB_WEB_CLIENT_SECRET`：Go の同じ名前の値です。Vercel から読み戻せないときは、GitHub の OAuth App の画面で **Generate a new client secret** を押して作ります。古い Secret は、11b のあと Go を出し直すまで消しません。
- `FFPF_ID_CLIENT_SECRET`：Go と同じ値です。

Preview には入れません。プレビューの URL は、GitHub と FFPF ID に登録したコールバックの URL と合わないためです。

11b の準備として、11a で決めたセッションの性質を書いておきます。

- セッションは固定の長さです。会員と管理者は 30 日、ゲストは 24 時間で、使っても延びません。Go の refresh のように、使うたびに延びることはありません。そのため、11b のあとは、30 日ごとにログインし直してもらうことになります。
- 期限の切れたセッションは、ログインのたびに、最大 100 行まで消します。消すための別のジョブが要らないからです。

戻すとき（11a）:

- Go だけを戻しても害はありません（11a は Go を変えません）。
- Web を戻すと、空の `Session` の表が残ります。何も読まないので、そのままで害はありません。

#### 11b のマージの前と後

ログインとログアウトを Go から Web に切り替え、Go を `/health` だけにする変更です。Web は、パスワード・ゲスト・デモ・GitHub（管理者）・FFPF ID のログインとログアウトのすべてを、自分で受け持ちます。ログインのセッションは、ランダムなトークンの SHA-256 を `Session` の行にし、トークンは HttpOnly の Cookie `zl_session` に置きます。長さは固定で、30 日（ゲストは 24 時間）です。使っても延びません。期限切れの行は、ログインのたびに 100 行まで消します。パスワードの変更と再設定は、その人の `Session` の行をすべて消します。管理者は `AUTH_ALLOWED_GITHUB_IDS` で確かめ、許可リストは、Web がモジュールを読み込むときに 1 度だけ読むので、変えたら再デプロイが要ります。Go は、`/health`・`/healthz`・`/ping` だけを返し、`PORT` と `DATABASE_URL` だけを読みます。

**マージの前に、利用者が行うこと**

1. 11a が本番にあり、`migrate status` が `Database schema is up to date!` になっていることを確かめます（`Session` の表があること）。
2. Web の Production に、`GITHUB_WEB_CLIENT_SECRET` と `FFPF_ID_CLIENT_SECRET` があることを確かめます（11a で入れていなければ、ここで入れます）。
   - 値は、Go に入れているものと同じです。GitHub の値を Vercel から読み戻せないときは、GitHub の OAuth App の画面で新しい Client Secret を作って入れます。古い Secret は、マージのあとの手順 6 まで消しません（Go が使っているあいだは、古い値が要ります）。
   - **Preview には入れません。**
3. Web の Production の `AUTH_URL` が `https://ffpf-zhuelog.sparklingstadt.com` であることを確かめます。GitHub と FFPF ID の `redirect_uri` は、`AUTH_URL` の origin から決まります。Go の `GITHUB_WEB_REDIRECT_URI`・`FFPF_ID_REDIRECT_URI` と、**1 文字も違わない** 値になることを確かめてください（GitHub は `https://ffpf-zhuelog.sparklingstadt.com/api/auth/callback/github/go`、FFPF ID は `https://ffpf-zhuelog.sparklingstadt.com/api/auth/callback/ffpf`）。
4. GitHub の OAuth App の callback URL は変えません（`/api/auth/callback/github/go` は、登録済みの `/api/auth/callback/github` の下です）。FFPF ID の portal に登録した redirect URI（`/api/auth/callback/ffpf`）も変えません。
5. マイグレーションはありません（11a で済んでいます）。

**マージのあと**

1. Web の Production のデプロイが `Ready` になることを確かめます。
2. `vercel promote` で、そのデプロイをカスタムドメインに切り替えます。**この時点で、全員のログインが切れます**（Go の `zl_access`・`zl_refresh` は使われなくなります）。自分も含め、一度ログインし直します。
3. 本番で確かめます。
   - パスワード・ゲスト・デモ・FFPF ID・GitHub（管理者）の、それぞれでログインできる。
   - `SELECT "role", count(*) FROM "Session" GROUP BY 1;` に、行が増えている。
   - ログアウトすると、自分の行が消える。
   - 管理者で「会員として見る」が動く。
4. main から Go を再デプロイします（Vercel CLI。実行の前に、使う人に確かめます）。
5. `curl -i -X POST https://ffpf-zhuelog-api.vercel.app/v1/auth/password` が `404`、`curl -i https://ffpf-zhuelog-api.vercel.app/health` が `200` であることを確かめます。
6. Go の Vercel プロジェクトの環境変数のうち、`DATABASE_URL` と `GOFLAGS`（使っていれば）のほかは、消してよいです（段階 12 でプロジェクトごと消します）。
   - 消してよいもの：`API_JWT_SECRET`、`API_WEB_PROXY_SECRET`、`AUTH_ALLOWED_GITHUB_IDS`、`GITHUB_MOBILE_*`、`GITHUB_WEB_*`、`FFPF_ID_*`、`DEMO_LOGIN_ID`。
   - GitHub の古い Client Secret も、ここで消してよいです（Web が、新しい Secret か、同じ値を使っています）。
7. Web の Production の `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` は、もう読まれません。消すのは、段階 12 のコードの変更と一緒にします（それまで残しても害はありません）。

**戻すとき**

- Web だけを戻すと、ログインは Go に戻ります。手順 4（Go の再デプロイ）の前なら、そのまま動きます。
- 手順 4 のあとは、戻した Web が呼ぶ `/v1/auth/*` が、いまの Go では `404` です。そのため、Web を戻すなら、Go も前のデプロイに戻します（Vercel の **Instant Rollback**）。2 つを **いっしょに** 戻します。
- 手順 6 で Go の環境変数を消したあとに戻すときは、戻す前に値を戻します（`API_JWT_SECRET`・`API_WEB_PROXY_SECRET`・`AUTH_ALLOWED_GITHUB_IDS`・`GITHUB_*`・`FFPF_ID_*`・`DEMO_LOGIN_ID`）。
  - `AUTH_ALLOWED_GITHUB_IDS` は、消す前の値ではなく、**いまの Web の値** にします。古い値に戻すと、そのあと外した管理者が、また管理者になります。
  - 手順 6 で GitHub の古い Client Secret を消したときは、Go の `GITHUB_WEB_CLIENT_SECRET` も、**いまの Web の値** にします（古い Secret は、もう GitHub で使えません）。
- セッションの扱い：戻すと、新しい Web で入った人の `zl_session` は、古い Web が読まないので、ログインし直しです（Go でログインします）。Go の `zl_access`・`zl_refresh` が手元に残っている人は、その Cookie がまだ有効なら、そのまま続けられます。`Session` の表の行は残りますが、誰も読まないので害はありません。
- **もう一度切り替える前に**、Neon の SQL Editor で `DELETE FROM "Session";` を実行します。最初の切り替えと同じく、全員のログインが切れます。戻した Web は `zl_session` を知らないので、戻しているあいだのログアウトやほかの人のログインでは、`zl_session` の Cookie も `Session` の行も消えません。消さずに切り替えると、前のセッションが生き返ります（たとえば、共用の端末で A がログアウトし、B がログインしたあとに、A のセッションに戻ります）。

### 段階3のマージの前に行うこと

段階3（Web のデータを Go API で読み書きする変更）をマージすると、Web から Auth.js と DB への接続が無くなります。Go API が無いと、Web は動きません。そのため、**マージの前に** 次を済ませてください。

1. Go API の Vercel プロジェクトを作り（上の 1.〜5.）、`/health` が `200` を返すことを確かめます。
2. Go API に `GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`・`API_WEB_PROXY_SECRET` を入れ、再デプロイします。
3. 本番の Web の Vercel プロジェクトに、上の表の 4 つ（`GO_API_URL` など）を入れ、再デプロイします。今の main の Web は、`GO_API_URL` があるとログインを Go API で行います。
4. 本番の Web で、GitHub・パスワード・ゲストのログインと、ログアウトができることを確かめます。切り替えると Auth.js の Cookie は使われなくなるので、**全員が一度ログインし直し** になります。
5. 確かめられたら、段階3をマージします。

`DATABASE_URL`・`AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` は、段階3が本番で問題なく動くまで Web に残しておきます（下の「段階3の戻す手順」で使います）。

#### 段階3の戻す手順

段階3のあとは、Auth.js に切り替える設定はありません。戻すときは、段階3のマージを取り消し（revert し）、Web を再デプロイします。取り消した後の Web は、学習ノートを DB から直接読み書きするので、Web に `DATABASE_URL` が要ります。ログインは、`GO_API_URL` があるうちは Go API のままです。Auth.js のログインまで戻すときは、さらに Web から `GO_API_URL` を消して再デプロイします。このとき `AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` も要り、全員がログインし直しになります。

### 段階12（後片付け）のマージの前と後

段階 12 は 2 つの PR です。12a は Go のコード・docs-site・Go のクライアントと設定を消します（アプリの動きは変わりません）。12b は `ApiRefreshToken` の表を消すマイグレーションだけです。本番のビルドはマイグレーションを自動で当てるので、12b は Go の Vercel プロジェクトを消したあとにだけマージします。

#### 12a のマージの前と後

**マージの前に、利用者が行うこと：**

1. 11b が本番にあり（`vercel promote` 済み）、Go を 11b の main から出し直してあること（`/v1/auth/password` が 404、`/health` が 200）。
2. Go の Vercel プロジェクト（`ffpf-zhuelog-api`）の **Settings → Git** で、リポジトリにつながっていないことを確かめる。つながっていれば **Disconnect** する。12a で `services/api/` が無くなるので、つながったままだと、マージのたびに Go のビルドが Root Directory を見つけられずに失敗します（本番の Go には影響しませんが、失敗の通知が届きます）。Root Directory の設定は、プロジェクトと一緒に消えるので、直さなくてよいです。
3. マイグレーションは無い。Web の環境変数も、マージの前に変えるものは無い。

**マージのあと：**

1. Web の Production のデプロイが Ready になったら、`vercel promote` する。
2. 確かめる：パスワード・ゲスト・デモ・FFPF ID・GitHub（管理者）でログインでき、学習ノート・単語帳・復習が開ける。Vercel の Web のログに `GoApiError` や `GO_API_URL` が出ない。
3. Web の Vercel プロジェクトの **Production と Preview** から、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す（もう読まれていません。消したあとの再デプロイは要りません）。
4. GitHub の Dependabot が開いた Go（`gomod`）の PR があれば、閉じる（12a で Dependabot の Go の設定を消したので、新しくは開きません）。
5. 手元：サンプル用の DB（`127.0.0.1:55440`）を消す。**12a を取り込む前に** `pnpm run api:db:stop -- -v` を実行する。取り込んだあとなら、`docker compose -p zhuelog-api-local down -v`（コンテナ `zhuelog-api-local-api-db-1` と、ボリューム `zhuelog-api-local_zhuelog_api_local_data` が消えます）。そのあと、`.env` の `DATABASE_URL` を `.env.example` の値に戻す（開発用 DB は、12a から `127.0.0.1:55432` です。以前の 5432 から替えました）。`docker compose up -d`・`pnpm run db:deploy`・`pnpm run db:seed:sample` を実行する。

**戻すとき：** Web を 11b のデプロイに戻す（Vercel の **Instant Rollback**）。11b は 3 つの環境変数を読まないので、手順 3 で消したあとでも動きます。

#### Go の Vercel プロジェクトを消す（利用者が行う。12a のあと、12b の前）

1. 消してよいかを決める。Go のプロジェクトを消すと、Web を 11b より前（ログインを Go が行っていたころ）に戻すことは、もうできません。11b のあと、ログインに問題が出ていないことを確かめてから消します。
2. Go のプロジェクトの **Logs** で、`/health`・`/healthz`・`/ping` のほかに呼ばれていないことを確かめる（Web はもう Go を呼びません）。
3. **Settings → General → Delete Project** で `ffpf-zhuelog-api` を消す。環境変数（`DATABASE_URL`・`GOFLAGS` と、残っていた値）、デプロイ、`ffpf-zhuelog-api.vercel.app` の URL、Neon の **Storage** の Go への接続も一緒に消えます。**Neon のストア（DB）そのものは消しません**（Web が使っています）。
4. モバイル用の GitHub OAuth App（`GITHUB_MOBILE_*` に入れていたもの）が残っていれば、GitHub の **Settings → Developer settings → OAuth Apps** で消す。Web 用の OAuth App（`AUTH_GITHUB_ID`）は消しません。

#### 12b のマージの前と後

**マージの前に、利用者が行うこと：**

1. 上の「Go の Vercel プロジェクトを消す」が終わっていること。
2. 12a が本番にあること。
3. 12b の下書き（draft）の PR を「ready」にする。

**マージのあと：**

1. 本番のビルドが `prisma migrate deploy` でマイグレーション `20261118090000_drop_api_refresh_token`（`DROP TABLE "ApiRefreshToken";`）を当てて表を消し、そのあと Web をビルドします。ビルドのあいだ動いている 12a の Web は、この表を使わないので、止まりません。
2. Ready になったら `vercel promote` する。
3. 確かめる：「1. 本番の DB とマイグレーション」の手順で `migrate status` が up to date。Neon の SQL Editor で `SELECT to_regclass('"ApiRefreshToken"');` が `NULL`。ログインと、デモのリセット（`/api/cron/demo-reset` が次の朝に 200）が動く。
4. Preview の Neon のブランチは、プレビューのビルドがマイグレーションを当てないので、表が残ります。害はありません。合わせたいときは「Web のプレビュー（Preview）」の手順で `prisma migrate deploy` を当てます。

**戻すとき：** Web は 12a のデプロイに戻せます（12a は表を使いません）。表は戻りません。11b より前の Web には戻せません（Go も表も無いため）。

#### 利用者が行うことの順番（段階 12）

1. 11b を本番に出し、Go を 11b の main から出し直す（済んでいれば飛ばす）。
2. Go の Vercel プロジェクトが Git につながっていれば、**Disconnect** する。
3. 12a をマージし、Web の Production が Ready になったら `vercel promote` して、ログインと主な画面を確かめる。
4. Web の Production と Preview から `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す。Dependabot の Go の PR があれば閉じる。
5. 手元のサンプル用 DB（55440）のコンテナとボリュームを消し、`.env` の `DATABASE_URL` を `.env.example` の値に戻す。
6. Go のプロジェクトの Logs を見てから、**Delete Project** で消す（Neon のストアは消さない）。これで、Web を 11b より前に戻すことはできなくなる。モバイル用の GitHub OAuth App が残っていれば消す。
7. ここまで済んでから、12b を「ready」にしてマージし、`vercel promote` する。`migrate status` と、`to_regclass('"ApiRefreshToken"')` が `NULL` であることを確かめる。

12a は手順 1・2 のあと、いつマージしてもよい。12b は手順 6 のあとだけ。

### 移行全体のまとめ

**何が変わったか（段階 0〜12）**

- 以前：Web（Next.js）は画面だけで、データの読み書き・ログイン・チャット・LINE・AI の利用量・cron は、すべて Go の API（`services/api`、約 1.3 万行、API 約 70 本）が持っていた。Web は `src/infrastructure/go-api/` の約 20 個のアダプタで Go を呼び、ログインは Go の JWT と refresh token（`zl_access`・`zl_refresh`）だった。
- いま：アプリは Next.js 1 つ。DB は Prisma で Web が直接読み書きする。ログインは Web のセッション（Cookie `zl_session` のトークンの SHA-256 を `Session` に置く。30 日、ゲストは 24 時間）。LINE の webhook と 2 つの cron（LINE の拾い直し、デモのリセット）も Web の Route Handler と Vercel Cron。Vercel のプロジェクトは 1 つ。
- 変わらないもの：画面の動き、エラーの文言、OAuth のコールバックの URL、DB のデータ（スキーマは `Session` を足し、`ApiRefreshToken` を消しただけ）。e2e（322 件）は、移す前と同じ確かめを Go なしで通している。
- なくしたもの：ネイティブアプリ向けの `/v1/...` の JSON API と JWT（利用者の決定）、Go の CI・フック・Dependabot、API のドキュメントのサイト（docs-site）、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET`、手元の 2 つめの DB。

**どこを読めば何が分かるか**は、[architecture.md](architecture.md) の「2. Go API をやめて Next.js 1 つにした理由」の表にあります。
