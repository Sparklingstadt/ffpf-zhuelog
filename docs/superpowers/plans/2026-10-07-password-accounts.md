# ID・パスワードの member アカウント 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub管理者とゲストに加えて、DBに保存したIDとパスワードでログインする `member` ロールと、その管理画面・本人のパスワード変更を追加する。

**Architecture:** ロールの判定とアカウントのルール（ID・パスワードの形式、ロック）は `packages/core` の domain / application に置き、scrypt と Prisma の実装は `src/infrastructure` に置く。Auth.js には Credentials プロバイダー `password` を足し、セッションの取り消しは `AuthJsCurrentUserProvider` で毎回DBの `sessionVersion` を照合して行う（proxy はDBを見ない）。

**Tech Stack:** Next.js 16.3.8、Auth.js v5 (next-auth 5.0.0-beta.32)、Prisma 7 + PostgreSQL、zod 4、`node:crypto` scrypt、node:test + tsx、Playwright。

**Spec:** ../specs/2026-10-07-password-accounts-design.md

## Global Constraints

- ブランチは #57（`user` → `revoked`）がマージされた main の上に作る。実装前に `AppRole` が `"admin" | "guest" | "revoked"` であることを確認する。
- 依存パッケージは追加しない（scrypt は `node:crypto`）。
- scrypt: N=2^15、r=8、p=1、salt 16バイト、出力 64バイト、`maxmem` 64MiB。保存形式 `scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>`。
- ログインID: 前後の空白を除いて小文字化し、`/^[a-z0-9._-]{3,32}$/`。表示名: 前後の空白を除いて1〜50文字。パスワード: 12〜128文字。
- 自動生成パスワード: `randomBytes(15).toString("base64url")`（20文字）。
- ロック: 続けて5回失敗したら15分。成功・再設定・本人の変更で0に戻す。
- 会話の所有者ID: `password:<PasswordAccount.id>`。
- ログイン失敗の表示は1種類だけ：「IDまたはパスワードが違うか、一時的にロックされています。」
- 平文パスワードをDB・ログ・URLに残さない。自動生成したものは Server Action の戻り値で1回だけ画面に返す。
- 本番DB（Neon）へのマイグレーションとマージはこの作業では行わない。PR本文に手順を書く。

## Review Focus

1. **ログインIDの大文字・空白**：`" Taro "` で作ったアカウントに `"taro"` でも `"TARO"` でもログインできる → Task 2 のスキーマのテストと、Task 3 の `AuthenticatePasswordAccount` のテストで固定する。
2. **今あるGitHub管理者のJWT**（`accountId` も `sessionVersion` も持たない）が、DB照合のせいで締め出されない → Task 5 の `isCurrentMemberSession` のテストで、admin・guest はDBを見ずに通ることを固定する。
3. **空白だけのパスワード欄**：作成・再設定でパスワード欄が空白だけのときは、未入力として自動生成する（12文字以上の空白をパスワードとして受け付けない）→ Task 3 のテストで固定する。
4. **ロック中に正しいパスワードを入れた場合**：ログインできず、ロックも解除されない。本人のパスワード変更画面でも同じ → Task 3 のテストで固定する。
5. **同時に何回も失敗した場合**：失敗回数の加算はSQL1文の原子的な更新で行い、数え漏れが出ない → Task 4 の `recordFailure` は1文の `UPDATE` にする。E2E（Task 9）では5回失敗したあと、正しいパスワードでもログインできないことを確認する。

---

### Task 1: member ロールと権限チェックの置き換え

**Files:**

