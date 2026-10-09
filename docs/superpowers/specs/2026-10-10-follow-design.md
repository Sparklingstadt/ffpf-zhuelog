# フォロー・フォロワーと学習ノートの共有

## 目的と承認済みの要件

管理者とメンバーが、ほかのメンバーをフォローし、その人が共有した学習ノートを読めるようにする。

- ヘッダーに「フォロー」を出すのは、ロールが**管理者またはメンバー**のときだけ。ゲストには出さない。
- `/follow` に、**自分以外のメンバー**の名前と［フォローする］／［フォロー解除］ボタンを並べる。
- 共有の対象は**学習ノートだけ**。会話ノートは今までどおり本人（と管理者の閲覧）だけ。
- 共有は**ノート1件ごと**に設定する。初期値は「共有しない」。
- フォローした人の共有ノートは、`/follow` の**タイムライン**にまとめて新しい順に出す。
- フォロワーは、メンバー一覧の各行に「フォローされています」と出す。上に「フォロー中 N人・フォロワー N人」を出す。

あわせて次を前提とする。

- フォローに承認は要らない。片方向で、相手に通知もしない。
- 管理者（GitHub ログイン）は DB に行がないので、`/follow` の一覧に出ず、フォローされることもない。管理者がメンバーをフォローすることはできる。
- フォロワーの人数には管理者も数える。管理者は一覧に行がないので、人数だけに入る。
- 管理者が `?user=` で他人の記録を閲覧のみで見る今の機能は変えない。共有の有無に関係なく、今までどおり全部見られる。

## 用語

- **持ち主ID（ownerId）**：`AuthenticatedUser.githubId` の値。GitHub アカウントなら数字の ID、メンバーなら `password:<PasswordAccount.id>`。
- **フォローする人（follower）**：フォローした側。管理者かメンバー。持ち主IDで持つ。
- **フォローされる人（followee）**：フォローされた側。メンバーだけ。持ち主ID（`password:<id>`）で持つ。
- **共有中**：`LearningEntry.sharedAt` が `null` でない状態。

## データ

マイグレーション名は `add_follows_and_shared_notes`。

- `LearningEntry` に `sharedAt DateTime?` を追加する。共有を始めた時刻を入れ、やめると `null` に戻す。
- `LearningEntry` に `@@index([ownerId, sharedAt])` を追加する（タイムラインのため）。
- `Follow` テーブルを追加する。

```prisma
// One-way follow. Admins have no row in the database, so neither column has a
// foreign key: the use cases check that the followee is an existing member.
model Follow {
  followerId String
  followeeId String
  createdAt  DateTime @default(now())

  @@id([followerId, followeeId])
  @@index([followeeId])
}
```

- null 許可の列とテーブルを足すだけなので、既存のノートはすべて「共有しない」のまま残る。
- 本番 Neon へのマイグレーションは、いつもどおり main へのマージ前に適用する。

## ゴミ箱との関係

- ゴミ箱に入れても `sharedAt` は消さない。ゴミ箱のノートはタイムラインに出ない（`deletedAt: null` で絞る）。
- ゴミ箱から元に戻すと、共有中だったノートはそのまま共有中に戻る。
- 完全に削除すると行ごと消えるので、タイムラインからも消える。

## ドメインとリポジトリ（`packages/core`）

### `FollowRepository`（新規、`domain/social/repositories/follow-repository.ts`）

```ts
export interface FollowRepository {
  // Already following is not an error: the pair stays as it was.
  follow(followerId: string, followeeId: string): Promise<void>;
  // Returns false when there was nothing to remove.
  unfollow(followerId: string, followeeId: string): Promise<boolean>;
  listFollowing(followerId: string): Promise<string[]>;
  listFollowers(followeeId: string): Promise<string[]>;
}
```

### `LearningEntryRepository` への追加

- `setShared(ownerId, id, shared): Promise<boolean>`：`{ id, ownerId, deletedAt: null }` の行の `sharedAt` を、`shared` なら今の時刻、そうでなければ `null` にする。対象の行がなければ `false`。すでに共有中のノートをもう一度共有しても `sharedAt` は変えず、`true` を返す（共有するときは `sharedAt: null` の行だけを更新し、更新が0件なら対象の行があるかを数え直す）。
- `listSharedByOwners(ownerIds, limit): Promise<SharedLearningEntry[]>`：`{ ownerId: { in: ownerIds }, sharedAt: { not: null }, deletedAt: null }` の行を `createdAt` の新しい順に `limit` 件返す。`ownerIds` が空なら DB を読まずに空配列を返す。
- `LearningEntry` 型に `sharedAt: Date | null` を足す。既存の読み出しはすべてこの値を返す。

```ts
export type SharedLearningEntry = LearningEntry & { ownerId: string };
```

### use case（`application/social/use-cases/`）

- `FollowMember.execute(followerId, followeeId)`：結果は `"followed" | "self" | "not-found"`。
  - `followeeId === followerId` なら `"self"`。
  - `followeeId` が `password:<id>` の形でない、またはその `PasswordAccount` がないなら `"not-found"`。
  - それ以外はフォローして `"followed"`。
- `UnfollowMember.execute(followerId, followeeId)`：`FollowRepository.unfollow` の結果を返す。
- `ListFollowDirectory.execute(viewerId)`：
  - メンバー全員（`PasswordAccountRepository` の一覧）から自分を除き、表示名の順に並べる。
  - 各行は `{ ownerId, displayName, loginId, following: boolean, followsMe: boolean }`。
  - あわせて `followingCount`（フォロー中の人数）と `followerCount`（フォロワーの人数。管理者も含む）を返す。
  - `followingCount` は今いるメンバーだけを数える。
