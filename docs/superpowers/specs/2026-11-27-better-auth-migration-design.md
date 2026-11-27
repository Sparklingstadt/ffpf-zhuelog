# Zhuelog のログインを Better Auth に替え、データの持ち主を Better Auth の user にそろえる

この文書は、Zhuelog（ffpf-zhuelog）の自前のログインとセッションを Better Auth に置き換え、学習データの持ち主（今の `ownerId` の文字列）を Better Auth の `user.id` への外部キーに替えるための設計です。

## 1. なぜ作るか

- 持ち主は、Sparklingstadt ID（ID サーバー）と typle-r を Better Auth にそろえる（ID サーバーは `sparklingstadt-id` の `claude/better-auth-migration` ブランチで作業中、typle-r はこれから）。Zhuelog も同じやり方にそろえたい。
- ID サーバーの側の移行だけなら、Zhuelog は何も変えなくても動く（ID サーバーの設計で `/oauth/*` の URL を残すと決めている）。今回の作業は「壊れるから直す」ではなく「そろえるため」。
- 持ち主の方針：**Better Auth のやり方にそろえ、自前の仕組みはなるべく足さない。** 迷ったら、Better Auth の本体とプラグインの既定の動きに寄せる。
- typle-r より先に移すので、Zhuelog での形が typle-r の手本にもなる。

## 2. 目標・目標でないもの・失敗とみなすもの

**目標**

- ログインとセッションを Better Auth 1.7 系（ID サーバーと同じ版、今は 1.7.28）で動かす。DB は今の Neon、Prisma アダプター（Prisma 7）。
- ログインの方法は次の 4 つにする。
  - 会員：ID（ログイン ID）とパスワード。`username` プラグイン。
  - Sparklingstadt ID（SID）：`genericOAuth` プラグイン。**管理者もここから入る。**
  - ゲスト：`anonymous` プラグイン。
  - デモ：パスワードの会員の 1 人として扱う。
- 管理者は `admin` プラグインの `role` で決める。
- 「会員として操作」は `admin` プラグインのなりすまし（impersonate）にする。
- 学習データの約 15 の表の `ownerId`（文字列）を、`user.id` を指す `userId`（外部キーつき）に替える。`password:`・`sid:`・GitHub の数字の ID という持ち主の形の区別をなくす。
- 会員のパスワードは変わらない（今の scrypt のハッシュをそのまま使う）。
- 会員・SID の会員・管理者の今のデータは、移行のあとも同じ人のものとして見える。

**目標でないもの（今回は作らない）**

- GitHub でのログイン（外す。管理者は SID で入る）。
- Zhuelog の中でのパスキーや二要素認証（ID サーバーの側で行う）。
- 会員のメールアドレス、メールでのパスワード再設定、会員が自分で登録すること（今もない）。
- typle-r の移行。
- iOS などのネイティブアプリ向けのトークン（今はない）。

**失敗とみなすもの（動いていても）**

- 移行のあとに、誰かのノート・単語帳・復習・練習の記録・会話ノート・質問ノート・フォロー・LINE の連携が、別の人のものになる、または見えなくなる。
- 会員がパスワードを変えないとログインできなくなる。
- 管理者以外が、管理画面やなりすましを使える。
- なりすまし中の操作で、管理者の LINE が会員に結び付く。
- 自前のセッション・トークン・試行回数の仕組みが、Better Auth と並んで残る（切り替えたあとに）。

## 3. 作り方（Approaches）

決めたことは 3 つある。どれも持ち主が選んだ。

**3.1 どのログインを残すか**

1. 5 つ（GitHub・ID とパスワード・SID・ゲスト・デモ）とも Better Auth に載せる。いちばん重く、GitHub の OAuth App も持ち続ける。
2. **管理者の入口を GitHub から SID に移し、ほかは残す（採用）。** 会員はログインの仕方が変わらず、管理者は ID サーバーのパスキーと二要素認証を使える。
3. SID・ゲスト・デモだけにする。会員全員に SID のアカウントを作ってもらう必要があり、外した。

**3.2 データの持ち主をどう持つか**