- Modify: `packages/core/src/domain/identity/entities/authenticated-user.ts`
- Create: `packages/core/src/application/identity/use-cases/require-member-user.ts`
- Modify: `packages/core/src/application/identity/use-cases/require-viewer-user.ts`
- Modify: `src/infrastructure/auth/session-role-policy.ts`
- Modify: `src/infrastructure/auth/authjs-config.ts`（`authorized` コールバック）
- Modify: `src/composition/identity-container.ts`（`getCurrentMemberUser` を追加）
- Modify（admin → member へ置き換え）: `src/app/chat/page.tsx`、`src/app/conversations/page.tsx`、`src/app/conversations/[year]/[month]/[day]/page.tsx`、`src/app/conversations/[year]/[month]/[day]/[number]/page.tsx`、`src/app/api/chat/route.ts`、`src/app/api/integrations/[id]/export/route.ts`、`src/app/integrations/[id]/page.tsx`、`src/presentation/actions/import-learning-csv-action.ts`、`src/presentation/controllers/conversation-controller.ts`、`src/app/page.tsx`（`user.role === "admin"` の2箇所）
- Test: `packages/core/tests/identity-roles.test.ts`（新規）、`tests/security.test.ts`、`tests/chat-conversation-api.test.ts`

**Interfaces:**

- Produces:
  - `AppRole = "admin" | "member" | "guest" | "revoked"`
  - `AuthenticatedUser = { githubLogin: string; githubId?: string; role: AppRole; displayName?: string; accountId?: string }`
  - `class RequireMemberUser { constructor(p: CurrentUserProvider); execute(): Promise<AuthenticatedUser | null> }`：admin か member なら返す
  - `getCurrentMemberUser(): Promise<AuthenticatedUser | null>`（identity-container）
  - `isMemberRole(role: AppRole): boolean`（`authenticated-user.ts` に置く。`role === "admin" || role === "member"`）

- [ ] **Step 1: 失敗するテストを書く** `packages/core/tests/identity-roles.test.ts`

```ts
test("member-level use case admits admin and member only", async () => {
  for (const [role, admitted] of [
    ["admin", true],
    ["member", true],
    ["guest", false],
    ["revoked", false],
  ] as const)
    assert.equal(
      Boolean(await new RequireMemberUser(provider(role)).execute()),
      admitted,
      role,
    );
});
test("viewer admits admin, member and guest" /* revoked と null だけ null */);
test("admin use case rejects member" /* RequireAdminUser(member) === null */);
```

