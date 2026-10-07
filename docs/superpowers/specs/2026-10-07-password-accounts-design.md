# ID・パスワードでログインする member アカウント

## 目的と承認済みの要件

GitHubログイン（管理者）とゲストログインは残したまま、DBに保存したIDとパスワードでログインできるアカウントを12個程度用意する。ログインした人は管理者のOpenAIキーを使って、管理者と同じように添削・会話・記録の保存ができる。

- ロールは新しく `member` を設ける。権限を失ったセッションのロールは `revoked`（#57 で `user` から改名済み）。
- アカウントはGitHub管理者だけが管理画面で作成・パスワード再設定する。削除機能と表示名の編集は作らない。
- パスワードは管理者が入力しても、空欄にして自動生成してもよい。member は自分でパスワードを変更できる。
- 会話履歴はアカウントごとに分ける。共有ノート（学習ログ）は全員で共有する。

## ロールと権限

`AppRole` を `"admin" | "member" | "guest" | "revoked"` にする。

| 機能                                                            | admin         | member        | guest |
| --------------------------------------------------------------- | ------------- | ------------- | ----- |
| 共有ノート・日付別ログの閲覧、自分のAPIキーでの添削             | ○             | ○             | ○     |
| 管理者用ChatGPT（`/chat`、`/api/chat`）                         | ○             | ○             | ×     |
| 会話の保存・閲覧（`/conversations`、`/api/chat/conversations`） | ○（自分の分） | ○（自分の分） | ×     |
| CSVインポート                                                   | ○             | ○             | ×     |
| 連携エクスポート（`/integrations`）                             | ○             | ○             | ×     |
| アカウント管理（`/admin/accounts`）                             | ○             | ×             | ×     |
| 自分のパスワード変更（`/account/password`）                     | －            | ○             | －    |

- `admin` は今と同じく、`AUTH_ALLOWED_GITHUB_LOGINS` に入っているGitHubログインだけ。
- `packages/core` に `RequireMemberUser`（admin か member を通す）を追加する。上の表で member に ○ がついた4機能では、`getCurrentAdminUser` と `role !== "admin"` のチェックをこれに置き換える。トップページで管理者向けの部分を出し分ける判定も同じにする。
- `RequireAdminUser` はアカウント管理だけで使う。`RequireViewerUser` は member も通す。
- proxy の `authorized` コールバックは member も通す。DBは見ない（取り消しは後述）。
- LINE連携は、もともと特定のLINEユーザー1人に結びついているので変更しない。

## データ

Prismaに `PasswordAccount` テーブルを追加する。既存のテーブルは変更しない。

| 列                        | 型               | 内容                                                                                          |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `id`                      | String（cuid）   | アプリ内の固定ID。会話の所有者IDに使う                                                        |
| `loginId`                 | String（unique） | ログインID。保存前に前後の空白を除いて小文字にする。英小文字・数字・`-`・`_`・`.` の3〜32文字 |
| `displayName`             | String           | ヘッダーなどに出す名前。1〜50文字                                                             |
| `passwordHash`            | String           | scryptのハッシュ（後述）                                                                      |
| `sessionVersion`          | Int（初期値 0）  | パスワードを再設定・変更するたびに+1                                                          |
| `failedAttempts`          | Int（初期値 0）  | 続けて失敗した回数                                                                            |
| `lockedUntil`             | DateTime?        | ロックが切れる日時                                                                            |
| `createdAt` / `updatedAt` | DateTime         | 作成・更新日時                                                                                |

会話の所有者IDは `password:<id>` とする。数字だけのGitHub IDと重ならない。`ChatConversation.ownerId` はただの文字列なので、スキーマの変更はいらない。

## パスワードの扱い

- ハッシュには `node:crypto` の scrypt を使う（依存パッケージは増やさない）。パラメータは N=2^15、r=8、p=1、16バイトの salt、64バイトの出力。このパラメータは Node の既定のメモリ上限（32MiB）にちょうど達するので、`maxmem` を 64MiB に指定する。
- 保存形式は `scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>`。パラメータを一緒に保存しておくので、あとから強度を上げても古いハッシュを検証できる。
- 検証は `timingSafeEqual` で比べる。
- 入力されたパスワードは12〜128文字とする。上限は、長すぎる入力でscryptの計算に時間がかかりすぎるのを防ぐため。
- 自動生成するパスワードは `randomBytes(15)` を base64url にした20文字とする。

## ログイン

Auth.js に `Credentials({ id: "password" })` を追加する。項目は `loginId` と `password`。`authorize` の処理は次のとおり。

1. zodで入力を検証する。形式が正しくなければ失敗にする。
2. `loginId` を小文字にしてアカウントを探す。存在しなくても、ダミーのハッシュに対してscryptを1回計算してから失敗を返す。応答時間でIDの有無がわからないようにするため。
3. `lockedUntil` が現在より後なら失敗にする（パスワードの検証はしない）。
4. パスワードが違えば `failedAttempts` を+1する。5回に達したら `lockedUntil` を15分後にし、回数を0に戻す。
5. 合っていれば `failedAttempts` を0、`lockedUntil` を null に戻す。そして `{ id, name: displayName, role: "member", githubLogin: loginId, accountId, sessionVersion }` を返す。

`signIn` コールバックでは `password` プロバイダーで `role === "member"` のときだけ通す。失敗の理由がどれでも、ログイン画面の表示は「IDまたはパスワードが違うか、一時的にロックされています。」の1種類にする（`CredentialsSignin`）。