- A. Better Auth の `user` に今の `ownerId` の列を足し、データの表には触らない。小さく安全だが、ID が 2 つ並ぶ。
- **B. `ownerId` を `user.id` への外部キーにそろえる（採用）。** 持ち主は「Better Auth のやり方にそろえたい」として B を選んだ。移行は大きいが、持ち主の形の区別（`password:` など）と、それに頼るコードがなくなる。

**3.3 会員として操作**

- 今の自前の `zl_act_as` を、持ち主を `user.id` に替えて残す。
- **`admin` プラグインのなりすましにする（採用）。** 持ち主は「なりすましでよい。独自のものはなるべく追加しない」とした。書き込みを止める自前の仕組みも足さない。

## 4. 作るもの

### 4.1 Better Auth の構成

- `better-auth` を 1.7 系で入れる（ID サーバーと同じ版）。使うのは本体（セッション、レート制限）と、プラグインの `username`・`genericOAuth`・`anonymous`・`admin`、それに Next.js の `nextCookies`。
- ハンドラーは `src/app/api/auth/[...all]/route.ts`（Better Auth の Next.js での既定）。今の `/api/auth/callback/github/go` と `/api/auth/callback/sid` は消す。
- サーバー側の設定（`betterAuth({...})`）は `src/infrastructure/auth/` に置く。層の決まり（`tests/architecture.test.ts`）に「`better-auth` を import してよいのは `src/infrastructure/auth/` と、Better Auth のクライアントを使う画面の部品だけ」を足す（どこまで許すかは作る人が決める）。`next-auth` を禁じる決まりは残す。
- 環境変数：
  - 足す：`BETTER_AUTH_SECRET`。
  - `AUTH_URL` を Better Auth の `baseURL` に使う（名前を `BETTER_AUTH_URL` に替えるかは作る人が決める）。
  - 外す：`AUTH_GITHUB_ID`・`GITHUB_WEB_CLIENT_SECRET`・`AUTH_ALLOWED_GITHUB_IDS`。
  - `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET` は今のまま使う。
  - `DEMO_LOGIN_ID` は今のまま。デモのパスワードを `DEMO_PASSWORD` として足す（4.3）。

### 4.2 表

- Better Auth の表 `user`・`session`・`account`・`verification` と、プラグインが足す列（`username`・`displayUsername`・`isAnonymous`・`role`・`banned`・`banReason`・`banExpires`・`impersonatedBy`）を、Better Auth の CLI で作った Prisma のスキーマに合わせて足す。レート制限を DB に置く `rateLimit` の表も足す。
- 今の `Session` は、Prisma のモデル名が Better Auth の `session` とぶつかる（Postgres の表の名前は `"Session"` と `"session"` で別）。消す順と、移行のあいだの一時的なモデル名は作る人が決める。
- 切り替えのあとで消す表：`PasswordAccount`・`SidAccount`・`Session`（今のもの）・`SignInThrottle`・`FfpfAccount`（今はどこからも使っていない）。
- `user.name` は表示名。今の `displayName` を入れる。
- **会員にはメールアドレスがない。** Better Auth の `user.email` は必須で一意なので、会員には実在しない形のアドレス（例：`<loginId>@members.zhuelog.invalid`）を入れ、`emailVerified` は `false` にする。画面にも出さず、メールも送らない。形は作る人が決める（`.invalid` のドメインを使うこと）。

### 4.3 ログイン

**会員（ID とパスワード）**

- `username` プラグインの `signIn.username`。ログイン ID は `user.username`。今の規則 `^[a-z0-9._-]{3,32}$`（`src/domain/identity/password-account.ts`）を `usernameValidator` に渡し、`minUsernameLength: 3`・`maxUsernameLength: 32` にする。プラグインの既定（`^[a-zA-Z0-9_.]+$`、最大 30）はログインのときにも効くので、そのままだと `-` を含む ID や 31〜32 文字の ID の会員が入れなくなる。
- パスワードのハッシュは今の scrypt（`src/infrastructure/security/scrypt-password-hasher.ts`、N=2^15, r=8, p=1）を `emailAndPassword.password.hash`・`verify` に渡して使い続ける。`tests/fixtures/scrypt-golden.json` の検査も残す。ハッシュは `account` の行（`providerId: "credential"`）の `password` に置く。
- `emailAndPassword` は有効にするが、会員が自分で登録する道（`signUp`）は閉じる（`disableSignUp`）。会員を作るのは管理者だけ（4.4）。

