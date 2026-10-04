# LINE の添削・翻訳を Mac なしで行う

- 作成日: 2026-10-04
- 対象バージョン: v0.12.0
- 状態: 設計合意済み（この仕様書のレビュー待ち）

## 1. 目的

LINE の添削は、利用者の Mac で動く Go のワーカーが Codex（ChatGPT のログイン）を使って生成している。そのため Mac が起動していないと返信が届かない。

これを Vercel の中だけで完結させ、OpenAI の API で生成する。あわせて、日本語の文を中国語に訳す「翻訳」を追加する。

成功の条件は次のとおり。

1. Mac が止まっていても、LINE に送った文の添削・翻訳が返ってくる。
2. 日本語の文（ひらがな・カタカナを含む文）には中国語訳が返り、それ以外の漢字の文には今までどおり添削が返る。
3. 添削・翻訳の結果は学習ノートに残り、翻訳は「翻訳」と分かる形で表示される。

## 2. 決定事項

| 項目               | 決定                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 実行場所           | Vercel（webhook のルートで `after()` を使う）。Google Cloud・Cloud Run は使わない（検討の結果、準備と運用の手間に見合わない） |
| 生成               | OpenAI Responses API。モデルは `gpt-5-mini` に固定。鍵は本番の `OPENAI_API_KEY`                                               |
| 翻訳の判定         | ひらがな・カタカナを含む文を日本語とみなし、中国語（簡体字）に訳す。コマンドは使わない                                        |
| 翻訳の保存         | 学習ノートに保存し、ノートに種類（`correction` / `translation`）を持たせる                                                    |
| Mac のワーカー     | 廃止する。`/battery` と開発モード（GitHub Issue の作成）も廃止する                                                            |
| 再試行             | 生成は再試行しない（二重課金を防ぐ）。LINE への送信の一時的な失敗は、次の処理の機会に再送する                                 |
| 取り残しの拾い直し | 次の webhook の処理と、Vercel Cron（1日1回）で行う                                                                            |
| 過去データ         | 過去のジョブ行・開発モードの表は削除しない（元に戻せないため）。コードからは参照しない                                        |

## 3. 対象外

- Web の練習画面（利用者本人の API キーでの添削）の変更
- Web のチャットの変更（ローカル開発用の Codex のチャットは残す）
- 中国語から日本語への翻訳
- LINE の reply token を使った返信（今までどおり push で返信する）
- 過去の `/battery`・開発モードのデータや、使わなくなった表・列の削除

## 4. 処理の流れ

```text
LINE ──▶ POST /api/line/webhook（Vercel、maxDuration = 60）
           1. 署名・送信者・イベントを今までどおり検証する
           2. 本文を振り分ける
              ・501文字以上 ............... text-too-long（上限の通知。今までどおり）
              ・ひらがな・カタカナを含む ... translation（新規）
              ・それ以外で漢字を含む ....... correction（今までどおり）
              ・それ以外 .................. 無視（/battery・/dev・/devend も無視になる）
           3. ジョブを登録し、200 を返す
           4. after() で DrainLineJobs を実行する（締め切りは開始から約50秒）
              ・古い順にジョブを取得（今までのリースの仕組み）
              ・生成待ち → OpenAI で添削・翻訳 → 学習ノートと返信用 CSV を保存
                           失敗 → 失敗の返信を保存（ノートは保存しない）
              ・送信待ち → LINE に push。一時的な失敗は再送待ちとして残す
              ・ジョブがなくなるか、締め切りを過ぎたら終える

GET /api/line/drain（Vercel Cron、1日1回、CRON_SECRET で認証）
           → DrainLineJobs を実行して取り残しを拾う
```

締め切りを過ぎたときに途中だったジョブは、リースの期限が切れたあとで次の処理が拾い直す（今までの仕組みのまま）。

## 5. 構成要素

### 5.1 core（`packages/core`）

- **`LineLearningGenerator`**（新規のポート、`application/line/ports/line-learning-generator.ts`）
  - `correct(text, signal): Promise<Correction>`
  - `translate(text, signal): Promise<Translation>`
  - 失敗は `LineGenerationError`（コード付き）で表す
- **`DrainLineJobs`**（新規のユースケース）：締め切りまでジョブを取得し、生成・保存・送信を行う。保存と送信は `ProcessLineLearning` を使う。
- **`ProcessLineLearning`**：バッテリーと開発モードの処理を削除し、`complete` がジョブの種類に応じて翻訳も保存するようにする。生成の失敗は、添削と翻訳の両方で失敗の返信にする。
- **`LineJobRepository.claim(userId)`**：機能ごとの真偽値の引数（`supportsBattery`・`supportsDevelopment`）をなくす。
- **ジョブの種類**：新しく作る種類は `correction`・`translation`・`text-too-long`。`battery`・`dev-issue`・`dev-reply` と状態 `IGNORED` は、DB の CHECK 制約との一致のために「昔の種類」として残すが、作成も取得もしない。
- **翻訳の形**：`translationSchema`（中国語訳 1000文字以内、ピン音 1600文字以内、ヒント 200文字以内を1〜5個）と、翻訳用の指示文。入力はデータとして扱い、文中の指示には従わせない。
- **失敗のコード**：`CODEX_*` を廃止し、`OPENAI_TIMEOUT`・`OPENAI_AUTH_FAILED`・`OPENAI_RATE_LIMITED`・`OPENAI_INVALID_RESPONSE`・`OPENAI_REQUEST_FAILED` を使う。`CORRECTION_TOO_LONG` は残す。返信は「添削できませんでした」または「翻訳できませんでした」に理由とコードを添える。
- **学習ノート**：`LearningEntry` に `kind`（`correction` / `translation`）を追加する。連携プラグインに渡す `LearningEntry` にも含まれる（項目の追加のみ）。
- **削除**：`battery-report.ts`・`development-mode.ts`・`development-routing.ts`。

