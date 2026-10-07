# ユーザーごとの学習ノートと会話記録

## 目的と承認済みの要件

今は全員で共有している学習ノート（CSVインポート・LINEで追加する記録）を、アカウントごとの記録に分ける。会話記録（`/chat` で保存した会話）はすでにアカウントごとだが、管理者が閲覧できる範囲を学習ノートとそろえる。

- 記録を見られるのは**本人と管理者**。管理者はメンバーを切り替えて全員分を**閲覧だけ**できる。会話記録も同じ。
- 既存の学習ノートは、すべて管理者 `Sparklingstadt`（GitHub ID `219588180`）のノートにする。
- LINEで追加される記録の持ち主は環境変数 `LINE_NOTE_OWNER_ID` で決める。
- 管理者は各画面の「表示するユーザー」切り替え欄で、閲覧する人を選ぶ（`?user=`）。
- ゲストは自分のノートを持たないので、学習ノートと日付別ログは使えなくなる。`/practice`（自分のAPIキーでの添削）は今までどおり使える。
- `/practice` の添削履歴（端末の localStorage）は、この作業では変更しない。

## 用語

- **持ち主ID（ownerId）**：記録の持ち主を表す文字列。会話記録で使っている形式と同じで、GitHubアカウントなら数字のID（例 `219588180`）、メンバーなら `password:<PasswordAccount.id>`。`AuthenticatedUser.githubId` がこの値を持つ。
- **表示対象**：画面に表示している記録の持ち主。自分か、admin が選んだ他の人。

## データ

- `LearningEntry` に `ownerId String` を追加し、`@@index([ownerId, createdAt])` を張る。今ある `@@index([createdAt])` は削除する（すべての検索が持ち主で絞り込むため）。
- マイグレーションでは、列を追加したあと既存の行を `UPDATE "LearningEntry" SET "ownerId" = '219588180'` で埋め、そのあと `NOT NULL` にする。GitHub のユーザーIDは公開されている情報なので、SQLに書いてよい。
- `ImportBatch` と `Hint` は変更しない。ImportBatch はエントリーから辿るだけで、持ち主はエントリー側で判断する。
- 日付ごとの一覧、件数、日付内の番号（`/logs/2026/10/07/3` の `3`）は、持ち主ごとに数える。

## 表示対象の判定

`packages/core/src/application/identity/use-cases/resolve-record-owner.ts` に `ResolveRecordOwner` を作る。

入力はログイン中のユーザー（`AuthenticatedUser | null`）と、`?user=` の値（`string | undefined`）。結果は次のどれか。

- `{ kind: "self", ownerId }`：自分の記録。書き込みできる。
- `{ kind: "other", ownerId }`：他人の記録。閲覧だけ。
- `{ kind: "denied" }`：権限なし。
- `{ kind: "redirect-self" }`：自分の記録の画面へ戻す。

規則は次のとおり。

1. 未ログイン、ゲスト、revoked、または持ち主ID（`githubId`）がないユーザー → `denied`。持ち主IDがないのは古いGitHubセッションで、今の「ログインし直してください」の案内を出す。
2. `?user` がない、または自分の持ち主IDと同じ → `self`。
3. admin が別の値を指定し、その値が持ち主IDの形式（`/^\d+$/` か `/^password:[a-z0-9]{20,32}$/`）に合う → `other`。存在しないIDでも、記録が0件として表示されるだけで、ほかに害はない。
4. admin が形式に合わない値を指定した → `redirect-self`。
5. member が別の値を指定した → `redirect-self`。

持ち主IDの形式チェックは、`src/infrastructure/auth/github-identity.ts` の `githubIdFromToken` と同じ規則にする。core 側にも同じ正規表現を置き、domain の関数 `isOwnerId(value: string): boolean` として共有する。github-identity.ts はこの関数を使うように変える。

## リポジトリ

- `LearningEntryRepository` のすべてのメソッドに、最初の引数として `ownerId` を渡す。
  - `importBatch(ownerId, fileName, entries)`
  - `listRecent(ownerId, limit)`
  - `listCreatedAt(ownerId)`
  - `listByDate(ownerId, range)`
  - `getByDateAndNumber(ownerId, range, entryNumber)`
- 「共有ノートなので持ち主はいない」というコメントは、内容に合わせて書き換える。
- 学習のユースケース（`ImportLearningCsv`、`ListRecentEntries`、`ListDailyEntries`、`GetDailyEntry`、`ListLogDates`）と連携エクスポート（`ExportIntegration`、`PreviewIntegration`）も、`ownerId` を受け取って渡す。
- LINE の保存（`prisma-line-job-repository.ts` で LearningEntry を作る部分）は、`ownerId` を受け取って保存する。
- `ConversationRepository` と `ConversationNoteRepository` はすでに `ownerId` を受け取るので、変更しない。

## 書き込み

- CSVインポートは、ログイン中の本人のノートに入れる。`?user` は見ない。Server Action が `user.githubId` を持ち主として渡す。持ち主IDがない場合は、今の会話保存と同じく「一度ログアウトしてログインし直してください。」を返す。
- 会話の保存API（`PUT /api/chat/conversations`）は今のまま、本人だけが保存できる。
- LINE は `LINE_NOTE_OWNER_ID` の持ち主のノートに入れる。

## 画面

### 対象の画面

- `/`（学習ノート）
- `/logs`、`/logs/[year]/[month]/[day]`、`/logs/[year]/[month]/[day]/[number]`
- `/conversations` と、その日付・番号のページ
- `/integrations/[id]`（Typle のプレビュー）
- `/api/integrations/[id]/export`（エクスポート）
- `/chat` は自分の会話を作る画面なので、`?user` は扱わない