**Sparklingstadt ID**

- `genericOAuth` で、`providerId: "sid"`、`discoveryUrl` は `${SID_ISSUER}/.well-known/openid-configuration`、`scopes: ["openid", "email", "profile"]`、PKCE あり。ID トークンの検証、`nonce`・`state` は Better Auth に任せる（今の `src/infrastructure/auth/sid-oidc-client.ts` と `jose` の自前の検証は消す。`jose` を他で使っていなければ依存からも外す）。
- 誰でも SID でログインできる（今と同じ）。初めてのログインで、Better Auth が `user` と `account` を作る。
- 今の Zhuelog は `email_verified !== true` の ID トークンを断っているが、genericOAuth は断らない。この確かめは持たない。ID サーバーはメールが未確認の人にコードを出さない（ID サーバーの設計の 4.2）ので、Zhuelog まで届かない。
- `account.accountLinking` の `trustedProviders` に `sid` は入れない（メールアドレスでのつなぎは使わない。管理者は 4.7 で `sub` で直接つなぐ）。
- `redirect_uri` は Better Auth の既定（`<AUTH_URL>/api/auth/oauth2/callback/sid`）になる。**ID サーバーに登録した Zhuelog のクライアントの redirect URI を、切り替えのときに足す（または替える）。** 今の `/api/auth/callback/sid` を残す必要はない。
- ログアウトは Better Auth の既定のまま：SID でログインした人の `signOut` は、discovery の `end_session_endpoint`（ID サーバーの `/oauth/logout`）へ送り、ID サーバーのログインも消す（今と同じ動き）。今の自前の `sid-logout.ts` は消す。ID サーバーに `post_logout_redirect_uri`（Better Auth が送る値）を登録する（4.7 の手順）。

**管理者**

- 管理者は SID でログインし、`user.role` が `admin` の人。許可リストの環境変数は使わない。
- 移行のときに管理者の `user` を作り、`role` を `admin` にし、SID のアカウントへのつなぎ方は 4.7 で決める。
- 管理者を増やす・外すのは、`admin` プラグインの `setRole`（今の画面には足さない。必要なら DB を直接）。

**ゲスト**

- `anonymous` プラグイン。ゲストはデータを持たず、練習だけ使える（今と同じ。ページの門番が `isAnonymous` を見る）。
- ゲストの `user` の行は残っていく。毎日のデモのリセット（`/api/cron/demo-reset`）で、作ってから 1 日を過ぎたゲストの `user` を消す（`session` は外部キーで一緒に消える）。今の「ゲストは 24 時間」に近づけるため（Claude の判断）。

**デモ**

- `DEMO_LOGIN_ID` の会員に、デモのボタンから入る。Server Action が `DEMO_PASSWORD` を使って `auth.api.signInUsername` を呼ぶ（パスワードなしで入る自前の道は作らない）。サーバーからの呼び出しはレート制限を通らないが、デモは今もパスワードなしで誰でも入れるので、守るものは変わらない。`DEMO_PASSWORD` はデモのリセットでも、その会員のパスワードとして入れ直す。
- デモの印（画面のバナー）は、今と同じく `username === DEMO_LOGIN_ID` で決める。今デモに禁じていること（AI の機能、LINE、フォロー、パスワードの変更。`authenticated-user.ts`）は、今のアプリの側の決まりのまま残す。
- Better Auth の HTTP の口からデモが壊されないようにする：`/update-user`（名前とログイン ID を変えられる）は `disabledPaths` で閉じ（今も会員が自分の名前や ID を変える画面はない）、デモの会員の `/change-password` は `hooks.before` で断る（デモのパスワードを変えると、ほかの人がその日デモに入れなくなるため）。
- `DEMO_LOGIN_ID` か `DEMO_PASSWORD` が無ければ、デモのボタンは出ず、`/api/cron/demo-reset` は 404（今と同じ）。

