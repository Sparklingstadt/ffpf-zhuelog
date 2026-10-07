# LINE連携（Vercel + OpenAI）

## 現在の範囲

2026-09-24: 承認を受けて本番DBへの追加マイグレーション、Vercelへのデプロイ、LINE接続設定を実施しました。
LINE公式アカウントは「学习録 公式」(`@393bohaw`)、プロバイダーは `ffpf-zhuelog`、チャネルIDは `2011714744` です。
Webhookは `https://ffpf-zhuelog.vercel.app/api/line/webhook`。LINE管理画面の接続検証が成功しています。
本番だけで連携を有効化し、自分のLINEユーザーID1名を許可しています。ローカルWebアプリのWebhookは無効のままです。
標準の応答メッセージはOFF、Webhookの利用・再送はON。トークンはGit対象外のローカル設定とVercelの本番用秘密設定に保存しています。
新しい環境へ導入する場合は、下記手順に従って別途設定してください（`.env.example` は無効のままです）。

2026-10-04: LINE連携をCloud Runへ移しました。Webhookは `https://zhuelog-z65vkelwcq-an.a.run.app/api/line/webhook`、トークン類はGoogle CloudのSecret Managerに保存しています。Vercelでは `LINE_INTEGRATION_ENABLED=false` にしました（手順は [`cloud-run.md`](cloud-run.md)）。

2026-10-07: 取り残しを拾い直すCronを、Cloud SchedulerからVercel Cronに戻しました。Vercel Cronが30分おきにVercelの `/api/line/drain` を呼び、LINEが無効なVercelはそれをCloud Runの `/api/line/drain` に取り次ぎます（`LINE_DRAIN_FORWARD_URL`）。LINEの処理そのものはCloud Runのままです。

v0.12.0 から、添削と翻訳はすべてサーバーの中で OpenAI API を使って生成します。Mac や Codex は不要で、Mac が止まっていても返信が届きます。

## 処理の流れ

```text
自分のLINE（公式アカウントとの1対1トーク）
  → POST /api/line/webhook（Cloud Run）：署名・送信者検証 → 本文を振り分け → DBに処理待ちを保存 → 200を返す
  → 200の前に Cloud Tasks へ GET /api/line/drain を頼む（Vercel・E2Eでは 200 のあと after() で同じ関数の中で処理する）
  → GET /api/line/drain（Cloud Tasks）：ジョブを処理する（締め切りは開始から約50秒）
      ・OpenAI Responses API（gpt-5-mini）：添削または翻訳、ピン音、ヒントを生成
      ・結果を検証 → 学習ノートと返信用CSVを同時保存
      ・LINE Push API：保存済みCSVを見出し・改行付きの文章に整形し、自分のトークへ送信
  → GET /api/line/drain（Vercel Cron、30分おき）：Vercelが Cloud Run の /api/line/drain に取り次ぎ、取り残したジョブを拾い直す
```

本文は次のように振り分けます。

| 本文                                 | 処理                             |
| ------------------------------------ | -------------------------------- |
| 501文字以上                          | 上限の通知（生成も保存もしない） |
| ひらがな・カタカナを含む（日本語）   | 翻訳：中国語（簡体字）に訳す     |
| 上記以外で漢字を含む                 | 添削：今までどおり               |
| それ以外（`Hello`・`/battery` など） | 無視（ジョブも返信もなし）       |

コマンドはありません。`/battery` と開発モード（`/dev`・`/devend`）は廃止しました。送っても無視されます。

取り残しは、次のwebhookの処理と、Vercel Cron（`vercel.json`、30分おき）で拾い直します。ジョブのリース（2分）が切れると、次の処理が引き継ぎます。Vercel Cron は `Authorization: Bearer ${CRON_SECRET}` を付けてVercelの `/api/line/drain` を呼び、値が一致しなければ何もしません（401）。VercelでLINEが無効（`LINE_INTEGRATION_ENABLED=false`）で `LINE_DRAIN_FORWARD_URL` があれば、Vercelは同じ `CRON_SECRET` を付けてCloud Runの `/api/line/drain` を呼び、処理件数だけを返します。Cloud Runの応答を最大55秒待ち、失敗したときは503（`LINE_DRAIN_FORWARD_FAILED`）を返します。途中で打ち切られたジョブは、リースが切れたあと次のCronかwebhookが引き継ぎます。LINEが有効なサーバーは取り次がず、自分で処理します（自分自身を呼び続けることはありません）。