- `ListFollowTimeline.execute(viewerId, limit = 100)`：
  - フォロー中の持ち主IDを読み、`listSharedByOwners` で共有ノートを取る。
  - 各ノートに持ち主の表示名を付けて返す（`{ entry, ownerName }`）。表示名が見つからない持ち主のノートは出さない。

### 共有の切り替え（`application/learning/use-cases/share-learning-entry.ts`）

- `ShareLearningEntry.execute(ownerId, id, shared)`：`setShared` を呼ぶ。

## 権限

- `/follow` と、フォロー・共有の Server Action は、`getCurrentMemberUser`（管理者かメンバー）で利用者を読む。
- フォームは持ち主を受け取らない。フォローする人と共有するノートの持ち主は、常にログイン中の利用者。
- 共有の切り替えはメンバーだけ（`user.role === "member"`）。管理者はフォローされないので、ボタンを出さず、Server Action でも拒否する。
- `followeeId` はフォームから受け取るので、`FollowMember` で必ず存在するメンバーか確かめる。

## 画面

### ヘッダー（`AuthControls`）

- 管理者とメンバーのとき、「パスワード変更」と「アカウント管理」の前に［フォロー］（`/follow` へのリンク、`UsersRound` アイコン）を出す。

### `/follow`（`src/app/follow/page.tsx`）

アクセスの扱いは `/logs/trash` と同じ。

- ログインしていない：`/signin?callbackUrl=/follow` へ。
- ゲスト：`/` へ。
- 再ログインが必要（`githubId` がない古いセッション）：`ReauthNotice` を出す。

上から次の順に並べる。

1. 見出し「フォロー」と、「フォロー中 N人・フォロワー N人」。
2. **メンバー**：一覧。各行に「表示名（ログインID）」、自分をフォローしていれば「フォローされています」バッジ、右に［フォローする］か［フォロー解除］。メンバーがいなければ「ほかのメンバーはいません。」
3. **フォロー中の人の共有ノート**：タイムライン。各ノートの上に「〇〇さん・登録日時」を出し、既存の `LearningEntryCard` で表示する。ノートがなければ「共有されたノートはまだありません。」
   - カードから詳細ページへのリンクは出さない。詳細ページは持ち主と管理者だけが開ける。

ボタンは既存の `NoteActionForm` と同じく、`useActionState` を使う小さなフォームにする。失敗したときはボタンの下にメッセージを出す。

### 学習ノートの詳細（`/logs/年/月/日/番号`）

- メンバーが自分のノートを見ているとき（`owner.kind === "self"` かつメンバー）、「ゴミ箱に入れる」の左に［共有する］か［共有をやめる］を出す。
- 共有中なら、カードの上に「共有中（フォロワーが見られます）」バッジを出す。

## Server Action（`src/presentation/actions/follow-actions.ts`、`share-actions.ts`）

- `followMemberAction`／`unfollowMemberAction`：フォームの `followeeId` を受け取る。成功したら `/follow` を revalidate する。
- `shareLearningEntryAction`：フォームの `id` と `shared`（`"true"`／`"false"`）を受け取る。成功したら `/follow` と `/logs`（layout）を revalidate する。
- 入力の検証とエラーの扱いは `note-trash-controller` に揃え、コントローラー（`follow-controller.ts`）に置く。
  - ログインし直しが必要：「ログインし直してください。」
  - 相手やノートが見つからない：「見つかりませんでした。画面を更新してください。」
  - 自分自身をフォロー：「自分はフォローできません。」
  - それ以外の失敗：「処理できませんでした。時間をおいてもう一度お試しください。」ログには固定のコード（`FOLLOW_FAILED`、`SHARE_FAILED`）だけを出し、名前やノートの本文は出さない。

## テスト

### 単体テスト（`packages/core/tests/follow.test.ts`、`tests/follow-controller.test.ts`）

- 自分自身へのフォローは `"self"` になり、何も保存しない。
- 存在しないメンバーや、`password:` で始まらない ID へのフォローは `"not-found"`。
- 同じ人を2回フォローしても1件のまま。
- ディレクトリに自分が出ず、`following` と `followsMe` が正しい。フォロワー数に管理者も入る。
- タイムラインには、フォロー中の人の共有中でゴミ箱にないノートだけが出る。
- 共有の切り替えで、他人のノートの ID を渡しても `false` になる。
- コントローラーが、ログインしていない・不正な ID・失敗をそれぞれのメッセージにする。

### E2E（`e2e/follow.spec.ts`）

- メンバー A が学習ノートを1件共有し、もう1件は共有しない。メンバー B が A をフォローすると、B の `/follow` に共有したノートだけが出る。
- A の `/follow` で B の行に「フォローされています」と出る。
- B がフォロー解除すると、タイムラインから消える。
- A が共有をやめると、B のタイムラインから消える。
- ゲストのヘッダーに「フォロー」が出ず、`/follow` を開くと `/` に戻る。
- 管理者のヘッダーに「フォロー」が出て、メンバーをフォローできる。

## ドキュメント

- README に「フォローと学習ノートの共有」の節を足す。だれが何を見られるか、管理者がフォローされない理由を書く。
- 「学習ノートと会話ノートの公開範囲」に、フォロワーは共有中の学習ノートを読めることを1行足す。
- 本番 DB へのマイグレーション手順を、パスワードアカウントの節と同じ形で書く。

## やらないこと

- 会話ノートの共有。
- 人ごとの共有ノートのページ（`/follow/<人>`）。
- フォローの承認、ブロック、通知。
- 管理者をフォローできるようにすること（管理者を DB に持つ変更が要る）。
- タイムラインのページ送り（最新100件だけ）。
