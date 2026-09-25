# LINE連携（Business / Codex）

## 現在の範囲

2026-09-24: 承認を受けて本番DBへの追加マイグレーション、Vercelへのデプロイ、LINE接続設定を実施しました。
LINE公式アカウントは「学习録 公式」(`@393bohaw`)、プロバイダーは `ffpf-zhuelog`、チャネルIDは `2011714744` です。
Webhookは `https://ffpf-zhuelog.vercel.app/api/line/webhook`。LINE管理画面の接続検証が成功しています。
本番だけで連携を有効化し、自分のLINEユーザーID1名を許可しています。ローカルWebアプリのWebhookは無効のままです。
標準の応答メッセージはOFF、Webhookの利用・再送はON。トークンはGit対象外のローカル設定とVercelの本番用秘密設定に保存しています。
新しい環境へ導入する場合は、下記手順に従って別途設定してください（`.env.example` は無効のままです）。
Codex App Serverは実験的なインターフェースです。本連携も個人用の試作として扱い、安定稼働を保証する本番機能ではありません。

## 処理の流れ

```text
自分のLINE（公式アカウントとの1対1トーク）
  → 公開Webアプリ /api/line/webhook：署名・送信者検証 → DBに処理待ちを保存
  ← このMacのworkerがHTTPSで取得（待機中は15秒間隔、Macへの着信ポート不要）
  → ログイン済みCodex Business / gpt-5.6-sol：添削・ピン音・ヒントを生成
  → /api/line/worker：結果を検証 → 学習ノートと返信用CSVを同時保存
  → LINE Push API：保存済みCSVを見出し・改行付きの文章に整形し、自分のトークへ送信
```

Macが停止・スリープ中はDBで待機し、worker再起動後に再開します。
添削結果の保存が成功したら、15秒待たずに次のジョブを取得し、配送へ進みます。配送完了後も次のジョブをすぐ確認します。待機するのはキューが空の場合、エラーや結果不明・lease競合の場合です。保存と配送の順序、lease・再送キーによる重複防止は維持します。
アプリがMacを呼び出す構成ではないので、localhostやCodexの外部公開・トンネルは不要です。
VercelではCodexを実行しません。既存Webチャットのローカル限定条件も解除しません。

## 使い方・制限

- 自分の1対1トークで `/battery` と送ると、Macのバッテリー残量・充電状態・電源・取得時刻（日本時間）を返します。OSが推定時間を返した場合は目安も表示します。前後の空白は無視しますが、引数や他のスラッシュコマンドは実行しません。
- `/battery` はAI・APIキー・学習ノート・インポート履歴を使いません。返信の再送に備えて、本人用のLINEジョブに返信テキストを保存します。ゲスト向けのノート一覧には表示しません。Push配信枠は通常のLINE返信と同様に消費します。
- Macがスリープ・電源OFF・ログアウト中は取得できず、ワーカー再開後の状態を返信します。返信の「取得時刻」を確認してください。バッテリー非搭載・非macOS・読み取り失敗時は、取得できない旨を返します。
- 読み取りはMacワーカー内の `/usr/bin/pmset -g batt` 固定実行のみ。シェルや任意の引数は使わず、5秒の制限を設けています。Webhookの署名・本人制限・ジョブlease・再送キーは添削と共通です。
- 1メッセージを1ノートとして保存。最初は漢字を含む500文字以内のテキストが対象です。グループ、画像、音声、長文、許可されていないユーザー、その他イベントは処理しません。
- LINEには「元の文」「添削後」「ヒント」の見出しで返信します。添削文は文ごとにピンインを直下に配置し、ヒントは1〜5個を番号付きで表示します（Issue #11）。文とピンインの区切り数が一致しない場合は誤った対応付けを避け、添削文全体の直下にピンイン全体を表示します。
- 内部では `"最初の文","添削後の文","ピン音","ヒント1","ヒント2",...` のヘッダーなしCSVを引き続き保存します。表示の整形によって学習ノートの内容は変わりません。
- CSVはプログラムでエスケープします。AI出力を直接SQLやCSVとして実行しません。原文はAI出力ではなく保存済みのLINE本文から取得します。
- 日付別一覧はLINE送信日時（既存画面と同じJST表示）で分類します。登録後にWeb画面を再読み込みすると表示されます。
- **既存アプリの仕様に合わせ、登録したノートはゲストからも閲覧できます。** 非公開にしたい内容は送らないでください。LINE上で送信取消しても本アプリの保存済みノートは自動削除されません。
- メッセージはLINE、アプリのDB、OpenAIを経由します。チャネルシークレット・アクセストークン・workerトークンや本文をログに出しません。
- BusinessのCodex利用枠を消費します。OpenAI APIや別モデルへの自動切り替えはありません。
- 添削結果の返信はReply APIではなくPush APIを使用し、**LINE公式アカウントの配信枠**を消費します。友だち追加が必要です。受理成功でもブロック等で端末に表示されない場合があります。
- 生のCSVを表計算ソフトで開く場合は数式として評価させず、文字列としてインポートしてください。

