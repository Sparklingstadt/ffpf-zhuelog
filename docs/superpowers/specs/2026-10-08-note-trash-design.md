# 学習ノートと会話ノートのゴミ箱

## 目的と承認済みの要件

学習ノート（`/logs`）と会話ノート（`/conversations`）を、自分で消せるようにする。消したノートはすぐには消えず、ゴミ箱に入る。

- 削除は**ゴミ箱方式（論理削除）**。ゴミ箱から元に戻せる。
- ゴミ箱のノートは**手動で消すまで残す**。自動で消す仕組み（Cron）は作らない。
- ゴミ箱は**ノートごとに別ページ**：`/logs/trash` と `/conversations/trash`。
- 「ゴミ箱に入れる」ボタンは**詳細画面だけ**に置く（`/logs/年/月/日/番号`、`/conversations/年/月/日/番号`）。
- ゴミ箱にある会話をチャット画面から保存し直すと、**ゴミ箱から出す（復元する）**。

あわせて次を前提とする。

- 操作できるのは**自分のノートだけ**。管理者が他人の記録を表示しているとき（`owner.kind === "other"`）は、削除ボタンもゴミ箱への入口も出さない。
- ゴミ箱に入れる操作は元に戻せるので、確認を出さない。「完全に削除」と「ゴミ箱を空にする」は確認を出す。
- ゴミ箱のノートは、トップの最近のノート、日付一覧、その日の一覧、詳細、連携エクスポート・プレビュー、チャット画面のDB保存履歴のどこにも出さない。日付内の番号（`/logs/2026/10/08/3` の `3`）と件数は、ゴミ箱にないノートだけで数える。

## 用語

- **持ち主ID（ownerId）**：`AuthenticatedUser.githubId` の値。GitHubアカウントなら数字のID、メンバーなら `password:<PasswordAccount.id>`。
- **ゴミ箱に入れる（trash）**：`deletedAt` に今の時刻を入れる。
- **元に戻す（restore）**：`deletedAt` を `null` に戻す。
- **完全に削除（purge）**：行を物理削除する。ゴミ箱にあるものだけが対象。

## データ

- `LearningEntry` と `ChatConversation` に `deletedAt DateTime?` を追加する。
- 両方に `@@index([ownerId, deletedAt])` を追加する（ゴミ箱一覧と件数のため）。
- マイグレーション名は `add_note_trash`。null 許可の列とインデックスを足すだけなので、既存の行はすべて「ゴミ箱にない」状態のまま残る。
- 本番 Neon へのマイグレーションは、いつもどおり main へのマージ前に適用する。
- 完全に削除したとき、`Hint` は既存の `onDelete: Cascade` で一緒に消える。`ImportBatch` と、LINE ジョブの `entryId` はそのまま残す。どちらも外部キーで縛られておらず、ほかから読まれていない。

## リポジトリ

### 学習ノート（`LearningEntryRepository`）

既存のメソッドは、すべて `deletedAt: null` で絞り込む。

- `listRecent`（件数 `total` も含む）
- `listCreatedAt`
- `listByDate`
- `getByDateAndNumber`（番号と `total` も含む）

次のメソッドを追加する。どれも `where` に `ownerId` を入れるので、他人のIDを渡されても何も起きない。

- `trash(ownerId, id): Promise<boolean>`：`{ id, ownerId, deletedAt: null }` の行の `deletedAt` を今の時刻にする。更新した行がなければ `false`。
- `restore(ownerId, id): Promise<boolean>`：`{ id, ownerId, deletedAt: { not: null } }` の行の `deletedAt` を `null` にする。
- `purge(ownerId, id): Promise<boolean>`：`{ id, ownerId, deletedAt: { not: null } }` の行を削除する。
- `emptyTrash(ownerId): Promise<number>`：`{ ownerId, deletedAt: { not: null } }` の行をすべて削除し、件数を返す。
- `listTrashed(ownerId, limit): Promise<TrashedLearningEntries>`：ゴミ箱の行を `deletedAt` の新しい順に `limit` 件と、ゴミ箱の総数を返す。

```ts
export type TrashedLearningEntry = LearningEntry & { deletedAt: Date };
export type TrashedLearningEntries = {
  entries: TrashedLearningEntry[];
  total: number;
};
```

### 会話ノート

`ConversationRepository`（チャット画面が使う側）：

- `list` と `get` は `deletedAt: null` で絞り込む。
- `save` の upsert は、`update` に `deletedAt: null` を入れる。ゴミ箱にある会話を保存し直すと復元される。`create` は今までどおり。