### 5.2 アプリ（`src`）

- **`OpenAiLineLearningGenerator`**（新規）：Responses API を `fetch` で呼ぶ。`store: false`、20秒で打ち切り、再試行なし。結果は zod で検証する。1回の処理（約50秒）で複数件を処理できるよう、残り時間が20秒を切ったら新しい生成は始めず、次の処理に回す。
- **webhook のコントローラー**：振り分けに翻訳を追加し、開発モードの扱いを削除する。ルートで `after()` から `DrainLineJobs` を呼ぶ。
- **`/api/line/drain`**（新規）：Vercel Cron 用。`Authorization: Bearer ${CRON_SECRET}` を検証する。`vercel.json` に1日1回の Cron を登録する。
- **返信の整形**：翻訳は【元の文】【中国語訳】【ヒント】。中国語とピン音は文ごとに並べる（添削と同じ）。
- **学習ノートの画面**：翻訳のノートは差分の色分けをせず、「中国語訳」として表示する。
- **接続先の差し替え（テスト用）**：`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` で OpenAI と LINE の接続先を差し替えられる。ただし `http://127.0.0.1` などのループバックだけを受け付け、それ以外の値は起動時のエラーにする。
- **削除**：`/api/line/worker` とそのコントローラー、`codex-line-corrector.ts`、`mac-battery-reader.ts`、`development-issues.ts`、`scripts/line-worker.mts`、`LINE_WORKER_TOKEN`・`LINE_DEV_MODE_ENABLED` の読み込み。

### 5.3 削除するもの（その他）

- `workers/line/`（Go のワーカー）と、CI・`scripts/test-unit.mjs`・`package.json` の Go 関連の処理とスクリプト
- バッテリー・開発モード・ワーカー API のテストと E2E
- README と `docs/line-integration.md` の Mac の手順（LaunchAgent・Codex のログインなど）

## 6. データの変更

マイグレーションを1件追加する。

- `LearningEntry` に `kind TEXT NOT NULL DEFAULT 'correction'` と CHECK 制約（`correction` / `translation`）を追加する。既存のノートと CSV の取り込みは `correction` になる。
- `LineLearningJob_kind_check` に `translation` を追加する（既存の種類は残す）。

## 7. 安全策

- 署名の検証と、許可した1人のユーザーだけを受け付ける制限は変えない。
- 入力の文は指示ではなくデータとして渡し、結果は決められた形かを検証する。外れたら失敗として扱う。
- ログにはジョブ ID とコードだけを出し、本文・生成結果・鍵は出さない。
- OpenAI の呼び出しは1メッセージにつき1回まで。500文字の上限と送信者の制限で、費用の上限の目安が決まる。
- Cron のルートは `CRON_SECRET` が一致しない限り何もしない。

## 8. テスト

### 8.1 単体テスト

- 振り分け：ひらがな・カタカナを含む文は翻訳、漢字だけの文は添削、501文字以上は上限の通知、`/battery`・`/dev` は無視
- `OpenAiLineLearningGenerator`：モデル・`store: false`・入力をデータとして渡すこと、結果の検証、HTTP の状態や時間切れに応じたコード
- `DrainLineJobs`：古い順に処理する、締め切りで止まる、生成の失敗は失敗の返信になる、送信の一時的な失敗は残る
- 返信の整形：翻訳の見出し
- 学習ノートの画面：翻訳は色分けせず「中国語訳」と表示する
- Cron のルート：`CRON_SECRET` が違えば 401 で何もしない
- 接続先の差し替え：ループバック以外の値を拒否する
- 種類と DB の CHECK 制約の一致（既存のテスト）

### 8.2 E2E

E2E のサーバーは、OpenAI と LINE の偽サーバーを手元で立て、`OPENAI_API_BASE_URL` と `LINE_API_BASE_URL` をそこへ向ける。

- 日本語の文の webhook → `after()` での処理 → 学習ノートに「翻訳」として保存 → 偽の LINE サーバーに【中国語訳】の返信が届く
- 漢字の文の webhook → 添削として保存され、返信が届く
- 偽の OpenAI が失敗を返す → ノートは保存されず、失敗の返信が届く
- 実際の LINE と OpenAI には一切接続しない

## 9. 切り替えの手順

1. 本番 DB にマイグレーションを適用する（`prisma migrate deploy`）。
2. Vercel に `CRON_SECRET` を設定する。
3. main にマージする（Vercel に自動でデプロイされる）。
4. Mac の LaunchAgent のワーカーを止める。止め忘れても、ワーカー API がないので二重には処理されない。
5. 不要になった `LINE_WORKER_TOKEN`・`LINE_DEV_MODE_ENABLED` を Vercel から削除する（残しても害はない）。
6. リリースノート `docs/releases/v0.12.0.md` を書き、バージョンを 0.12.0 にする。