## 必要な設定

専用のLINE公式アカウントを用意すると、既存ボットのWebhookを上書きせずに運用できます。

| 変数                        | 役割                                                | 設定先                   |
| --------------------------- | --------------------------------------------------- | ------------------------ |
| `LINE_INTEGRATION_ENABLED`  | 準備完了後だけ `true`                               | Webサーバー              |
| `LINE_CHANNEL_SECRET`       | Webhookの署名検証                                   | Webサーバーのみ          |
| `LINE_CHANNEL_ACCESS_TOKEN` | 添削結果のPush送信                                  | Webサーバーのみ          |
| `LINE_BOT_USER_ID`          | 受信先の公式アカウントのユーザーID（Uから始まる値） | Webサーバーのみ          |
| `LINE_ALLOWED_USER_ID`      | 利用を許可する自分のLINEユーザーID（1人）           | Webサーバーのみ          |
| `LINE_WORKER_TOKEN`         | worker専用認証キー（下記で生成する64桁hex）         | WebサーバーとMacで同じ値 |
| `LINE_WORKER_URL`           | 公開アプリのHTTPS origin（パスなし）                | Macのみ                  |

LINE DevelopersのチャネルID、チャネルシークレット、チャネルアクセストークン、公式アカウントのID、自分のユーザーIDはそれぞれ別物です。トークン類はチャットやGitに貼らず、Vercel環境変数／gitignore済みの `.env.local` に保存してください。

workerキーの生成（生成結果を秘密として扱ってください）：

```sh
openssl rand -hex 32
```

## 新しい環境で有効化する順序（公開・本番変更の承認が必要）

1. LINE Official Account Managerの「設定」→「Messaging API」で有効化。LINE Developers側で対応するチャネルを確認します。
2. LINE Developersの「チャネル基本設定」でChannel secretと自分のユーザーIDを確認。「Messaging API設定」でChannel access tokenを発行します。公式アカウントのユーザーIDはBot情報取得API `GET /v2/bot/info` の `userId` です。別用途の既存トークンは勝手に再発行しないでください。
3. 公開対象のアプリとDBを確認し、バックアップ後に `npm run db:deploy` で追加マイグレーションを適用、アプリをデプロイします。現在のローカル `.env` を使って本番操作を行うのではなく、対象環境を明示してください。
4. Webサーバーに上表の変数を設定し、最後に `LINE_INTEGRATION_ENABLED=true` にします。GitHubログイン認証とは別に、Webhookは署名、workerは専用Bearerトークンで認証します。
5. Webhook URLを `https://公開アプリのホスト/api/line/webhook` に設定し「検証」。署名が正しく `events: []` なら200を返します。「Webhookの利用」と再送を有効化。不要な自動応答はOFFにします。
6. Macの `.env.local` に `LINE_WORKER_URL` と `LINE_WORKER_TOKEN` を設定。CodexでBusinessログイン済みであることを確認し、以下を実行します。

```sh
codex login status
npm run line:worker:build
npm run line:worker
```

手動起動ではこのコマンドを起動している間だけ動きます。停止はCtrl+C。1回だけ処理する診断用コマンドは `npm run line:worker -- --once` です。

ワーカーは `workers/line/` のGo実装です。Go 1.27以降でビルドし、`build/line-worker` を直接実行します（常駐にNode.js/npm/tsxは不要、外部Go依存もありません）。WebアプリとAPI・DBは従来のTypeScriptのままです。添削モデル・ポーリング間隔・再送制御は変えません。