**Cronの間隔（30分）の理由と影響：** 締め切りまでに処理しきれなかったジョブや、LINE配送が一時的に失敗して待ち時間に入ったジョブは、次のLINEメッセージかCronまで待つため、返信が最大で約30分遅れることがあります。Cronの間隔を短くしすぎないのは、DB（Neon の無料プラン）の計算時間の枠（月100 CU時間）を守るためです。Neonは使われないと5分で止まり、Cronのたびに起動します。30分おきなら起きている時間は全体の約6分の1（月30 CU時間ほど）です。5分おきにするとほぼ常時起動になり、枠を超えます。Vercel の Pro プランが前提です（無料プランのCronは1日1回まで）。一時的に失敗した配送を初回の配送開始から23時間より後に再送することになった場合は、二重送信を防ぐために停止します（`DELIVERY_WINDOW_EXPIRED`）が、30分おきのCronではこの状況はほぼ起きません。

## 使い方・制限

- 自分の1対1トークに文を送ると、1メッセージにつき1件の学習ノートを保存し、同じ内容をLINEへ返信します。グループ、画像、音声、許可されていないユーザー、その他のイベントは処理しません。
- **日本語の文（ひらがな・カタカナを含む）は中国語に訳します。** 返信は「元の文」「中国語訳」「ヒント」の見出しです。ノートには「翻訳」として保存され、Webの学習ノートでは差分の色分けをせず「中国語訳」として表示します。
- **漢字を含むそれ以外の文は添削します。** 返信は「元の文」「添削後」「ヒント」の見出しです。添削文は文ごとにピンインを直下に配置し、ヒントは1〜5個を番号付きで表示します。文とピンインの区切り数が一致しない場合は誤った対応付けを避け、全体の直下にピンイン全体を表示します。
- 500文字を超えるテキストは生成・保存をせず、「500文字以内に分けて送ってください」と返信します。本文はDBに残しません。結果がLINEの文字数上限（5,000文字）を超えた場合も、ノートを保存せずに失敗を返信します（エラーコード `CORRECTION_TOO_LONG`）。
- 内部では `"最初の文","添削後の文","ピン音","ヒント1","ヒント2",...` のヘッダーなしCSVを保存します。翻訳も同じ形で、「最初の文」が日本語の原文、「添削後の文」が中国語訳です。表示の整形によって学習ノートの内容は変わりません。
- CSVはプログラムでエスケープします。AI出力を直接SQLやCSVとして実行しません。原文はAI出力ではなく保存済みのLINE本文から取得します。入力の文は指示ではなくデータとしてOpenAIに渡し、結果は決められた形かを検証します。
- 日付別一覧はLINE送信日時（既存画面と同じJST表示）で分類します。登録後にWeb画面を再読み込みすると表示されます。
- **登録したノートは、`LINE_NOTE_OWNER_ID` の持ち主と管理者だけが閲覧できます。** ゲストと、ほかのmemberには表示されません。LINE上で送信取消しても本アプリの保存済みノートは自動削除されません。
- メッセージはLINE、アプリのDB、OpenAIを経由します。OpenAIには `store: false` を指定しますが、OpenAI側のあらゆるログの不保持を保証しません。ログにはジョブIDと原因コードだけを出し、本文・生成結果・チャネルシークレット・アクセストークン・APIキーは出しません。
- 生成は `gpt-5-mini` に固定です（クライアントからは選べません）。OpenAIの利用料金は `OPENAI_API_KEY` のプロジェクトに発生します。呼び出しは通常1メッセージにつき1回です（生成の途中で関数が打ち切られた場合に限り、同じメッセージを最大3回まで生成し直します。「重複・失敗時の扱い」を参照）。500文字の上限と送信者の制限が費用の目安になります。
- 返信はReply APIではなくPush APIを使用し、**LINE公式アカウントの配信枠**を消費します。友だち追加が必要です。受理成功でもブロック等で端末に表示されない場合があります。
- 生のCSVを表計算ソフトで開く場合は数式として評価させず、文字列としてインポートしてください。

## 失敗時の通知

生成に失敗した場合は、原因コードと日本語の説明を返信します。「添削できませんでした」または「翻訳できませんでした」のあとに理由とコードが続きます。学習ノートは作成せず、生成の自動再試行もしません（二重課金を防ぐため）。復旧後は本人が文を再送します。

| コード                    | 意味                             |
| ------------------------- | -------------------------------- |
| `OPENAI_TIMEOUT`          | 20秒以内に生成できなかった       |
| `OPENAI_AUTH_FAILED`      | APIキーが無効、または権限がない  |
| `OPENAI_RATE_LIMITED`     | 利用制限（レート・上限）に達した |
| `OPENAI_INVALID_RESPONSE` | 結果が決められた形ではなかった   |
| `OPENAI_REQUEST_FAILED`   | その他の通信・サーバーエラー     |
| `CORRECTION_TOO_LONG`     | 結果がLINEの文字数上限を超えた   |

LINEへの送信が一時的に失敗した場合は、同じ再送キー（`X-Line-Retry-Key`）で次の処理の機会に再送します。