`ConversationNoteRepository`（会話ノートの画面が使う側）：

- `listCreatedAt`、`listByDate`、`getByDateAndNumber` は `deletedAt: null` で絞り込む（番号と `total` も含む）。
- 学習ノートと同じ `trash`・`restore`・`purge`・`emptyTrash`・`listTrashed` を追加する。`listTrashed` はメッセージ本文を返さず、要約を返す。

```ts
export type TrashedConversationNote = ConversationNoteSummary & {
  deletedAt: string; // ISO 文字列。ConversationSummary の日時と同じ形式
};
export type TrashedConversationNotes = {
  conversations: TrashedConversationNote[];
  total: number;
};
```

## ユースケース

既存に合わせて1ファイル1クラスにする。どれもリポジトリに渡すだけの薄いクラスで、持ち主IDを第1引数に取る。

- `packages/core/src/application/learning/use-cases/`
  - `trash-learning-entry.ts`：`TrashLearningEntry`
  - `restore-learning-entry.ts`：`RestoreLearningEntry`
  - `purge-learning-entry.ts`：`PurgeLearningEntry`
  - `empty-learning-trash.ts`：`EmptyLearningTrash`
  - `list-trashed-entries.ts`：`ListTrashedEntries`
- `packages/core/src/application/chat/use-cases/`
  - `trash-conversation.ts`：`TrashConversation`
  - `restore-conversation.ts`：`RestoreConversation`
  - `purge-conversation.ts`：`PurgeConversation`
  - `empty-conversation-trash.ts`：`EmptyConversationTrash`
  - `list-trashed-conversations.ts`：`ListTrashedConversations`

`learning-container.ts` と `conversation-container.ts` に登録する。ゴミ箱一覧の表示上限は 100 件とし、定数としてユースケース側に置く。

## 書き込み（Server Action）

### 処理の置き場所

- `src/presentation/controllers/note-trash-controller.ts` に処理本体を置く。既存の `learning-csv-import-controller.ts` と同じく、現在のユーザーを取る関数とユースケースを引数で受け取る。
- `src/presentation/actions/note-trash-actions.ts`（`"use server"`）は、controller を呼んで、成功時に再検証とリダイレクトをするだけにする。
- アクションは学習ノート・会話ノートそれぞれに4つ：ゴミ箱に入れる、元に戻す、完全に削除、ゴミ箱を空にする。

### 権限と入力

- `getCurrentMemberUser()` でユーザーを取る。`null`（未ログイン・ゲスト・権限を失ったユーザー）か、`githubId` がない場合は拒否する。
- 持ち主IDは常に `user.githubId`。フォームから持ち主IDは受け取らない。管理者でも他人のノートは操作できない。
- ノートIDはフォームの隠しフィールド `id` で受け取り、形式を検証する。学習ノートは `z.cuid()`、会話は `z.uuid()`。不正なら何もせず「見つからない」と同じエラーを返す。
- 同一オリジンの確認は Server Action に組み込みのものに任せる。実装前に `node_modules/next/dist/docs/` で今のバージョンの仕様を確かめる。

### 結果とエラー

controller は次の状態を返す。

- 成功
- `unauthorized`：「ログインし直してください。」
- `not-found`：「このノートは見つかりませんでした。画面を更新してください。」（すでに移動済み・他人のID・不正なID・消えたもの）
- `failed`：「処理できませんでした。時間をおいてもう一度お試しください。」（DB失敗）

エラーはボタンの近くに出す（`useActionState`）。ログには固定のコードだけを出し、ノートの本文やタイトルは出さない。

### 成功したあと

- いずれも `revalidatePath("/")`、`revalidatePath("/logs", "layout")`、`revalidatePath("/conversations", "layout")` を呼ぶ。
- ゴミ箱に入れたとき：その日の一覧へ `?trashed=1` つきでリダイレクトする（`/logs/年/月/日?trashed=1`、`/conversations/年/月/日?trashed=1`）。リダイレクト先の日付は、フォームの隠しフィールドで受け取り、`parseLogDate` で検証する。不正なら日付一覧（`/logs`、`/conversations`）へ送る。
- 元に戻す・完全に削除・ゴミ箱を空にするとき：ゴミ箱画面にとどまり、再表示する。

## 画面

### 詳細画面

- `owner.kind === "self"` のときだけ、「ゴミ箱に入れる」ボタンを置く。学習ノートはカードの下、会話ノートはダウンロードボタンの隣。
- 確認は出さない。

### その日の一覧