運用中のMacには本人の承認でLaunchAgent `jp.ffpf.zhuelog.line-worker` を登録しています。ログイン時に自動起動し、終了時は自動再起動します。設定は `~/Library/LaunchAgents/jp.ffpf.zhuelog.line-worker.plist`、ログは `~/Library/Logs/ffpf-zhuelog/` にあり、Gitには含めません。`ProgramArguments` はビルドしたGoバイナリの絶対パス1つ、`WorkingDirectory` はこのリポジトリです。環境には `NODE_ENV=development`、`CHAT_PROVIDER=codex-local`、検証済み `CODEX_LOCAL_BIN` の絶対パスを設定します。macOSの「書類」フォルダーに置く場合、新しい実行ファイルへのアクセス許可を求められることがあります。電源・スリープ設定は変更していません。

Goワーカーは、OSの環境変数 → `.env.development.local` → `.env.local` → `.env.development` → `.env` の優先順で、ワーカー用の設定だけを読み込みます。DB接続情報やLINEチャネルシークレットは読み込みません。設定値は1行のリテラル（引用符・コメント・`export` 可）にしてください。Next.jsの `$VARIABLE` 展開・複数行の値には対応せず、対象設定に含まれる場合は安全のため起動を拒否します。`npm run line:worker -- --check` は設定確認のみで、通信しません。`--once` は実際に1件取得・処理するため、本番での単なる疎通確認には使わないでください。

検証は `npm run test:worker`（Go vet・race detector付きテスト）、`npm run test:unit`（上記に加えGoバイナリのビルドと既存TypeScript契約テスト）です。通常のテストは模擬Codex／GitHub／LINE APIのみを使います。ビルド済みファイルはGitに含めません。更新時は常駐サービスを停止し、旧バイナリとplistを退避してから新しいバイナリに切り替えます。旧版へ戻す場合は退避した両方を戻し、同じLaunchAgentを再登録してください。新旧ワーカーの二重起動は避けてください。

常駐中は手動ワーカーを二重起動しないでください。状態確認は `launchctl print gui/$(id -u)/jp.ffpf.zhuelog.line-worker`、停止は `launchctl bootout gui/$(id -u)/jp.ffpf.zhuelog.line-worker`、再登録は `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.ffpf.zhuelog.line-worker.plist` です。

`/battery` の導入順は、追加DBマイグレーション → Vercel更新 → Macワーカー更新です。新しいワーカーだけが `capabilities: ["battery"]` を宣言するため、更新前のワーカーにはバッテリーの生成・配送ジョブを割り当てません。ロールバック時も追加カラムは削除せず保持します。旧サーバーへのロールバック中はワーカーを停止してください。

7. 公式アカウントを友だち追加し、短い中文を送信。改行付きの添削返信とWebノート一覧・日付別一覧の両方を確認します。

## 重複・失敗時の扱い

- LINE `webhookEventId` の一意制約で再送を重複登録しません。
- workerは2分のleaseを取得します。古いworkerの完了通知は拒否し、同時処理を防ぎます。
- ノート作成とCSV保存は1つのDBトランザクション。返信失敗でも作成済みノートを重複させません。
- 生成は最大3回、配送は最大5回。失敗時は待ち時間を増やし、上限後は `FAILED` になります。
- LINE配送は保存済みCSVから同じ文章を組み立て、宛先・同じ `X-Line-Retry-Key` を再利用します。受理済みの409は成功扱いにします。24時間の重複防止期限を越えないよう、初回配送開始から23時間後は自動再送を停止します。5,000文字を超える返信は切り捨てず配送を失敗扱いにします。
- DBの `LineLearningJob.status` / `failureCode` を管理者が確認できます。状態は `PENDING → GENERATING → READY → SENDING → SENT`、または `FAILED`。`SENT` はLINE API受理を表し端末閲覧を保証しません。
- 利用制限、認証エラー、入力不正、長すぎるAI回答等は自動でAPI課金に逃がしません。`FAILED` のリセットは原因と送信済みの可能性を確認してから行います。

## 検証