## 必要な設定

専用のLINE公式アカウントを用意すると、既存ボットのWebhookを上書きせずに運用できます。

| 変数                        | 役割                                                                         | 設定先          |
| --------------------------- | ---------------------------------------------------------------------------- | --------------- |
| `LINE_INTEGRATION_ENABLED`  | 準備完了後だけ `true`                                                        | Webサーバー     |
| `LINE_CHANNEL_SECRET`       | Webhookの署名検証                                                            | Webサーバーのみ |
| `LINE_CHANNEL_ACCESS_TOKEN` | 返信のPush送信                                                               | Webサーバーのみ |
| `LINE_BOT_USER_ID`          | 受信先の公式アカウントのユーザーID（Uから始まる値）                          | Webサーバーのみ |
| `LINE_ALLOWED_USER_ID`      | 利用を許可する自分のLINEユーザーID（1人）                                    | Webサーバーのみ |
| `LINE_NOTE_OWNER_ID`        | LINEで追加する学習ノートの持ち主ID（数字のGitHub ID、または `password:...`） | Webサーバーのみ |
| `OPENAI_API_KEY`            | 添削・翻訳の生成（Webのチャットと共通）                                      | Webサーバーのみ |
| `CRON_SECRET`               | Vercel Cron・Cloud Tasksの認証（下記で生成する値）                           | Webサーバーのみ |
| `LINE_DRAIN_TASKS_QUEUE`    | Cloud Runのみ。drainを頼むCloud Tasksのキュー名                              | Webサーバーのみ |
| `LINE_DRAIN_FORWARD_URL`    | Vercelのみ。drainを取り次ぐCloud RunのURL（`https:`）                        | Webサーバーのみ |

`LINE_NOTE_OWNER_ID` は数字のGitHub ID、または `password:` で始まるメンバーのIDです。未設定や形式が違うときもLINE連携は止まりませんが、記録は保存せず、LINEに「添削（翻訳）できませんでした」とエラーコード `NOTE_OWNER_MISSING` の返信を送り、ログに `LINE_NOTE_OWNER_MISSING` を出します。

LINE DevelopersのチャネルID、チャネルシークレット、チャネルアクセストークン、公式アカウントのID、自分のユーザーIDはそれぞれ別物です。トークン類はチャットやGitに貼らず、Vercel環境変数／gitignore済みの `.env.local` に保存してください。

`CRON_SECRET` は**32文字以上**にしてください。これより短い値は未設定と同じに扱い、`/api/line/drain` は常に401を返します。次のコマンドで生成します（生成結果を秘密として扱ってください）：

```sh
openssl rand -hex 32
```

Vercelに `CRON_SECRET` を設定すると、Vercel Cronが `Authorization: Bearer <値>` を付けて `/api/line/drain` を呼びます。Cloud Runの値は `enable-line-cloud-run.sh` が自動で作り、Secret Managerの `zhuelog-CRON_SECRET` に保存します。Vercelは受け取った呼び出しを自分の `CRON_SECRET` でCloud Runに取り次ぐので、**VercelとCloud Runの `CRON_SECRET` は同じ値にしてください**（違うと取り次ぎ先が401を返し、Vercelのログに `LINE_DRAIN_FORWARD_FAILED 401` が出ます）。未設定、または32文字未満のままでは、このルートは常に401を返します。

### テスト専用の環境変数

`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` は、E2Eテストが偽のOpenAI／LINEサーバーへ接続するための設定です。`http://127.0.0.1`・`http://localhost`・`http://[::1]`（ポート指定可）のループバックだけを受け付け、それ以外の値はエラーになります。**本番では設定しないでください。** 無効な値（ループバック以外）を設定してもwebhookは200を返し続けますが、そのあとの処理（drain）がすべて失敗してログに `LINE_DRAIN_FAILED` が出続け、ジョブがたまっていきます。設定しなければ、`https://api.openai.com` と `https://api.line.me` に接続します。

## 新しい環境で有効化する順序（公開・本番変更の承認が必要）

1. LINE Official Account Managerの「設定」→「Messaging API」で有効化。LINE Developers側で対応するチャネルを確認します。
2. LINE Developersの「チャネル基本設定」でChannel secretと自分のユーザーIDを確認。「Messaging API設定」でChannel access tokenを発行します。公式アカウントのユーザーIDはBot情報取得API `GET /v2/bot/info` の `userId` です。別用途の既存トークンは勝手に再発行しないでください。
3. 公開対象のアプリとDBを確認し、バックアップ後に `pnpm run db:deploy` で追加マイグレーションを適用、アプリをデプロイします。現在のローカル `.env` を使って本番操作を行うのではなく、対象環境を明示してください。
4. Webサーバーに上表の変数を設定し、最後に `LINE_INTEGRATION_ENABLED=true` にします。Webhookは署名、Cronは `CRON_SECRET` で認証します。
5. Webhook URLを `https://公開アプリのホスト/api/line/webhook` に設定し「検証」。署名が正しく `events: []` なら200を返します。「Webhookの利用」と再送を有効化。不要な自動応答はOFFにします。
6. 公式アカウントを友だち追加し、短い中文と短い日本語を送信。添削と中国語訳の返信、Webの学習ノート一覧・日付別一覧を確認します。