### 4.4 管理者の機能

- **会員の作成・一覧・パスワードの再設定**（`/admin/accounts`）：`admin` プラグインの `createUser`・`listUsers`・`setUserPassword` を使う。作成では `username` と表示名とパスワードを受け、メールは 4.2 の形で作る。再設定では、その会員のセッションをすべて消す（`revokeUserSessions`）。
- **なりすまし**：`admin` プラグインの `impersonateUser` と `stopImpersonating`。
  - なれるのは会員だけ。管理者になれないのはプラグインの既定のまま（`allowImpersonatingAdmins` は付けない）。ゲスト（`isAnonymous`）になるのは `hooks.before` で `impersonate-user` を断る。
  - なりすまし中は、会員としてログインしているのと同じ。管理者の機能（管理画面、AI の利用量）は、なりすましを終えるまで使えない。今は「管理者のまま持ち主だけ替える」なので、ここは動きが変わる（持ち主が承知の上）。
  - 今のバナー（`acting-banner.tsx`）は残し、`session.impersonatedBy` があるときに出し、「戻る」で `stopImpersonating` を呼ぶ。
  - **LINE の連携だけは、なりすまし中は使えないようにする**（`session.impersonatedBy` があれば、連携の画面と Server Action は今と同じく `/` に戻す）。管理者の LINE が会員に結び付くのを防ぐためで、持ち主の「独自のものは足さない」の例外として残す（失敗とみなすもの）。
  - なりすましのセッションの長さは、プラグインの既定（1 時間）。
- **AI の利用量**（`/admin/ai-usage`）：表の `userId` と `user.name` で集計する。なりすまし中の利用は、会員の利用として数える（今は管理者に数える。動きが変わる）。

### 4.5 セッション・失効・試行回数

- **Cookie**：Better Auth の既定（`better-auth.session_token`）。今の `zl_session`・`zl_act_as`、Go の時代の `zl_access`・`zl_refresh` は使わなくなる。切り替えのあと最初のアクセスで消すかは作る人が決める（残っていても読まない）。
- **期限**：`expiresIn` は 30 日（今と同じ長さ）。使うと延びる（Better Auth の既定の `updateAge`）。今の「延びない」は持たない。
- **ページの門番（Proxy）**：`src/proxy.ts` は、`better-auth/cookies` の `getSessionCookie` で Cookie があるかだけを見る（今と同じく DB は読まない）。
- **毎回の確かめ**：各ページ・Server Action・Route Handler は `auth.api.getSession({ headers })` でログイン中の人を決める。`src/composition/current-user.ts` の形（ページから見た「今の人」）は残し、中身だけ替える。`role`（`admin`・会員・ゲスト）は `user.role` と `user.isAnonymous` から決め、`banned` の人は通さない。
- **パスワードの変更**：会員が自分で変えるときは `changePassword` に `revokeOtherSessions: true`。今の `sessionVersion` はなくなる。
- **全員のログアウト**：`DELETE FROM "session"`（`deployment.md` の運用上の注意を書き換える）。
- **ログインは HTTP の口を通す**：Better Auth のレート制限は `/api/auth/*` への HTTP のリクエストにだけ効き、サーバーから `auth.api.*` を呼ぶと通らない。そのため、会員・SID・ゲストのログインは、画面から Better Auth のクライアント（`createAuthClient`）で `/api/auth/*` を呼ぶ。サーバーから呼んでよいのはデモ（4.3）と、管理者の機能（4.4）と、`getSession` などの読むだけのものに限る。
- **試行回数**：Better Auth のレート制限だけにする。保存先は DB（`rateLimit` の表。Vercel のサーバーレスで効くように）。ログインのパスに、今と同じくらいの強さ（15 分の窓）の `customRules` を付ける。接続元の IP は、今の `client-address.ts` と同じ規則でヘッダーを読むよう `advanced.ipAddress` を設定する。**今の「接続元とログイン ID の組」で数える自前の制限（`SignInThrottle`）は持たない**（Claude の判断。5 を見ること）。

### 4.6 データの持ち主