2026-09-24の本番確認では、実際にLINEで送信した中文2件について、Business/Codexでの添削、CSVのLINE API受理（`SENT`）、学習ノートの自動登録、JSTの日付別一覧への表示まで確認済みです。
2件とも生成・配送は各1回で、原文を含むCSVを既存パーサーで読み戻せることも確認しています。
端末への表示・通知はLINE側の状態にも依存します。
返信表示の変更では、見出し・改行・番号付きヒント、CSVの保持、文字数上限と不正データの送信拒否も確認しています。単体テスト21件（Mac workerの実起動テストを含む）、E2E38件、Lint・型チェックが通過しています。
本番ログには既存の `DATABASE_URL` の `sslmode=require` に関する将来の仕様変更警告がありますが、接続・登録・配送の失敗はありません。LINE設定とは別に、現在の証明書検証を維持する `verify-full` への本番設定統一を検討してください。

```sh
npm run test:unit
npm run test:e2e
npm run test:e2e:stop
```

単体テストはLINEのHTTP通信をモック。E2Eは固定の隔離PostgreSQLを使い、署名付き受信・再送・並行claim・lease回収・ノート登録・画面表示を検証します。実LINE送信は行いません。

## 公式資料

- [LINE Webhook署名検証](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Webhook受信と再送](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)
- [LINE APIの安全な再試行](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [メッセージ送信と配信数](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)

# LINE開発モード（/dev・/devend）

- 本人の1対1トークで `/dev` を送ると開発モードを開始。公開先と注意事項の返信を確認してから改善案を送ります。
- 以降のテキスト（500文字以内）は1通につき1件、`Sparklingstadt/ffpf-zhuelog` の公開Issueに登録し、URLをLINEへ返信します。日本語・英語・中文に対応します。
- タイトルは先頭行、本文は原文を保持します。AIによる仕様補完・コード変更・コミット・リリースは行いません。個人情報や秘密情報を投稿しないでください。
- `/devend` で終了し、通常の中文添削へ戻ります。既に受け付けたIssueは終了後も処理されます。モードはDBに保存され、Mac再起動をまたいで維持されます。
- 誤公開防止のため開始から24時間で自動終了。期限切れ後の最初の文は添削にもIssueにも回さず、期限切れを通知します。
- `/battery` はモードに関係なく従来どおり動作します。他のスラッシュコマンドは無視します。
- 開発モードでは学習ノート・インポート履歴を作成しません。専用の非公開ジョブとモード状態のみDBに保持します。
- Mac停止・スリープ中は受付状態を保存し、起動後に処理・返信します。モード操作そのものはWebhook受信時に確定します。順序が逆転した古いメッセージは公開せず、再送を案内します（遅れた `/devend` は安全のため終了を優先）。

## 有効化手順

1. DBのバックアップ後、`20260925010000_line_development_mode` までのマイグレーションを対象DBに適用する。
2. 新サーバーをデプロイする。Vercel側の `LINE_DEV_MODE_ENABLED` はまだ `false` にする。
3. MacのGitHub CLIに対象リポジトリのIssue作成権限でログインする（`gh auth login --hostname github.com`）。`LINE_GH_BIN` は既定で `/opt/homebrew/bin/gh`。GitHub認証情報はMacでのみ使用し、Vercelへ登録しない。
4. Macを新しいコードに更新し、Mac側で `LINE_DEV_ISSUES_ENABLED=true` を設定してワーカーを再起動する。旧サーバーは新capabilityを受け付けないため、サーバーの更新を先に行う。
5. Vercel側の `LINE_DEV_MODE_ENABLED=true` を設定して再デプロイし、本人のLINEから確認する。公開Issueを作る本番テストには公開してよい文だけを使う。

機能停止時はサーバー側の受付フラグとMac側の実行フラグを両方無効にしてください。DBの追加列・テーブルは残せます。サーバーの受付だけ止めても受付済みのIssueは処理されます。

GitHubへの作成前にDB上の一度限りの作成許可を消費します。レスポンス喪失・再起動時はIssue本文の専用マーカーで既存Issueを照合し、POSTを自動再実行しません。結果不明の場合はLINEに確認案内を返すため、一覧を確認してから必要に応じて再送してください。照合は検索インデックスを使わず、open/closed両方の直近最大1,000件が対象です。GitHubやDBの障害時に「必ず作れる」保証より重複公開防止を優先します。

GitHub API仕様: [Issue API](https://docs.github.com/en/rest/issues/issues#create-an-issue)、[ローカルCLI認証](https://cli.github.com/manual/gh_auth_token)。