`tests/security.test.ts` の `resolveSessionRole` テストに追加: `assert.equal(resolveSessionRole("member", "taro", ""), "member")`。
`tests/chat-conversation-api.test.ts` に追加: `{ githubLogin: "taro", githubId: "password:ckxxxxxxxxxxxxxxxxxxxxxxx", role: "member" }` で保存が200になり、repository が受け取る owner が `"password:ck…"` であること。guest は従来どおり403。

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test packages/core/tests/identity-roles.test.ts tests/security.test.ts tests/chat-conversation-api.test.ts` → FAIL（`require-member-user` が存在しない、member の型エラー）

- [ ] **Step 3: 実装する**
  - `resolveSessionRole`: `if (role === "member") return "member";` を guest の判定の次に置く（取り消しは Task 5 でDBを照合して行う）。
  - `authorized`: `permitted` の条件に `session?.user.role === "member"` を足す。
  - 置き換え対象の各ファイルで、`getCurrentAdminUser` は `getCurrentMemberUser` に、`role !== "admin"` / `=== "admin"` は `isMemberRole(...)` にする。メッセージはこう変える。
    - `src/app/api/chat/route.ts`: 「ゲストはChatGPTを利用できません。」はそのまま。
    - `conversation-controller.ts`: 「管理者のみ利用できます。」→「ゲストは利用できません。」。`githubId` がないときのメッセージ「一度ログアウトしてGitHubでログインし直してください。」→「一度ログアウトしてログインし直してください。」
  - `getCurrentAdminUser` は残す（Task 7 の管理画面で使う）。

- [ ] **Step 4: 通ることを確認する** 同じコマンドで PASS。続けて `pnpm run typecheck && pnpm run lint`。

- [ ] **Step 5: コミットする** `feat: member ロールを追加し、管理者向け機能を member にも開く`

---

### Task 2: PasswordAccount のドメイン（ルール・リポジトリ・ハッシュのポート）

**Files:**

- Create: `packages/core/src/domain/identity/entities/password-account.ts`
- Create: `packages/core/src/domain/identity/repositories/password-account-repository.ts`
- Create: `packages/core/src/domain/identity/password-account-error.ts`
- Create: `packages/core/src/application/identity/ports/password-hasher.ts`
- Test: `packages/core/tests/password-account.test.ts`

**Interfaces:**

- Produces（`password-account.ts`）:
  - `type PasswordAccount = { id: string; loginId: string; displayName: string; passwordHash: string; sessionVersion: number; failedAttempts: number; lockedUntil: Date | null; createdAt: Date }`
  - `type PasswordAccountSummary = { id: string; loginId: string; displayName: string; createdAt: Date; locked: boolean }`
  - `loginIdSchema`、`displayNameSchema`、`passwordSchema`（Global Constraints の値）
  - `optionalPasswordSchema`：空文字か空白だけなら `undefined`、それ以外は `passwordSchema`
  - `MAX_FAILED_ATTEMPTS = 5`、`LOCK_DURATION_MS = 15 * 60 * 1000`
  - `isLocked(account: Pick<PasswordAccount, "lockedUntil">, now: Date): boolean`
  - `ownerIdForAccount(id: string): string` → `` `password:${id}` ``
  - `toSummary(account: PasswordAccount, now: Date): PasswordAccountSummary`
- Produces（`password-account-repository.ts`）:
  ```ts
  export interface PasswordAccountRepository {
    findByLoginId(loginId: string): Promise<PasswordAccount | null>;
    findById(id: string): Promise<PasswordAccount | null>;
    list(): Promise<PasswordAccount[]>; // createdAt 昇順
    create(input: {
      loginId: string;
      displayName: string;
      passwordHash: string;
    }): Promise<PasswordAccount>; // 重複なら LoginIdTakenError
    recordFailure(id: string, now: Date): Promise<void>; // +1。MAX に達したら lockedUntil=now+LOCK、回数0
    clearFailures(id: string): Promise<void>;
    setPassword(id: string, passwordHash: string): Promise<void>; // sessionVersion+1、failedAttempts=0、lockedUntil=null
  }
  ```
- Produces（`password-account-error.ts`）: `class LoginIdTakenError extends Error`、`class PasswordAccountNotFoundError extends Error`
- Produces（`password-hasher.ts`）:

  ```ts
  export interface PasswordHasher {
    hash(password: string): Promise<string>;
    verify(password: string, passwordHash: string): Promise<boolean>; // 壊れた形式は false
    simulateVerify(password: string): Promise<void>; // 存在しないIDのとき、同じくらい時間を使う
    generate(): string;
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**
  - `loginIdSchema.parse(" Taro.k ") === "taro.k"`。`"ab"`、33文字、`"taro k"`、`"太郎"` は失敗する。
  - `displayNameSchema` は `""` と 51文字が失敗、`" 太郎 "` は `"太郎"` になる。
  - `passwordSchema` は11文字と129文字が失敗、12文字と128文字は成功する。
  - `optionalPasswordSchema.parse("") === undefined`、`optionalPasswordSchema.parse(" ".repeat(12)) === undefined`、`"short"` は失敗する。
  - `isLocked({ lockedUntil: new Date(now + 1) }, now) === true`。過去の日時と `null` は false。
  - `ownerIdForAccount("ck1") === "password:ck1"`。

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test packages/core/tests/password-account.test.ts` → FAIL

- [ ] **Step 3: 上の Interfaces どおりに実装する**

- [ ] **Step 4: 通ることを確認する** 同じコマンドと `node --import tsx --test packages/core/tests/architecture.test.ts` で PASS（リポジトリの interface は `domain/*/repositories/` に、ポートは1ファイル1つ）。

- [ ] **Step 5: コミットする** `feat: パスワードアカウントのドメインルールとポートを追加する`

---

### Task 3: アカウントのユースケース

**Files:**

- Create: `packages/core/src/application/identity/use-cases/authenticate-password-account.ts`
- Create: `packages/core/src/application/identity/use-cases/create-password-account.ts`
- Create: `packages/core/src/application/identity/use-cases/reset-password-account-password.ts`
- Create: `packages/core/src/application/identity/use-cases/change-own-password.ts`
- Create: `packages/core/src/application/identity/use-cases/list-password-accounts.ts`
- Test: `packages/core/tests/password-account-use-cases.test.ts`（メモリ上の `FakeAccounts implements PasswordAccountRepository` と、`hash = p => "h:" + p` の `FakeHasher` を使う）

**Interfaces:**

- Consumes: Task 2 の全部
- Produces:
  - `AuthenticatePasswordAccount(repo, hasher).execute(input: { loginId: unknown; password: unknown }, now = new Date()): Promise<PasswordAccount | null>`
    - 形式が不正なら null（`simulateVerify` を呼ぶ）。アカウントがなければ `simulateVerify` を呼んで null。ロック中なら null（verify もしない）。パスワードが違えば `recordFailure` して null。合っていれば `clearFailures`（`failedAttempts > 0` のときだけ）して account を返す。
  - `CreatePasswordAccount(repo, hasher).execute(input: { loginId: unknown; displayName: unknown; password: unknown }): Promise<{ account: PasswordAccountSummary; password: string; generated: boolean }>`
    - zod の失敗はそのまま投げる。重複したら `LoginIdTakenError`。
  - `ResetPasswordAccountPassword(repo, hasher).execute(accountId: string, password: unknown): Promise<{ password: string; generated: boolean }>`
    - アカウントがなければ `PasswordAccountNotFoundError`。
  - `ChangeOwnPassword(repo, hasher).execute(accountId: string, input: { currentPassword: unknown; newPassword: unknown; confirmPassword: unknown }, now = new Date()): Promise<"changed" | "invalid-current" | "mismatch">`
    - 新しいパスワードは `passwordSchema`（自動生成はしない）で、不正なら zod の失敗を投げる。確認用と違えば `"mismatch"`。ロック中、または今のパスワードが違えば `"invalid-current"`（違う場合は `recordFailure`）。成功したら `setPassword` して `"changed"`。
  - `ListPasswordAccounts(repo).execute(now = new Date()): Promise<PasswordAccountSummary[]>`

- [ ] **Step 1: 失敗するテストを書く**（どれも `test(...)` を1つずつ）
  - `" TARO "` で作り、`"taro"` で認証できる（Review Focus 1）。
  - 間違いを5回 → 6回目は正しいパスワードでも null。`now + 15分` を渡すとまた認証できる（Review Focus 4）。
  - 間違いを4回したあと成功すると `failedAttempts` が0に戻る。
  - 存在しないIDでは `simulateVerify` が1回呼ばれる。
  - 作成：パスワード欄が `""` と `"            "`（空白12個）なら `generated: true` で、`hasher.generate()` の値になる（Review Focus 3）。`"correct horse battery"` なら `generated: false` で、その値。
  - 作成：同じIDを2回作ると `LoginIdTakenError`。
  - 再設定：`sessionVersion` が+1され、ロックが外れる。存在しないIDなら `PasswordAccountNotFoundError`。
  - 本人の変更：確認用が違えば `"mismatch"`（失敗回数は増えない）。今のパスワードが違えば `"invalid-current"` で回数+1。ロック中は正しくても `"invalid-current"`。成功で `sessionVersion` +1。
  - 一覧：`passwordHash` を含まない、作成日の昇順、ロック中なら `locked: true`。

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test packages/core/tests/password-account-use-cases.test.ts` → FAIL

- [ ] **Step 3: Interfaces どおりに実装する**

- [ ] **Step 4: 通ることを確認する** 同じコマンドで PASS

- [ ] **Step 5: コミットする** `feat: パスワードアカウントの認証・作成・再設定・変更のユースケースを追加する`

---

### Task 4: scrypt の実装、Prisma のテーブルとリポジトリ

**Files:**

- Create: `src/infrastructure/auth/scrypt-password-hasher.ts`
- Modify: `prisma/schema.prisma`（`model PasswordAccount`）
- Create: `prisma/migrations/20261007090000_password_accounts/migration.sql`
- Create: `src/infrastructure/persistence/prisma/repositories/prisma-password-account-repository.ts`
- Test: `tests/scrypt-password-hasher.test.ts`

**Interfaces:**

- Consumes: Task 2 の `PasswordHasher`、`PasswordAccountRepository`、エラー、定数
- Produces: `class ScryptPasswordHasher implements PasswordHasher`、`class PrismaPasswordAccountRepository implements PasswordAccountRepository`

- [ ] **Step 1: 失敗するテストを書く** `tests/scrypt-password-hasher.test.ts`
  - `hash("correct horse battery")` が `/^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/` に一致する。同じパスワードでも2回のハッシュは違う値になる。
  - `verify` は正しいパスワードで true、違うパスワードで false。`"scrypt:1:2"`、`""`、`"bcrypt$..."` では例外を出さずに false。
  - `generate()` が `/^[\w-]{20}$/` に一致する。
  - `simulateVerify("x")` が resolve する。

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test tests/scrypt-password-hasher.test.ts` → FAIL

- [ ] **Step 3: 実装する**
  - Hasher: `promisify(scrypt)` に `{ N, r, p, maxmem: 64 * 1024 * 1024 }` を渡す。`verify` は保存されたパラメータで計算し、長さが同じことを確かめてから `timingSafeEqual` で比べる。`simulateVerify` は、モジュールの読み込み時に1回だけ作ったダミーハッシュを `verify` する（遅延して作り、キャッシュする）。
  - schema:
    ```prisma
    // Password sign-in for members. Managed by GitHub admins at /admin/accounts.
    model PasswordAccount {
      id             String    @id @default(cuid())
      loginId        String    @unique
      displayName    String
      passwordHash   String
      sessionVersion Int       @default(0)
      failedAttempts Int       @default(0)
      lockedUntil    DateTime?
      createdAt      DateTime  @default(now())
      updatedAt      DateTime  @updatedAt
    }
    ```
  - migration.sql は、ローカルの Docker DB（`docker compose up -d`）に対して `pnpm exec prisma migrate dev --name password_accounts --create-only` で作り、ディレクトリ名を上の名前に揃える。
  - Repository: `create` は Prisma の `P2002` を `LoginIdTakenError` に変える。`recordFailure` は `$executeRaw` で1文の UPDATE にする（Review Focus 5）。
    ```sql
    UPDATE "PasswordAccount" SET
      "failedAttempts" = CASE WHEN "failedAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS} THEN 0 ELSE "failedAttempts" + 1 END,
      "lockedUntil"    = CASE WHEN "failedAttempts" + 1 >= ${MAX_FAILED_ATTEMPTS} THEN ${new Date(now.getTime() + LOCK_DURATION_MS)} ELSE "lockedUntil" END,
      "updatedAt" = ${now}
    WHERE "id" = ${id}
    ```
    `setPassword` は `sessionVersion: { increment: 1 }`、`failedAttempts: 0`、`lockedUntil: null` で更新する。`findByLoginId` に渡すIDは呼び出し側（ユースケース）で正規化済みとする。

- [ ] **Step 4: 通ることを確認する** `node --import tsx --test tests/scrypt-password-hasher.test.ts` が PASS。`pnpm run db:generate && pnpm run typecheck` も通る。ローカルDBで `pnpm exec prisma migrate deploy` が成功する。

- [ ] **Step 5: コミットする** `feat: PasswordAccount テーブルと scrypt・Prisma の実装を追加する`

---

### Task 5: Auth.js への組み込みとセッションの取り消し

**Files:**

- Modify: `src/infrastructure/auth/authjs-config.ts`
- Modify: `src/infrastructure/auth/github-identity.ts`
- Create: `src/infrastructure/auth/member-session-policy.ts`
- Modify: `src/infrastructure/auth/authjs-current-user-provider.ts`
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/composition/identity-container.ts`
- Test: `tests/github-identity.test.ts`、`tests/member-session-policy.test.ts`（新規）

**Interfaces:**

- Consumes: Task 3 の `AuthenticatePasswordAccount`、Task 4 の実装、Task 2 の `ownerIdForAccount`
- Produces:
  - `passwordOwnerId(accountId: unknown): string | undefined`（github-identity.ts）：`/^[a-z0-9]{20,32}$/` に一致すれば `password:<id>`
  - `githubIdFromToken` は、従来の数字のほかに `/^password:[a-z0-9]{20,32}$/` も通す
  - `isCurrentMemberSession(claims: { role: AppRole; accountId?: unknown; sessionVersion?: unknown }, findById: (id: string) => Promise<{ sessionVersion: number } | null>): Promise<boolean>`：member 以外は DB を見ずに true。member なら、アカウントが存在して `sessionVersion` が一致するときだけ true
  - `new AuthJsCurrentUserProvider(findById)`：false のときは `role: "revoked"` を返す。member のときは `displayName`（session.user.name）と `accountId` も入れる
  - next-auth 型: `User` に `accountId?: string; sessionVersion?: number`、`Session["user"]` と `JWT` に `accountId?: string; sessionVersion?: number`
  - `signInWithPassword(input: { loginId: string; password: string; redirectTo: string }): Promise<void>`（identity-container）
  - `passwordAccountUseCases`（identity-container）：`{ authenticate, create, reset, changeOwn, list }`。Task 3 の5つのユースケースを、この順に Prisma と scrypt で組み立てたもの

- [ ] **Step 1: 失敗するテストを書く**
  - `github-identity.test.ts`：`githubIdFromToken("password:ckabcdefghijklmnopqrstuvw") === 同じ値`。`"password:"`、`"password:../x"`、`"password:ABC…"` は undefined。`passwordOwnerId` も同じ規則。
  - `member-session-policy.test.ts`：
    - admin・guest は、`findById` を呼ばずに true（Review Focus 2。呼ばれたら throw する fake を使う）
    - member で `sessionVersion` が一致すれば true。違えば false。アカウントがなければ false。`accountId` がない、または `sessionVersion` が数値でなければ false

- [ ] **Step 2: 失敗を確認する** `node --import tsx --test tests/github-identity.test.ts tests/member-session-policy.test.ts` → FAIL

- [ ] **Step 3: 実装する**
  - authjs-config: `Credentials({ id: "password", name: "Password", credentials: { loginId: {}, password: {} }, authorize })`。`authorize` は `passwordAccountUseCases.authenticate.execute(credentials)` を呼び、成功すれば `{ id: account.id, name: account.displayName, email: null, image: null, githubLogin: account.loginId, role: "member", accountId: account.id, sessionVersion: account.sessionVersion }`、失敗すれば `null` を返す。composition を直接 import すると循環するので、authjs-config では infrastructure の実装を組み立てて `AuthenticatePasswordAccount` を作る。
  - `signIn` コールバック: `if (account?.provider === "password") return user.role === "member";`
  - `jwt`: `token.accountId = user.accountId; token.sessionVersion = user.sessionVersion; token.githubId = passwordOwnerId(user.accountId) ?? githubIdFromAccount(account);`
  - `session`: `accountId` と `sessionVersion` を、型を確かめてから session.user に写す。
  - identity-container: `new AuthJsCurrentUserProvider((id) => repository.findById(id))`。`signInWithPassword` は `signIn("password", { loginId, password, redirectTo })`。

- [ ] **Step 4: 通ることを確認する** 同じコマンドで PASS、`pnpm run typecheck && pnpm run lint`

- [ ] **Step 5: コミットする** `feat: ID・パスワードでのログインと member セッションの取り消しを Auth.js に組み込む`

---

### Task 6: ログイン画面とヘッダー

**Files:**

- Modify: `src/app/signin/page.tsx`
- Modify: `src/presentation/actions/auth-actions.ts`
- Modify: `src/presentation/components/auth/auth-controls.tsx`

**Interfaces:**

- Consumes: Task 5 の `signInWithPassword`
- Produces: `signInWithPasswordAction(callbackPath: string, formData: FormData): Promise<void>`

- [ ] **Step 1: 実装する**
  - Action: `loginId`・`password` を formData から読み、`signInWithPassword` を呼ぶ。`AuthError`（next-auth）を catch したら `redirect("/signin?error=CredentialsSignin&callbackUrl=" + encodeURIComponent(safePath))` する。それ以外の例外（`redirect` によるものを含む）はそのまま投げ直す。
  - signin page:
    - `errorMessages` に `CredentialsSignin: "IDまたはパスワードが違うか、一時的にロックされています。"` を足す。
    - `searchParams.notice === "password-changed"` のときは「パスワードを変更しました。新しいパスワードでログインしてください。」を（destructive ではない）`Alert` で出す。
    - GitHub ボタンの上に、`ログインID`（`autoComplete="username"`）と `パスワード`（`type="password"`、`autoComplete="current-password"`）の `<label>` 付き入力欄、「IDとパスワードでログイン」ボタンのフォームを置く。その下に「または」の区切りを入れる。
    - Badge を「管理者 / メンバー / ゲスト」にする。末尾の説明に「IDとパスワードのアカウントは管理者が発行します。」を足す。
    - 「OAuth設定が必要です」の案内文は、GitHub だけの話だとわかる表現にする。
  - auth-controls:
    - member は `user.displayName ?? user.githubLogin` を出し、その隣に `/account/password` への「パスワード変更」リンク（`KeyRound` アイコン）を置く。
    - admin には `/admin/accounts` への「アカウント管理」リンク（`Users` アイコン）を置く。
    - guest は今のまま。

- [ ] **Step 2: 確認する** `pnpm run typecheck && pnpm run lint`。`pnpm dev` で `/signin` にフォームが出ること、間違ったIDでエラー表示が出ることを、ブラウザで確認する（ローカルDB）。

- [ ] **Step 3: コミットする** `feat: ログイン画面に ID・パスワードのフォームを追加する`

---

### Task 7: アカウント管理画面 `/admin/accounts`

**Files:**

- Create: `src/app/admin/accounts/page.tsx`
- Create: `src/presentation/actions/password-account-actions.ts`
- Create: `src/presentation/components/auth/create-account-form.tsx`（client）
- Create: `src/presentation/components/auth/reset-password-form.tsx`（client）

**Interfaces:**

- Consumes: `getCurrentAdminUser`、`passwordAccountUseCases.{list, create, reset}`
- Produces:

  ```ts
  export type AccountActionState =
    | { status: "idle" }
    | { status: "error"; message: string }
    | { status: "success"; loginId: string; password: string; generated: boolean };
  createPasswordAccountAction(prev: AccountActionState, formData: FormData): Promise<AccountActionState>
  resetPasswordAccountPasswordAction(accountId: string, prev: AccountActionState, formData: FormData): Promise<AccountActionState>
  ```

- [ ] **Step 1: 実装する**
  - page: `getCurrentAdminUser()` が null なら `redirect("/")`。`export const dynamic = "force-dynamic"`。一覧はログインID・表示名・作成日（`Asia/Tokyo` の日付）・「ロック中」Badge。アカウントがないときは「まだアカウントはありません。」と出す。
  - actions: 先頭で `getCurrentAdminUser()` を再確認し、null なら「この操作を行う権限がありません。再度ログインしてください。」を返す。
    - zod の失敗のメッセージは、どの欄の問題かで出し分ける。ログインIDなら「ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。」、表示名なら「表示名は1〜50文字にしてください。」、パスワードなら「パスワードは12〜128文字にしてください。」
    - `LoginIdTakenError` →「このログインIDはすでに使われています。」、`PasswordAccountNotFoundError` →「アカウントが見つかりません。」
    - 成功したら `revalidatePath("/admin/accounts")`。
  - forms は `useActionState` を使う。成功したら「ログインID: … / パスワード: …（この画面を離れると再表示できません）」を `<output>` に出す。パスワード欄の補足文は「空欄にすると自動生成します。」
  - 平文のパスワードを `console` に出さない。

- [ ] **Step 2: 確認する** `pnpm run typecheck && pnpm run lint`。ローカルで作成・再設定ができること、member でこの画面にアクセスするとトップへ戻されることを確認する。

- [ ] **Step 3: コミットする** `feat: GitHub管理者向けのアカウント管理画面を追加する`

---

### Task 8: 本人のパスワード変更 `/account/password`

**Files:**

- Create: `src/app/account/password/page.tsx`
- Create: `src/presentation/components/auth/change-password-form.tsx`（client）
- Modify: `src/presentation/actions/password-account-actions.ts`

**Interfaces:**

- Consumes: `getCurrentMemberUser`、`passwordAccountUseCases.changeOwn`、`signOut`
- Produces: `changeOwnPasswordAction(prev: { status: "idle" } | { status: "error"; message: string }, formData: FormData): Promise<…>`

- [ ] **Step 1: 実装する**
  - page: `user?.role !== "member" || !user.accountId` なら `redirect("/")`。
  - action: role と `accountId` を再確認する。結果に応じて次のように返す。
    - `"mismatch"` →「確認用のパスワードが一致しません。」
    - `"invalid-current"` →「現在のパスワードが違うか、一時的にロックされています。」
    - zod の失敗 →「パスワードは12〜128文字にしてください。」
    - `"changed"` → `signOut({ redirectTo: "/signin?notice=password-changed" })`
  - 入力欄は3つ。`autoComplete` は `current-password` / `new-password` / `new-password`。

- [ ] **Step 2: 確認する** `pnpm run typecheck && pnpm run lint`

- [ ] **Step 3: コミットする** `feat: member が自分のパスワードを変更できるようにする`

---

### Task 9: E2E、README、PR

**Files:**

- Modify: `e2e/fixtures.ts`（TRUNCATE に `"PasswordAccount"` を足す。`asMember(page, loginId, password, callback = "/")` を追加）
- Create: `e2e/accounts.spec.ts`
- Modify: `README.md`（認証の節に member・管理画面・パスワード変更・ロックを追記。「Auth.js v5 + GitHub OAuth」の行を「GitHub OAuth / ID・パスワード」にする）
- Modify: `e2e/learning.spec.ts`、`e2e/security.spec.ts`（admin 専用の文言が変わって落ちるテストがあれば、期待値を合わせる）

- [ ] **Step 1: E2E を書く** `e2e/accounts.spec.ts`（admin は既存の `asAdmin(context)`）
  - `admin creates a member who can use chat`：作成フォームで `taro`、`太郎`、パスワード欄は空欄 → 表示されたパスワードを読み取る → 別の context で `asMember` → `/chat` が表示され、ヘッダーに「太郎」が出る
  - `member cannot open account management`：`/admin/accounts` を開くと `/` に戻される
  - `wrong password shows one generic error` と `five failures lock the account`：5回間違えたあと正しいパスワードでもエラーになる（Review Focus 5）
  - `reset revokes existing member sessions`：member でログイン → admin が再設定 → member が `/chat` を再読み込みすると `/signin` に戻される
  - `member changes own password`：変更 → `/signin` に「パスワードを変更しました」が出る → 新しいパスワードでログインできる
  - `member conversations are private`：`db` から `ownerId = 'password:<id>'` の `ChatConversation` を INSERT する → member の `/conversations` には出て、admin の `/conversations` には出ない

- [ ] **Step 2: 全体を検証する** `pnpm run test:regression` → すべて PASS（E2E は Docker が必要）

- [ ] **Step 3: コミットして PR を作る**
  - コミット: `test: member アカウントの E2E と README を追加する`
  - push して `gh pr create`。PR 本文に次のことを書く。
    - 本番反映の前に `vercel env pull` を実行し、続けて `pnpm exec prisma migrate deploy` で Neon に `20261007090000_password_accounts` を適用すること
    - 新しい環境変数はないこと
    - 最初のアカウントは、GitHub 管理者が `/admin/accounts` から作ること