- 次の表の `ownerId` を `userId`（`user.id` への外部キー、`onDelete: Cascade`）に替える：`LearningEntry`・`ChatConversation`・`PrepositionPracticeRecord`・`QuickQuestion`・`ComplementPracticeRecord`・`ReviewItem`・`ReviewLog`・`VocabularyEntry`・`AiUsage`・`LineLink`・`LineLinkCode`・`LineMessage`。`Follow` の `followerId`・`followeeId` も `user.id` への外部キーにする。今ある索引と一意の制約は、列の名前を替えて同じものを保つ。
- 列の名前を `userId` に替えるか、`ownerId` のまま外部キーだけ付けるかは作る人が決める（Better Auth のプラグインの表は `userId` なので、`userId` がおすすめ）。コードの中の「owner」という言葉をどこまで替えるかも作る人が決める。
- `LineLink`・`LineLinkCode` の `role` の列は消し、`user.role` から読む。
- 持ち主の頭の文字（`password:`・`sid:`）で区別しているコードはすべてなくす：`src/domain/identity/owner-id.ts`、`line-link-store.ts`、`social-store.ts`、`ai-usage-store.ts`、`demo-reset-store.ts`、`sign-in.ts`、`own-password.ts`、`session-current-user-provider.ts`、`acting-actions.ts` など。会員の一覧（フォロー、AI の利用量）は、`user` の表を `role` と `isAnonymous` で絞って読む。
- フォローできる相手は今と同じく会員だけ（管理者とゲストは出さない）。
- 外部キーにより、`user` を消すとその人のデータも消える。今は会員を消す画面はないので、動きは変わらない。

### 4.7 移行（切り替え）

1 回のデプロイで切り替える。切り替えでは全員が一度ログアウトになる（持ち主が承知、ID サーバーと同じ判断）。

**データの対応**