## v0.12.0への切り替えの手順（Macのworkerからの移行）

1. 本番DBにマイグレーション `20261005090000_learning_kind_and_translation` を適用する（`pnpm run db:deploy`、内部では `prisma migrate deploy`）。デプロイより先に行ってください。
2. Vercelに `CRON_SECRET` を設定する。
3. mainにマージする（Vercelに自動でデプロイされる）。
4. MacのLaunchAgent `jp.ffpf.zhuelog.line-worker` を止める。止め忘れても、worker APIはなくなったので二重には処理されません。

   ```sh
   launchctl bootout gui/$(id -u)/jp.ffpf.zhuelog.line-worker
   ```

   不要になった `~/Library/LaunchAgents/jp.ffpf.zhuelog.line-worker.plist` と、Macの `.env.local` にある `LINE_WORKER_URL`・`LINE_WORKER_TOKEN` も削除できます。

5. 不要になった `LINE_WORKER_TOKEN`・`LINE_DEV_MODE_ENABLED` をVercelから削除する（残しても害はありません）。
6. 本人のLINEから短い日本語と中文を送り、中国語訳・添削が返ることを確認する。

ロールバックするときは、追加した列・制約は削除せずそのまま残します（旧版は新しい列を使いません）。過去のジョブ行・開発モードの表・`/battery` の履歴は削除しておらず、コードからは参照しません。

## 重複・失敗時の扱い

- LINE `webhookEventId` の一意制約で再送を重複登録しません。
- 処理は2分のリース（`leaseToken`）を取得して行います。古い処理の完了通知は拒否し、同時処理を防ぎます。締め切りで途中だったジョブは、リースが切れたあとに次の処理が拾い直します。
- ノート作成とCSV保存は1つのDBトランザクション。返信失敗でも作成済みノートを重複させません。
- 生成の失敗は再試行せず、失敗の返信にします（1メッセージにつきOpenAIの呼び出しは1回）。処理が途中で止まった（関数の打ち切りなど）場合に限り、リースが切れたあとに最大3回まで引き継いで生成し直します。それでも終わらなければ、ユーザーに失敗の返信（`OPENAI_REQUEST_FAILED`）を送ります。配送は最大5回で、失敗時は待ち時間を増やし、上限後は `FAILED`（`ATTEMPTS_EXHAUSTED`）になります。
- LINE配送は保存済みCSVから同じ文章を組み立て、宛先・同じ `X-Line-Retry-Key` を再利用します。受理済みの409は成功扱いにします。24時間の重複防止期限を越えないよう、初回配送開始から23時間後は自動再送を停止します。5,000文字を超える返信は切り捨てず配送を失敗扱いにします。
- DBの `LineLearningJob.status` / `failureCode` を管理者が確認できます。状態は `PENDING → GENERATING → READY → SENDING → SENT`、または `FAILED`。配信時の `failureCode` は、LINEの重複防止期間（24時間）に近づいて送信を止めた場合が `DELIVERY_WINDOW_EXPIRED`、送る内容が欠けた壊れたレコードの場合が `DELIVERY_STATE_INVALID` です。`SENT` はLINE API受理を表し端末閲覧を保証しません。
- 利用制限、認証エラー、入力不正、長すぎるAI回答等は自動で再試行しません。`FAILED` のリセットは原因と送信済みの可能性を確認してから行います。

## 検証

```sh
pnpm run test:unit
pnpm run test:e2e
pnpm run test:e2e:stop
```

単体テストはOpenAIとLINEのHTTP通信をモックします。E2Eは固定の隔離PostgreSQLと、手元で立てる偽のOpenAI（`127.0.0.1:3108`）・偽のLINE（`127.0.0.1:3109`）を使い、署名付き受信・再送・日本語の翻訳・中文の添削・生成失敗の返信・同時受信・Cronでの拾い直し・ノート登録を、本番ビルドのサーバーで検証します。実際のLINEとOpenAIには一切接続しません。

## 公式資料

- [LINE Webhook署名検証](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Webhook受信と再送](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE APIの安全な再試行](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [メッセージ送信と配信数](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [OpenAI Responses API](https://developers.openai.com/api/reference/responses/overview)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