### 各画面の動き

- 各画面は `ResolveRecordOwner` で表示対象を決める。
  - `denied`：ゲストがトップを開いたときは案内画面を出す。それ以外はトップへ戻す。未ログインのときは、今と同じくサインインへ移す。
  - `redirect-self`：`?user` を外した同じページへ戻す。
- **切り替え欄**：admin にだけ「表示するユーザー」の切り替え欄（`<select>` と、JavaScript なしでも使える「表示」ボタンを持つ GET フォーム）を出す。選択肢は「自分」と、`PasswordAccount` に登録したメンバー全員（`表示名（ログインID）`）。
  - 他の GitHub 管理者は一覧に出さない。記録の持ち主として保存された GitHub アカウントの一覧がないため。`?user=<数字ID>` を直接指定すれば閲覧はできる。
- **表示中の表示**：他人の記録を表示しているあいだは、ページ上部に「〇〇さんの記録を表示中（閲覧のみ）」と出す。
  - 〇〇は、メンバーなら表示名、それ以外は持ち主IDそのもの。
  - CSVインポートのフォームは出さない。
- **リンク**：他人を表示しているあいだは、ページ内の日付・番号・前後のページへのリンクに `?user=` を付けて引き継ぐ。「自分に戻る」リンクも出す。
- **ゲストのトップ**：学習ノートの代わりに「学習ノートは、ログインしたユーザーごとの記録です。ゲストは自分のAPIキーでの添削を利用できます。」と出し、`/practice` へのリンクを置く。
- **見出しと説明文**：「共有ノート」と書いている箇所（トップ、ログイン画面、README）は「学習ノート」など、個人の記録に合う言葉に変える。

## LINE

- 新しい環境変数 `LINE_NOTE_OWNER_ID`（持ち主IDの形式）を追加する。`LINE_INTEGRATION_ENABLED=true` のときは必須。
- 値がない、または形式が正しくないときは、LINE の処理は記録を保存しない。代わりに次のようにする。
  - ジョブを失敗として扱い、ユーザーには今の生成失敗と同じ返信を送る。
  - ログに固定コード `LINE_NOTE_OWNER_MISSING` を出す。
- `src/infrastructure/line/config.ts` で、ほかの LINE の設定と一緒に読む。
- 次の文書とスクリプトに、この環境変数を追加する。
  - `docs/line-integration.md`（環境変数の表）
  - `docs/cloud-run.md`
  - `scripts/enable-line-cloud-run.sh`（`--update-env-vars`）
  - E2E サーバー（`e2e/server.ts`）

## 会話記録

- `/conversations` の各ページは、`ResolveRecordOwner` の結果の持ち主IDで `ConversationNoteRepository` を読む。
- 他人の会話を表示しているあいだは閲覧だけ。会話の画面にはもともと編集の操作がないので、隠すものはない。
- 会話の API（`GET /api/chat/conversations`）は `/chat` 画面の「保存した会話」が使う本人用なので、`?user` は扱わない。

## エラーと安全性

- `?user` の値は、形式チェックを通ったものだけを持ち主IDとして使う。URLにはパスワードや個人情報を入れない。持ち主IDは記録の持ち主を指すだけの識別子。
- member が他人の `?user` を指定しても、エラーにせず自分の記録に戻す。他人の記録があるかどうかは教えない。
- 書き込み（CSVインポート、会話の保存）は、表示対象とは関係なく、常にログイン中の本人の持ち主IDで行う。

## テスト

- **ユニット**
  - `ResolveRecordOwner`：上の規則 1〜5 を、ロール（admin・member・guest・revoked・null）、`?user` の値（なし・自分・他人・不正な値）、持ち主IDのない admin の組み合わせで確認する。
  - `isOwnerId` と `githubIdFromToken` が同じ規則であること。
  - 学習のユースケースと連携エクスポートのユースケースが、`ownerId` をリポジトリに渡すこと。
  - LINE の設定で、`LINE_NOTE_OWNER_ID` がないとき・不正なときの扱い。
- **E2E**
  - member A と member B がそれぞれ CSV をインポートし、トップと日付別ログに自分の記録しか出ないこと。番号も持ち主ごとに数えること。
  - admin が切り替え欄で member A を選ぶと A の記録が「閲覧のみ」で表示され、CSVインポートのフォームが出ないこと。日付ページへ移っても A のままであること。
  - member が `?user=` に他人を指定すると、自分の記録に戻されること。
  - ゲストのトップに案内と `/practice` へのリンクが出て、`/logs` はトップへ戻されること。
  - admin が member の会話記録を閲覧できること。member は他人の会話記録を見られないこと。
  - Typle のエクスポートが、表示対象の記録だけを含むこと。
  - LINE で追加した記録が `LINE_NOTE_OWNER_ID` のノートに入ること。
  - 既存の E2E のうち、ゲストが共有ノートを閲覧する前提のものは、新しい仕様に合わせて書き換える。

## 本番への反映（マージ前）

- Neon にマイグレーションを適用する。既存の学習ノートは `219588180` のものになる。
- Cloud Run（LINE の処理）に、`LINE_NOTE_OWNER_ID=219588180` を設定する。Vercel では LINE が無効で、処理を Cloud Run に取り次ぐだけなので、設定は要らない。マイグレーションを適用し、環境変数を設定してからマージする。
- PR 本文に、この手順とコマンドを書く。