| 今                                                     | 切り替えのあと                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PasswordAccount`（`ownerId` は `password:<id>`）      | `user`（`id` は今の `PasswordAccount.id`、`username` は `loginId`、`name` は `displayName`、`role` は `user`）と `account`（`providerId: "credential"`、`password` はハッシュそのまま） |
| `SidAccount`（`ownerId` は `sid:<sub>`）               | `user`（`id` は新しく作る、`email` は今の `email`、`emailVerified` は `true`、`name` は `displayName`）と `account`（`providerId: "sid"`、`accountId` は `sub`）                        |
| 管理者（`ownerId` は GitHub の数字の ID、DB に行なし） | `user`（`role` は `admin`）。SID とのつなぎ方は下                                                                                                                                       |
| データの表の `ownerId`                                 | 上の対応で `userId` に書き換える                                                                                                                                                        |

- 対応の付かない `ownerId`（消えた会員のデータなど）が見つかったら、移行は止まる（外部キーを付ける前に数えて、1 つでもあれば失敗させる）。黙って消さない。
- 移行は、Prisma のマイグレーション（SQL）と、切り替えのときに 1 度だけ動かすスクリプト（ID サーバーの `scripts/import-clients.ts` と同じ考え方）で行う。どこまでを SQL にし、どこからをスクリプトにするかは作る人が決める。

**管理者を SID につなぐ**

- 本番で GitHub の数字の ID を持ち主とするデータは、持ち主 1 人ぶんだけ（持ち主に確認済み）。スクリプトが受ける GitHub の ID は 1 つでよい。それ以外の数字の `ownerId` が見つかったら、上の決まりどおり移行は止まる（手元や e2e の `"0"` などは、それぞれの環境で作り直す）。
- 管理者は、今は SID でログインしたことがない（持ち主に確認済み）。そのため、`SidAccount` に管理者の行はなく、データをまとめる問題は起きない。
- 移行のスクリプトは、管理者の GitHub の数字の ID、管理者の SID の `sub`、SID のメールアドレスと表示名を引数で受け、`user`（`role: admin`、`emailVerified: true`）と `account`（`providerId: "sid"`、`accountId` はその `sub`）を作り、GitHub の ID を持ち主とするデータをその `user.id` に書き換える。
- `sub` で直接つなぐので、管理者が初めて SID でログインすると、そのままこの `user` に入る。メールアドレスでのつなぎは使わない（ID サーバーが管理者のメールアドレスを名乗る人を通してしまうと、その人が管理者になるため）。

**手順（`deployment.md` の「移行の記録」に残す）**

1. ID サーバーに、Zhuelog の新しい redirect URI と `post_logout_redirect_uri` を足す。
2. Vercel に `BETTER_AUTH_SECRET`・`DEMO_PASSWORD` を入れる。
3. デプロイ（マイグレーションが動く）と、移行のスクリプト。
4. 管理者が SID でログインし、管理画面が使えることを確かめる。会員の 1 人でログインし、ノートが見えることを確かめる。
5. GitHub の OAuth App と、外した環境変数を消す。

### 4.8 画面

- `/signin`：「ID とパスワード」「Sparklingstadt ID でログイン」「ゲスト」「デモ」。GitHub のボタンは消す。管理者向けの説明は「管理者は Sparklingstadt ID でログイン」に替える。
- 呼び出しは Server Action から `auth.api.*` を呼ぶ形でも、Better Auth のクライアント（`createAuthClient`）を使う形でもよい（作る人が決める。今の画面は Server Action とフォームなので、それに合わせるのが自然）。
- エラーの文言は今の日本語の文言を保つ（Better Auth の英語のエラーをそのまま出さない）。

### 4.9 テスト

- 単体：ログインまわりの自前のコード（セッション、トークン、Cookie、試行回数、OIDC の検証）のテストは、コードと一緒に消す。残る自前の部分（scrypt のハッシュ、`current-user` の役割の決め方、なりすまし中の LINE の禁止、移行の対応表）にテストを付ける。
- e2e：会員・SID（ID サーバーのスタブ）・ゲスト・デモのログイン、管理者の会員作成とパスワード再設定（再設定で会員のほかの端末がログアウトになる）、なりすましと戻る、なりすまし中の LINE の禁止、パスワード変更でほかの端末がログアウトになる。
- 移行：今の形のデータを入れた DB に移行をかけ、全部の表で持ち主が正しく付け替わること、対応の付かない `ownerId` があると止まることを確かめる。
- `docs/architecture.md` の「4. 認証」と、`.env.example`・`docs/deployment.md` を書き換える。

## 5. Claude の判断（持ち主が確かめるもの）

持ち主が決めたのは 3 の 3 つと、「自前の仕組みはなるべく足さない」。次は、その方針から Claude が決めた。

- **管理者は `sub` で直接つなぐ**（4.7）。メールアドレスでのつなぎより安全なため。
- **SID の `email_verified` を Zhuelog では確かめない**（4.3）。ID サーバーが未確認の人にコードを出さないことに頼る。
- **ログインは画面から Better Auth のクライアントで行う**（4.5）。レート制限を効かせるため。
- **デモを守る設定**（4.3）：`/update-user` を閉じ、デモのパスワード変更を断る。足す自前のコードは、この hook となりすましの 2 つ（下）。
- **試行回数は IP ごとだけ**（4.5）。今の「接続元とログイン ID の組」の制限をやめる。多くの IP から 1 人の会員のパスワードを当てにくる攻撃には弱くなる。
- **セッションが使うと延びる**（4.5）。今は 30 日で必ず切れる。
- **ゲストは毎日のリセットで消す**（4.3）。今のゲストは 24 時間で切れる。
- **なりすまし中も LINE の連携だけは止め、ゲストにはなりすませないようにする**（4.4）。
- **会員の偽のメールアドレス**（4.2）。Better Auth が `email` を必須にしているため。

## 6. 作る人に任せること

- PR の分け方（本番への切り替えは 1 回のデプロイ。その前に、本番に影響しない準備の PR を分けてよい）。
- `ownerId` から `userId` への名前の替え方の範囲（4.6）。
- 移行の SQL とスクリプトの分け方（4.7）。
- Better Auth のサーバーの API とクライアントの使い分け（4.8）。
- Better Auth のスキーマの生成の仕方（CLI で作るか手で書くか）。表と列の名前は Better Auth の既定に合わせる。
- このリポジトリの Next.js は学習データと違う版なので、作る前に `node_modules/next/dist/docs/` を読むこと（`AGENTS.md`）。
