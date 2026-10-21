# Web のデータの読み書きを Go API に移す（段階3）

段階2（`2026-10-21-web-auth-via-go-api-design.md`）で、`GO_API_URL` があるときだけ Web のログインを Go API で行うようにした。段階3では、Web（Next.js）のデータの読み書きもすべて Go API 経由にし、Web から Prisma の読み書きと Auth.js を外す。Web はフロントエンドだけ、Go API がバックエンドになる。

## 承認済みの方針

- スキーマとマイグレーションは Prisma に残す（`prisma/schema.prisma`・`prisma/migrations/`・シードのスクリプト）。Web の実行時の Prisma の読み書きはなくす。
- Auth.js は外す。`GO_API_URL` は必須になる（Go 版だけ）。
- 実装して PR まで作る。マージは、利用者が Go API の Vercel プロジェクトを作り、本番の Web を Go 版に切り替えて動きを確かめてから（このマージで Auth.js 版は無くなるため）。

## 決めたこと（このセッションで決めた点）

1. **件数は Go API が返す。** `GET /v1/entries` と `GET /v1/trash` の応答に `total`（その持ち主の、ゴミ箱に無いノートの数／ゴミ箱のノートの数。ページに関係なく全体の数）を足す。項目が増えるだけなので、モバイルアプリには影響しない。ホームの「登録済み N 文」とカードの番号、ゴミ箱の件数の表示は今のまま。
2. **一覧は今と同じく 1 回で取る。** ホーム・ゴミ箱・タイムラインは `limit=100` の 1 ページだけを取る（今の Web と同じ上限）。カーソルでの続きは使わない。
3. **並び順の細かな違いは Go に合わせる。** 同じ時刻のノートの順（ゴミ箱・タイムラインの `id` の向き）と、会員一覧の並び（DB の `ja-x-icu`）は Go のまま。
4. **エラーの文言は Go のものを使う。** `GoApiError` に Go の `message` を持たせる。入力の誤り（`400 invalid_request`・`invalid_csv`・`password_mismatch`・`invalid_current_password`）、`409 login_id_taken`、`413 too_large` は Go の文言をそのまま画面に出す（Go は Web と同じ日本語の文言を持っている）。`401` はログイン画面へ、`403` は今の「権限がありません」の扱い、`429` と `5xx`・届かないときは今の一般的な文言にする。
5. **作り。** 画面と Server Action の制御（`src/presentation/controllers/*`）は残し、その下を差し替える。
   - Go API を呼ぶアダプタを `src/infrastructure/go-api/` に置く（ノート・ゴミ箱・共有・カレンダー・CSV・フォロー・会員管理・パスワード変更）。アクセストークンは `zl_access` の Cookie から読む。
   - Go が持っている処理と重なる Web のユースケース（カレンダーの日付のまとめ、フォローの一覧とタイムラインの組み立て、CSV の解析、会員の作成・パスワードの再設定・自分のパスワード変更の検証と throttle、パスワードログイン）は消し、Go の結果をそのまま使う。
   - 画面が使う型（`LearningEntry` など domain の型）は残し、Go の JSON をそれに直す（日時は `Date` に）。
6. **CSV はファイルをそのまま Go に送る。** `multipart/form-data`（項目名 `csvFile`）で `POST /v1/imports/csv`。時間切れは 4 分 30 秒（Go 側は 4 分）。大きさ・拡張子・中身の検証は Go が行い、その文言を出す。Web の `csv-parse` の解析は消す。
7. **`?user=`。** 管理者が他の人のノートを見るときだけ、Go の 5 つの読み取り（`/v1/entries`・`/v1/log-dates`・`/v1/log-dates/{date}/entries`・`.../{number}`）に `?user=` を付ける。どの持ち主を見るかの判断（`resolveRecordOwner`）は今のまま Web が行う。書き込みは常にトークンの持ち主。
8. **Go が `401` を返したら**（読み取りの途中でセッションが切れた）、今の利用者の取得と同じく「ログインしていない」として `/signin` へ送る。
9. **パスワード変更の後**は、今と同じく Go のセッションを消して `/signin?notice=password-changed` へ。
10. **Auth.js を外す。** `next-auth` の依存、`src/auth.ts`、`/api/auth/[...nextauth]`、`src/infrastructure/auth/` の Auth.js の部分、`next-auth.d.ts`、`isGoAuthEnabled` の分岐をなくす。`proxy.ts` は常に Go 版。`client-address.ts` は残す。Web で使う環境変数は `GO_API_URL`・`API_WEB_PROXY_SECRET`・`AUTH_URL`・`AUTH_GITHUB_ID` になる（`AUTH_SECRET`・`AUTH_GITHUB_SECRET`・`AUTH_ALLOWED_GITHUB_IDS`・`DATABASE_URL` は Web の実行時には不要）。
11. **Prisma の Web の部分を消す。** `src/infrastructure/persistence/prisma/` を消す。`prisma generate` は、シードのスクリプトが生成したクライアントを使うので残す。scrypt のハッシュ（`ScryptPasswordHasher`）は、e2e とシードのスクリプトだけが使うので `scripts/` 側に移す。
12. **e2e と CI は Go 版の 1 通りにする。** `ZHUELOG_E2E_AUTH` の切り替えをやめ、e2e は常に Go API も起動する。CI の e2e の matrix をなくす。
13. **ドキュメント。** README・`.env.example`・`docs/api-deployment.md`・`docs-site/` の Auth.js と切り替えの記述を、Go 版だけの構成に直す。切り替えの手順は「段階3のマージの前に行うこと」として残す。

## Go API の変更

- `GET /v1/entries`・`GET /v1/trash` の応答に `total`（整数）を足す。テストとドキュメントも。
- それ以外の変更はしない。

## テスト

- Web の unit：Go API のアダプタ（JSON から domain の型へ、`?user=` の付け方、エラーの文言、multipart）、controller のつなぎ替え。Prisma・Auth.js を前提にしたテストは、消すか Go のアダプタ向けに直す。
- e2e：全部を Go 版で通す（今の 86＋2 件。Auth.js 版でしか意味のないものは消す）。
- Go：`total` のテスト。

## 範囲外

- 一覧の続きを読む画面（カーソル）、ノートの編集画面（Go にはあるが Web には無い）。
- モバイルアプリ。