JWT に `accountId` と `sessionVersion` を入れる。`githubId` には `password:<id>` を入れる。今の `AuthenticatedUser`（`githubLogin`・`githubId`）の形を変えずに、会話の保存先をアカウントごとに分けるため。フィールド名を中立なものに変えるのは、この作業には含めない。`githubIdFromToken` は数字だけのIDに加えて、`password:` に cuid が続く形も通すようにする。

`AuthenticatedUser` には `displayName?` を追加し、ヘッダーで member は表示名を出す。

## 取り消し

- `resolveSessionRole` は `member` をそのまま通す。
- `AuthJsCurrentUserProvider.getCurrentUser` では、member のときにDBでアカウントを読む。アカウントが存在しない場合や、`sessionVersion` が JWT の値と違う場合は `role: "revoked"` を返す。ページ・API・Server Actionはすべてこの処理を通るので、パスワードを変えた時点で古いセッションは何もできなくなる。
- proxy はJWTだけで判断する。リクエストごとのDBアクセスを増やさないため。取り消されたセッションでも proxy は通るが、各ページは今と同じく未ログインとして扱う。

## アカウント管理画面 `/admin/accounts`

- `RequireAdminUser` で守る。admin 以外はトップへ戻す。
- 一覧（作成日の昇順）：ログインID、表示名、作成日、ロック中かどうか。
- 作成フォーム：ログインID、表示名、パスワード（任意）。
  - パスワードが空欄なら自動生成する。
  - 作成した直後に、ログインIDとパスワードを1回だけ表示する。Server Actionの戻り値として返し、DBやログには平文を残さない。
  - ログインIDが重複していたらエラーを表示する。
- 各アカウントの「パスワード再設定」：パスワード（任意、空欄なら自動生成）。
  - 再設定すると `sessionVersion` を+1し、`failedAttempts` を0、`lockedUntil` を null に戻す。
  - 新しいパスワードを1回だけ表示する。
- ヘッダーに、admin だけに見える「アカウント管理」のリンクを置く。

## パスワード変更 `/account/password`

- member だけが使える。それ以外はトップへ戻す。
- 入力は、今のパスワード、新しいパスワード、確認用の再入力の3つ。
- 今のパスワードはログインと同じロックの仕組みで検証する（失敗回数を数え、ロック中は変更できない）。
- 成功したら `sessionVersion` を+1して `signOut` し、`/signin?notice=password-changed` へ移る。ログイン画面では「パスワードを変更しました。新しいパスワードでログインしてください。」と表示する。
- ヘッダーの、member の表示名の近くに「パスワード変更」のリンクを置く。

## ログイン画面

- 「IDとパスワードでログイン」のフォーム（ログインID・パスワード）を追加する。今の GitHub ボタンとゲストのボタンは残す。
- `isAuthConfigured` は GitHub 用の判定として残す（GitHub ボタンを押せるかどうかと、OAuth 設定の案内にだけ使う）。ID/パスワードのフォームは `AUTH_SECRET` があれば常に表示する。
- 一番下の説明文に「IDとパスワードのアカウントは管理者が発行します」と書き足す。

## コードの分け方

今の domain / application / infrastructure / presentation の構成とアーキテクチャテストに合わせる。

- `packages/core/src/domain/identity/repositories/password-account-repository.ts`：`PasswordAccountRepository`（`findByLoginId`、`findById`、`list`、`create`、`recordFailure`、`clearFailures`、`setPassword`）
- `packages/core/src/domain/identity/entities/password-account.ts`：アカウントの型。ログインID・表示名・パスワードのルール（zod）と、ロックの判定（5回・15分）
- `packages/core/src/application/identity/ports/password-hasher.ts`：`PasswordHasher`（`hash`、`verify`、`generate`）
- `packages/core/src/application/identity/use-cases/`：`RequireMemberUser`、`AuthenticatePasswordAccount`、`CreatePasswordAccount`、`ResetPasswordAccountPassword`、`ChangeOwnPassword`、`ListPasswordAccounts`
- `src/infrastructure/auth/scrypt-password-hasher.ts`：scrypt での実装
- `src/infrastructure/persistence/prisma/repositories/prisma-password-account-repository.ts`：Prisma での実装。失敗回数の加算とロックは1回の更新で行い、同時に失敗しても数え漏れが出ないようにする
- `src/composition/identity-container.ts`：上の部品を組み立てる
- `src/presentation/actions/`：作成、再設定、パスワード変更、ID/パスワードでのログインの Server Action。各 Action の中で、もう一度ロールを確認する

## 検証とPR

- ユニットテスト
  - ハッシュの作成と検証（正しい値、違う値、壊れた形式）
  - パスワード・ログインIDのルール
  - ロック（5回目で15分ロック、ロック中は正しいパスワードでも失敗、成功で回数が0に戻る）
  - `sessionVersion` が違うときと、アカウントが存在しないときに `revoked` になること
  - member が admin 専用のユースケースを通らないこと
- E2E（Docker上のPostgres）
  - admin がアカウントを作り、表示されたパスワードでログインして `/chat` に入れる
  - member は `/admin/accounts` に入れない
  - パスワードを間違えるとエラーが出る
  - 再設定後、古いセッションでは `/chat` に入れない
  - 本人がパスワードを変えると、新しいパスワードでログインできる
  - member が保存した会話は admin から見えない
- `pnpm run test:regression` を通す。
- README に、member と管理画面の使い方を書く。
- ブランチは #57 がマージされてから、その上に積む。PRには、マージ前に Neon（本番DB）へ `prisma migrate deploy` を適用する手順を書く。この依頼では、マージと本番DBの更新は行わない。