- `?trashed=1` があり、`owner.kind === "self"` のとき、「ゴミ箱に入れました。ゴミ箱から元に戻せます。」とゴミ箱へのリンクを出す。
- その日のノートがなくなった場合は、今の「この日の〜はありません」表示になる。

### ゴミ箱への入口

- `/logs`・`/conversations` の日付一覧と、その日の一覧のヘッダーに「ゴミ箱」ボタンを置く。`owner.kind === "self"` のときだけ出す。

### ゴミ箱画面（`/logs/trash`、`/conversations/trash`）

- 常に自分のゴミ箱を出す。`?user=` は読まないので、管理者でも他人のゴミ箱は見られない。
- 未ログイン・権限を失ったユーザーはサインインへ、ゲストはトップへ送る。`githubId` がない古いセッションには既存の `ReauthNotice` を出す。判定は `getRecordOwner(undefined)` の結果を使い、既存のページとそろえる。
- ヘッダー：「ゴミ箱：N件」、日付一覧へ戻るリンク、「ゴミ箱を空にする」（確認あり、0件なら出さない）。
- 一覧：ゴミ箱に入れた日時の新しい順に最大 100 件。総数がそれより多いときは「古い N 件は表示していません。ゴミ箱を空にすると、表示していないものも含めて全部消えます。」と出す。
- 0件のときは「ゴミ箱は空です」のカードを出す。
- 学習ノート：既存の `LearningEntryCard` を閉じた状態（`defaultOpen={false}`）で並べる。カードに `actions?: ReactNode` を追加し、フッターに「ゴミ箱に入れた日時」「元に戻す」「完全に削除」（確認あり）を出す。番号の欄には作成日を出す。
- 会話ノート：タイトル、保存日時、メッセージ件数、モデル名、ゴミ箱に入れた日時のカードに、「元に戻す」「完全に削除」（確認あり）を付ける。ゴミ箱の会話の中身を開く画面は作らない。
- Next.js のルーティングでは静的な `trash` が動的な `[year]` より優先される。`/logs/[year]` 単体のページはないので衝突しない。

### 確認ダイアログ

- `src/presentation/components/records/confirm-submit-button.tsx`（クライアント部品）を作る。`window.confirm(message)` で確かめてから送信する。キャンセルなら送信しない。
- 文言：
  - 完全に削除：「このノートを完全に削除します。元に戻せません。よろしいですか？」
  - ゴミ箱を空にする：「ゴミ箱の N 件を完全に削除します。元に戻せません。よろしいですか？」

### チャット画面

- 変更しない。DBの保存履歴からゴミ箱の会話は消える。端末バックアップにある会話を保存し直すと、ゴミ箱から出る。

## テスト

- **core 単体**（`packages/core/tests/`、`node:test`）：新しいユースケース10個が、持ち主IDとIDをそのままリポジトリに渡すこと。`learning-owner.test.ts` などの偽リポジトリに新しいメソッドを足す。
- **controller 単体**（`tests/note-trash-controller.test.ts`）：未ログイン、`githubId` なし、不正ID、対象なし（リポジトリが `false`）、DB失敗、成功の各場合。持ち主IDがフォームではなくユーザーから来ること。
- **E2E**（`e2e/trash.spec.ts`、実DB）
  - 学習ノート：詳細でゴミ箱に入れる → その日の一覧に通知が出て、ノートが消え、番号が振り直される → トップの最近のノートと日付一覧からも消える → ゴミ箱に出る → 元に戻す → もう一度入れて完全に削除（確認を受け入れる）→ 別のノートを入れてゴミ箱を空にする。
  - 会話ノート：詳細でゴミ箱に入れる → チャット画面のDB保存履歴から消える → チャットで保存し直すと会話ノートに戻る → もう一度入れて完全に削除。
  - 確認をキャンセルすると、完全に削除されない。
  - 管理者で他人を表示中：詳細に「ゴミ箱に入れる」も、一覧に「ゴミ箱」も出ない。`/logs/trash?user=<他人>` でも自分のゴミ箱が出る。
- Prisma のクエリは、既存と同じく E2E で確かめる。

## ドキュメント

- README の学習ノート・会話ノートの説明に、ゴミ箱（入れ方、元に戻し方、完全に削除）を追記する。

## やらないこと

- 一覧画面からの削除、まとめて選んで削除。
- ゴミ箱の自動削除。
- ゴミ箱の会話の中身を表示する画面。
- 管理者による他人のノートの削除・ゴミ箱の閲覧。
- 空になった `ImportBatch` の掃除。
