# Better Auth への移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zhuelog の自前のログインとセッションを Better Auth 1.7.28 に置き換え、学習データの持ち主を `user.id` への外部キーにそろえる。

**Architecture:** Better Auth の設定は `src/infrastructure/auth/better-auth.ts` の 1 か所に置き、`/api/auth/[...all]` で HTTP の口を出す。ログイン中の人は `auth.api.getSession` から `AuthenticatedUser` に変換する 1 つのプロバイダーで決める。データの付け替えは 1 つの SQL のマイグレーションで、本番のビルドの `prisma migrate deploy` が 1 回で当てる（管理者の対応だけは、デプロイ前にスクリプトで仮の表に入れておく）。

**Tech Stack:** Next.js 16.4（このリポジトリの版。`node_modules/next/dist/docs/` を読む）、better-auth 1.7.28、Prisma 7（`@prisma/adapter-pg`）、PostgreSQL 16、node:test＋tsx、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-27-better-auth-migration-design.md`

## Global Constraints

- `better-auth` は `1.7.28` に固定する（ID サーバーと同じ版）。
- 使うプラグインは `username`・`genericOAuth`・`anonymous`・`admin`・`nextCookies` だけ。
- 自前で足すのは次の 3 つだけ：デモの `/change-password` を断る hook、ゲストへのなりすましを断る hook、なりすまし中の LINE 連携の禁止。
- ログイン ID の規則は `^[a-z0-9._-]{3,32}$`（`src/domain/identity/password-account.ts` の `normalizeLoginId`）。
- パスワードのハッシュは今の scrypt（`src/infrastructure/security/scrypt-password-hasher.ts`）。`tests/fixtures/scrypt-golden.json` の検査を残す。
- 会員の偽のメールアドレスは `<loginId>@members.zhuelog.invalid`、`emailVerified` は `false`。
- セッションは `expiresIn: 30 * 24 * 60 * 60`。`updateAge` は既定。なりすましは既定の 1 時間。
- レート制限は `storage: "database"`。全体は 60 秒に 10 回、`/sign-in/username` は 900 秒に 20 回、`/change-password` は 900 秒に 5 回。IP は `x-real-ip`、無ければ `x-forwarded-for` の先頭（`src/infrastructure/auth/client-address.ts` と同じ）。
- 会員・SID・ゲストのログインと自分のパスワード変更は、画面から Better Auth のクライアント（HTTP の `/api/auth/*`）で呼ぶ。サーバーから `auth.api.*` を呼んでよいのは、デモのログイン、管理者の機能、`getSession`・`listUsers` などの読むだけのものに限る。
- SID は `genericOAuth`、`providerId: "sid"`、`scopes: ["openid", "email", "profile"]`、PKCE あり。`accountLinking.trustedProviders` に `sid` を入れない。ログアウトは Better Auth の既定（`end_session_endpoint` へ送る）。
- `disabledPaths` に `/update-user` を入れる。`emailAndPassword.disableSignUp: true`。
- 画面とエラーの文言は日本語の今の文言を保つ。Better Auth の英語のメッセージを画面に出さない。
- 環境変数：足す `BETTER_AUTH_SECRET`・`DEMO_PASSWORD`。外す `AUTH_GITHUB_ID`・`GITHUB_WEB_CLIENT_SECRET`・`AUTH_ALLOWED_GITHUB_IDS`。`AUTH_URL` を `baseURL` に使う。
- 層の決まり：Prisma は `src/infrastructure/prisma/` だけ、`better-auth`（サーバー側）は `src/infrastructure/auth/` だけ、`better-auth/react`（クライアント）は `src/presentation/` の画面の部品だけ。`next-auth` は禁止のまま。
- 各タスクの終わりで `pnpm run typecheck && pnpm run lint && pnpm run test:unit` が通ること（Task 3 の途中は除く。Task 3 の終わりで通す）。

## Review Focus

1. **`-`・`.` を含む、または 32 文字のログイン ID の会員がログインできる。** Better Auth の既定の規則（最大 30、`-` なし）はログインにも効く。→ Task 2 の単体と Task 6 の e2e。
2. **持ち主の付け替え先がないデータがあると、マイグレーションが止まり、何も変わらない。** フォローの両方の列、LINE の 3 つの表も同じ。→ Task 3 の移行テスト。
3. **管理者が会員のパスワードを再設定すると、その会員の開いている画面は次の操作でログイン画面に戻る（エラー画面ではない）。** → Task 7 の e2e。
4. **デモで入った人が `/api/auth/update-user` や `/api/auth/change-password` を直接呼んでも、デモの名前とパスワードは変わらない。** → Task 8 の e2e。
5. **なりすまし中に LINE 連携の画面を開くと `/` に戻り、ゲストにはなりすませない。** → Task 7 の単体と e2e。

---

### Task 1: Better Auth の依存・表・層の決まり

**Files:**

- Modify: `package.json`（`better-auth: "1.7.28"` を dependencies に足す）
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261127090000_better_auth_tables/migration.sql`
- Modify: `tests/architecture.test.ts`

**Interfaces:**

- Produces: Prisma のモデル `User`・`Session`・`Account`・`Verification`・`RateLimit`（表の名前は `user`・`session`・`account`・`verification`・`rateLimit`）。今の `Session` のモデルは `LegacySession`（`@@map("Session")`）に名前を替える。`User` の列は Better Auth の本体＋`username`（`username String? @unique`・`displayUsername String?`）＋`anonymous`（`isAnonymous Boolean? @default(false)`）＋`admin`（`role String? @default("user")`・`banned Boolean? @default(false)`・`banReason String?`・`banExpires DateTime?`）。`Session` に `impersonatedBy String?`。
- Produces: 層の決まり「`better-auth` は `src/infrastructure/auth/` だけ、`better-auth/react` と `better-auth/client/plugins` は `src/presentation/` だけ」。

- [ ] **Step 1: 層の決まりの失敗するテストを書く**

`tests/architecture.test.ts` に、`src/infrastructure/auth/` 以外から `better-auth`（`better-auth/react`・`better-auth/client/plugins` を除く）を import すると違反、`src/presentation/` 以外から `better-auth/react` を import すると違反、の 2 件を、今の `forbiddenIn` と同じ作りで足す。`src/application/x.ts` が `better-auth` を import する偽のファイル一覧で違反が出ることを確かめるケースを入れる。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/architecture.test.ts`
Expected: FAIL（新しいケース）

- [ ] **Step 3: 決まりを実装し、依存とスキーマを足す**

`pnpm add better-auth@1.7.28`。スキーマは `pnpm dlx @better-auth/cli@1.7.28 generate` で作った形に合わせて手で書く（列の名前と型は CLI の出力に合わせる）。マイグレーションは `prisma migrate dev --create-only` で作り、表を作るだけ（データは動かさない）。

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run typecheck && pnpm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml prisma tests/architecture.test.ts
git commit -m "feat: Better Auth の依存と表を足す"
```

### Task 2: Better Auth の設定と `/api/auth`

**Files:**

- Create: `src/infrastructure/auth/better-auth.ts`
- Create: `src/infrastructure/auth/better-auth-rules.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Modify: `src/infrastructure/config/environment.ts`
- Test: `tests/better-auth-rules.test.ts`

**Interfaces:**

- Consumes: Task 1 のモデル。`hashPassword`・`verifyPassword`（`scrypt-password-hasher.ts` の今の関数）。
- Produces:
  - `export const auth`（`betterAuth({...})` の戻り値）と `export type Auth = typeof auth`（`better-auth.ts`）。
  - `export function isAllowedUsername(username: string): boolean`（`better-auth-rules.ts`。`normalizeLoginId(username) === username` と同じ）。
  - `export function rejectsDemoPasswordChange(path: string, username: string | null | undefined, demoLoginId: string | undefined): boolean`
  - `export function rejectsGuestImpersonation(path: string, target: { isAnonymous?: boolean | null } | null): boolean`
  - `export function memberEmail(loginId: string): string`（`${loginId}@members.zhuelog.invalid`）
  - `export const AUTH_RATE_LIMIT`（Global Constraints の値の `rateLimit` の設定）
  - 環境：`betterAuthSecret(): string`・`demoPassword(): string | undefined`・`sidOAuthConfig(): { issuer: string; clientId: string; clientSecret: string } | null`（今の SID の設定の読み方を流用）。`allowedGitHubIds` と GitHub の設定の読み方は消す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("isAllowedUsername follows the login id rule", () => {
  assert.equal(isAllowedUsername("abc"), true);
  assert.equal(isAllowedUsername("a.b-c_d"), true);
  assert.equal(isAllowedUsername("a".repeat(32)), true);
  assert.equal(isAllowedUsername("a".repeat(33)), false);
  assert.equal(isAllowedUsername("ab"), false);
  assert.equal(isAllowedUsername("Abc"), false);
});
test("the demo may not change its password", () => {
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "demo", "demo"),
    true,
  );
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "alice", "demo"),
    false,
  );
  assert.equal(
    rejectsDemoPasswordChange("/sign-in/username", "demo", "demo"),
    false,
  );
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "demo", undefined),
    false,
  );
});
test("a guest cannot be impersonated", () => {
  assert.equal(
    rejectsGuestImpersonation("/admin/impersonate-user", { isAnonymous: true }),
    true,
  );
  assert.equal(
    rejectsGuestImpersonation("/admin/impersonate-user", {
      isAnonymous: false,
    }),
    false,
  );
  assert.equal(
    rejectsGuestImpersonation("/admin/list-users", { isAnonymous: true }),
    false,
  );
});
test("memberEmail uses the .invalid domain", () => {
  assert.equal(memberEmail("alice"), "alice@members.zhuelog.invalid");
});
test("rate limits match the spec", () => {
  assert.deepEqual(
    {
      window: AUTH_RATE_LIMIT.window,
      max: AUTH_RATE_LIMIT.max,
      storage: AUTH_RATE_LIMIT.storage,
    },
    { window: 60, max: 10, storage: "database" },
  );
  assert.deepEqual(AUTH_RATE_LIMIT.customRules["/sign-in/username"], {
    window: 900,
    max: 20,
  });
  assert.deepEqual(AUTH_RATE_LIMIT.customRules["/change-password"], {
    window: 900,
    max: 5,
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/better-auth-rules.test.ts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `better-auth-rules.ts` と `better-auth.ts` と route を実装する**

`better-auth.ts` は Global Constraints の値をすべてここで設定する：`baseURL` は `AUTH_URL`、`database: prismaAdapter(prisma, { provider: "postgresql" })`、`emailAndPassword: { enabled: true, disableSignUp: true, password: { hash, verify } }`、`username({ minUsernameLength: 3, maxUsernameLength: 32, usernameValidator: isAllowedUsername })`、`genericOAuth`（`discoveryUrl: ${issuer}/.well-known/openid-configuration`、`pkce: true`）は `sidOAuthConfig()` が null なら入れない、`anonymous()`、`admin()`（`allowImpersonatingAdmins` は付けない）、`nextCookies()` は最後、`disabledPaths: ["/update-user"]`、`advanced.ipAddress.ipAddressHeaders: ["x-real-ip", "x-forwarded-for"]`、`hooks.before` で上の 2 つの規則を呼び、真なら `APIError("FORBIDDEN")`。`next build` のときに環境が無くても読み込めるよう、ID サーバーの `lib/auth.ts` と同じく `NEXT_PHASE === "phase-production-build"` なら仮の値を使う。route は `toNextJsHandler(auth)` の `GET`・`POST`。

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run typecheck && node --import tsx --test tests/better-auth-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/auth src/app/api/auth src/infrastructure/config tests/better-auth-rules.test.ts
git commit -m "feat: Better Auth の設定と /api/auth のハンドラーを足す"
```

### Task 3: 持ち主を `user.id` にそろえるマイグレーション

**Files:**

- Create: `prisma/migrations/20261127100000_owner_to_user/migration.sql`
- Modify: `prisma/schema.prisma`（表 12 つの `ownerId` → `userId` と `user` への relation。`Follow` の 2 列。`LineLink`・`LineLinkCode` の `role` を消す。`PasswordAccount`・`SidAccount`・`LegacySession`・`SignInThrottle`・`FfpfAccount` を消す）
- Modify: `src/infrastructure/prisma/*-store.ts` と、それを呼ぶ `src/application/**`・`src/composition/**` の `ownerId` の引数（名前を `userId` に替える）
- Create: `tests/migration/better-auth-migration.test.ts`
- Create: `scripts/test-migration.mjs`、`package.json` に `"test:migration": "docker compose -f compose.e2e.yaml up -d --wait && node scripts/test-migration.mjs"`

**Interfaces:**

- Consumes: Task 1 の表。デプロイ前に Task 4 のスクリプトが入れる仮の表 `"_better_auth_admin"("githubId" TEXT, "sidSub" TEXT, "email" TEXT, "name" TEXT)`（行は 0 か 1）。
- Produces: どのストアも持ち主を `userId: string` で受ける（引数の名前、Prisma の列の名前とも）。`LineLink` の役割は `user.role` を join して読む（`role: "admin" | "member"`。`"user"` は `"member"` に読み替える）。

**マイグレーションの順（1 つのトランザクション）**

1. `"_better_auth_admin"` が無ければ作る（空）。
2. `PasswordAccount` → `user`（`id` は同じ、`email` は `memberEmail(loginId)` と同じ形、`username`・`displayUsername` は `loginId`、`name` は `displayName`、`role` は `'user'`）と `account`（`providerId` は `'credential'`、`accountId` は `user.id`、`password` はハッシュそのまま）。
3. `SidAccount` → `user`（`id` は `gen_random_uuid()::text`、`emailVerified` は `true`）と `account`（`providerId` は `'sid'`、`accountId` は今の `SidAccount.id`）。
4. `"_better_auth_admin"` の行 → `user`（`role` は `'admin'`、`emailVerified` は `true`）と `account`（`'sid'`、`accountId` は `sidSub`）。
5. 対応表 `"_owner_map"("ownerId", "userId")`：`'password:'||id`、`'sid:'||id`、管理者の `githubId`。
6. 各表に `userId` を足して対応表で埋める。`Follow` は 2 列とも。
7. どれかの表に `userId IS NULL` の行が 1 つでもあれば `RAISE EXCEPTION`（表の名前と件数をメッセージに入れる）。
8. `NOT NULL`、`user(id)` への外部キー（`ON DELETE CASCADE`）、今の索引と一意の制約を `userId` で作り直し、`ownerId` と `LineLink`・`LineLinkCode` の `role` を消す。
9. 古い表と `"_owner_map"`・`"_better_auth_admin"` を消す。

- [ ] **Step 1: 移行テストを書く**

`scripts/test-migration.mjs` は、compose.e2e の Postgres に使い捨てのデータベースを作り、`prisma/migrations/` の SQL をこのタスクのものの手前まで順に当て、テストの seed を入れてから、このタスクの SQL を当てる関数 `migrateFrom(seedSql: string): Promise<pg.Client>` を `tests/migration/` に渡す。テスト：

```ts
test("members, sid members and the admin keep their notes", async () => {
  const db = await migrateFrom(
    seed({
      admin: { githubId: "123", sidSub: "s1", email: "o@x", name: "Owner" },
    }),
  );
  // seed: PasswordAccount p1 (loginId "a-b.c"), SidAccount "sid9", LearningEntry rows owned by
  // "password:p1", "sid:sid9", "123"; Follow("password:p1" -> "sid:sid9"); LineLink owned by "123".
  const owners =
    await db.query(`SELECT e."userId", u."username", u."role", a."providerId", a."accountId"
    FROM "LearningEntry" e JOIN "user" u ON u.id = e."userId" JOIN "account" a ON a."userId" = u.id ORDER BY u."role"`);
  assert.deepEqual(
    owners.rows.map((r) => [r.role, r.providerId, r.accountId ?? r.username]),
    [
      ["admin", "sid", "s1"],
      ["user", "credential", "p1"],
      ["user", "sid", "sid9"],
    ],
  );
  const follow = await db.query(
    `SELECT "followerId", "followeeId" FROM "Follow"`,
  );
  assert.equal(follow.rows[0].followerId, "p1");
  const member = await db.query(
    `SELECT email, "emailVerified" FROM "user" WHERE id = 'p1'`,
  );
  assert.deepEqual(member.rows[0], {
    email: "a-b.c@members.zhuelog.invalid",
    emailVerified: false,
  });
});
test("an owner with no user stops the migration and changes nothing", async () => {
  await assert.rejects(
    migrateFrom(seed({ admin: null, orphanOwner: "999" })),
    /LearningEntry/,
  );
  // migrateFrom leaves the database as it was before this migration on failure:
  // "PasswordAccount" still exists and "LearningEntry" still has "ownerId".
});
test("the admin's GitHub-owned rows need the admin row", async () => {
  await assert.rejects(
    migrateFrom(seed({ admin: null, adminOwned: "123" })),
    /123|LearningEntry/,
  );
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm run test:migration`
Expected: FAIL（マイグレーションがない）

- [ ] **Step 3: マイグレーションとスキーマを書き、ストアの `ownerId` を `userId` に替える**

ストアの SQL の中の `"ownerId"` も替える。`social-store.ts`・`ai-usage-store.ts` の `PasswordAccount`/`SidAccount` との join は `"user"` との join（`role` と `"isAnonymous"` で会員に絞る）に替え、`PASSWORD_PREFIX`・`SID_PREFIX` を消す。`line-link-store.ts` の `role` は `"user"."role"` から読む。アプリの側の型の名前（`ownerId` という引数名など）は、このタスクでは Prisma に触る所だけ替え、残りは Task 5 で替える。

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run test:migration && pnpm run typecheck && pnpm run test:unit`
Expected: PASS（ストアの単体テストは列の名前を合わせて直す）

- [ ] **Step 5: Commit**

```bash
git add prisma src/infrastructure/prisma src/application src/composition tests scripts/test-migration.mjs package.json
git commit -m "feat: データの持ち主を Better Auth の user にそろえるマイグレーション"
```

### Task 4: 管理者の対応を入れるスクリプト

**Files:**

- Create: `scripts/prepare-better-auth-admin.ts`、`package.json` に `"auth:prepare-admin": "tsx scripts/prepare-better-auth-admin.ts"`
- Test: `tests/prepare-better-auth-admin.test.ts`

**Interfaces:**

- Produces: `export function parseAdminArgs(argv: string[]): { githubId: string; sidSub: string; email: string; name: string }`（`--github-id`・`--sid-sub`・`--email`・`--name`。`githubId` は `^\d+$`、`sidSub` は `^[a-z0-9]{1,64}$`、どれか欠けたら `Error`）と `export function prepareAdminSql(args): string`（`"_better_auth_admin"` を作り、中身を 1 行に入れ替える SQL。値はパラメーターで渡す）。実行すると `DATABASE_URL` に当てる。

- [ ] **Step 1: 失敗するテストを書く**

`parseAdminArgs(["--github-id","123","--sid-sub","abc","--email","o@x","--name","Owner"])` が 4 つの値を返す。`--github-id abc` で throw。`--sid-sub` が無いと throw。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/prepare-better-auth-admin.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 通ることを確かめる**

Run: `node --import tsx --test tests/prepare-better-auth-admin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-better-auth-admin.ts tests/prepare-better-auth-admin.test.ts package.json
git commit -m "feat: 管理者の SID の sub を移行の前に入れるスクリプト"
```

### Task 5: ログイン中の人を Better Auth のセッションから決める

**Files:**

- Modify: `src/domain/identity/entities/authenticated-user.ts`
- Create: `src/domain/identity/user-id.ts`（`owner-id.ts` を置き換える）
- Create: `src/infrastructure/identity/better-auth-current-user-provider.ts`
- Modify: `src/composition/current-user.ts`、`src/application/identity/use-cases/*.ts`、`src/presentation/guards/*.ts`、`githubId` を使う所すべて（今 45 か所）
- Modify: `src/proxy.ts`、`src/presentation/http/session-gate.ts`
- Delete: `src/infrastructure/identity/session-current-user-provider.ts`、`src/domain/identity/owner-id.ts`、`src/domain/identity/session.ts` とそのテスト
- Test: `tests/better-auth-current-user-provider.test.ts`、`tests/resolve-record-owner.test.ts`、`tests/session-gate.test.ts`

**Interfaces:**

- Produces:

```ts
export type AppRole = "admin" | "member" | "guest";
export type AuthenticatedUser = {
  userId: string;
  role: AppRole;
  displayName: string;
  username?: string; // members with a password
  demo?: boolean;
  impersonatedBy?: string; // the admin's user id while impersonating
};
export function isUserId(value: string): boolean; // ^[A-Za-z0-9_-]{1,64}$
export function toAuthenticatedUser(
  session: {
    user: {
      id: string;
      name: string;
      role?: string | null;
      isAnonymous?: boolean | null;
      banned?: boolean | null;
      username?: string | null;
    };
    session: { impersonatedBy?: string | null };
  } | null,
  demoLoginId: string | undefined,
): AuthenticatedUser | null;
```

`role` は `isAnonymous` なら `guest`、`role === "admin"` なら `admin`、ほかは `member`。`banned` なら `null`。`getCachedCurrentUser()` の名前と戻り値の型は今のまま（中身が `auth.api.getSession({ headers: await headers() })` → `toAuthenticatedUser`）。`revoked`・`actingAs`・`actorId`・`actAsIgnored`・`accountId`・`githubLogin` は消す。

- [ ] **Step 1: 失敗するテストを書く**

`toAuthenticatedUser`：null → null。`isAnonymous: true` → `{ role: "guest" }`。`role: "admin"` → admin。`username === "demo"` かつ `demoLoginId "demo"` → `demo: true`。`banned: true` → null。`impersonatedBy: "adm"` → `impersonatedBy: "adm"` かつ `role: "member"`。`resolveRecordOwner` の `?user=` は `isUserId` で検査（`"password:x"` は `redirect-self`）。`session-gate` は `better-auth.session_token` と `__Secure-better-auth.session_token` の Cookie があれば通す（`getSessionCookie` を使う）。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/better-auth-current-user-provider.test.ts tests/resolve-record-owner.test.ts tests/session-gate.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装し、`githubId` を `userId` に替える**

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat: ログイン中の人を Better Auth のセッションから決める"
```

### Task 6: ログイン画面・ログアウト・e2e の土台

**Files:**

- Create: `src/presentation/lib/auth-client.ts`（`createAuthClient` に `usernameClient()`・`genericOAuthClient()`・`anonymousClient()`・`adminClient()`）
- Modify: `src/app/signin/page.tsx` とログインのフォームの部品（パスワード・SID・ゲストはクライアントから、デモは Server Action）
- Modify: `src/presentation/actions/auth-actions.ts`（`signInAsDemoAction` と `signOutAction` だけ残す）
- Modify: `src/presentation/components/layout/*`（GitHub のボタンと `github-mark.tsx` を消す）
- Delete: `src/application/identity/sign-in.ts`、`src/composition/sign-in-container.ts`、`src/infrastructure/auth/{github-oauth*,sid-oauth,sid-oidc-client,sid-logout,session-token,session-cookies,web-session,oauth-http}.ts`、`src/infrastructure/prisma/{session-store,sign-in-throttle-store,sid-account-store,identity-accounts}.ts`、`src/domain/identity/{sign-in-throttle,sid-account}.ts`、`src/app/api/auth/callback/**`、`src/presentation/http/{github-callback,sid-callback}.ts` と、それぞれのテスト。`jose` を他で使っていなければ依存から外す。
- Modify: `e2e/fixtures/sid-oidc-stub.ts`（`/.well-known/openid-configuration` を足す。`end_session_endpoint` は `/oauth/logout`）、`e2e/server.ts`（`redirectUri` を `/api/auth/oauth2/callback/sid`、`BETTER_AUTH_SECRET`・`DEMO_PASSWORD` を渡す）、`e2e/environment.ts`（`sessionCookieName` を `better-auth.session_token`）、`e2e/fixtures.ts`（`asAdmin` は SID のスタブの利用者を admin にして SID のボタンで入る。`createMember` は `user` と `account` を入れる）
- Modify: `e2e/session.spec.ts`、`e2e/sid-login.spec.ts`、`e2e/security.spec.ts`
- Modify: `.env.example`

**Interfaces:**

- Consumes: Task 2 の `auth`、Task 5 の `getCachedCurrentUser`。
- Produces: `export const authClient`（`auth-client.ts`）。e2e の `asAdmin(page)`・`asMember(page, loginId, password)`・`createMember(loginId, displayName, password)` の名前と引数は今のまま。
- エラーの文言：パスワードの失敗、レート制限（HTTP 429）とも、今の `/signin` の文言（`passwordFailureUrl` のもの）をそのまま出す。

- [ ] **Step 1: e2e を新しい流れに直す（失敗する状態）**

`session.spec.ts`：`a-b.c` と 32 文字の ID の会員がログインできる、間違ったパスワードで今の文言が出る、21 回目の試行で同じ文言のまま通らない、ゲストで入ると練習だけ見える、ログアウトでログイン画面に戻る。`sid-login.spec.ts`：SID で初めて入ると会員になる、ログアウトでスタブの `/oauth/logout` が 1 回呼ばれる。

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm run test:e2e -- session.spec.ts sid-login.spec.ts`
Expected: FAIL

- [ ] **Step 3: 画面とスタブを実装し、古いコードを消す**

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:unit && pnpm run test:e2e -- session.spec.ts sid-login.spec.ts security.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: ログイン画面とログアウトを Better Auth に載せ替える"
```

### Task 7: 管理者の機能・なりすまし・自分のパスワード

**Files:**

- Modify: `src/application/identity/member-accounts.ts`、`src/composition/identity-container.ts`、`src/presentation/actions/password-account-actions.ts`、`src/app/admin/accounts/page.tsx`（`auth.api.createUser`・`listUsers`・`setUserPassword`・`revokeUserSessions`）
- Modify: `src/presentation/actions/acting-actions.ts`（`auth.api.impersonateUser`・`stopImpersonating`）、`acting-banner.tsx`、`record-owner-switcher.tsx`
- Modify: `src/app/account/line/page.tsx`、`src/presentation/actions/line-link-actions.ts`
- Modify: `src/application/identity/own-password.ts` と `change-password-form.tsx`（`authClient.changePassword({ revokeOtherSessions: true })`）
- Modify: `src/app/admin/ai-usage/page.tsx` と `ai-usage-store.ts`（なりすまし中の利用は会員に数える。`actorId` を消す）
- Delete: `src/domain/identity/member-account.ts` の `sessionVersion` まわり、`zl_act_as` の読み書き
- Test: `tests/member-accounts.test.ts`、`tests/line-link.test.ts`、`e2e/accounts.spec.ts`、`e2e/act-as.spec.ts`、`e2e/line.spec.ts`

**Interfaces:**

- Consumes: Task 2 の `auth`・`memberEmail`、Task 5 の `AuthenticatedUser.impersonatedBy`。
- Produces: `export function lineLinkAllowed(user: AuthenticatedUser): boolean`（`role !== "guest" && !user.demo && !user.impersonatedBy`）。

- [ ] **Step 1: 失敗するテストを書く**

単体：`lineLinkAllowed` は `impersonatedBy` があると false、ほかの会員は true、デモ・ゲストは false。`createMember` は `username` を `normalizeLoginId` で検査し、`email` に `memberEmail` を渡す（偽の `auth.api` で呼ばれた引数を確かめる）。e2e：管理者が会員を作り、その会員でログインできる。管理者がその会員のパスワードを再設定すると、会員の別のコンテキストは次の操作でログイン画面に戻る。管理者が会員になりすますとバナーが出て、会員のノートが見え、管理画面には入れず、「戻る」で管理者に戻る。なりすまし中に `/account/line` を開くと `/` に戻る。管理者が自分の画面からゲストの `user` になりすます要求を `/api/auth/admin/impersonate-user` に送ると 403。会員が自分のパスワードを変えると、別のコンテキストはログイン画面に戻る。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/member-accounts.test.ts tests/line-link.test.ts && pnpm run test:e2e -- accounts.spec.ts act-as.spec.ts line.spec.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:unit && pnpm run test:e2e -- accounts.spec.ts act-as.spec.ts line.spec.ts ai-usage.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 会員の管理となりすましを Better Auth の admin プラグインに替える"
```

### Task 8: デモとゲストの片付け

**Files:**

- Modify: `src/presentation/actions/auth-actions.ts`（`signInAsDemoAction`：`auth.api.signInUsername({ body: { username: demoLoginId, password: demoPassword }, headers })`）
- Modify: `src/infrastructure/prisma/demo-reset-store.ts`、`src/application/demo/*`（デモの `account.password` を `hashPassword(DEMO_PASSWORD)` に入れ直す。作ってから 24 時間を過ぎた `isAnonymous` の `user` を消す）
- Delete: `src/domain/identity/demo-account.ts`（`DEMO_PASSWORD_HASH`）
- Test: `tests/demo-reset-store.test.ts`、`e2e/demo.spec.ts`

**Interfaces:**

- Consumes: Task 2 の `demoPassword()`・`rejectsDemoPasswordChange`、`hashPassword`。
- Produces: `deleteStaleGuestsSql(now: Date)`（`demo-reset-store.ts`。`"isAnonymous" = true AND "createdAt" < now - interval '24 hours'`）。

- [ ] **Step 1: 失敗するテストを書く**

単体：デモのリセットが `account` の `password` を書く SQL に、`hashPassword` の結果が渡る。`deleteStaleGuestsSql` が 24 時間の条件を持つ。e2e：デモのボタンで入れる。デモのまま `fetch("/api/auth/update-user", { method: "POST", body: JSON.stringify({ name: "x", username: "x" }) })` が 404、`/api/auth/change-password` が 403 で、もう一度デモのボタンで入れて名前が変わっていない。`DEMO_PASSWORD` が無いとデモのボタンが出ない。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --import tsx --test tests/demo-reset-store.test.ts && pnpm run test:e2e -- demo.spec.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm run test:unit && pnpm run test:e2e -- demo.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: デモを DEMO_PASSWORD で入るようにし、古いゲストを毎日消す"
```

### Task 9: 文書と全体の回帰

**Files:**

- Modify: `docs/architecture.md`（「4. 認証」と、ファイルの表、守っている決まり）、`docs/deployment.md`（環境変数、運用上の注意の `DELETE FROM "session"`、「移行の記録」に Better Auth の切り替えの手順）、`docs/development.md`（ローカルで管理者になる方法：SID のスタブ、または `UPDATE "user" SET role='admin'`）、`.env.example`、`README.md` のログインの説明

**切り替えの手順（`deployment.md` に書く。本番はこの順）**

1. ID サーバーの Zhuelog のクライアントに `redirect_uri` `<AUTH_URL>/api/auth/oauth2/callback/sid` と `post_logout_redirect_uri` を足す。
2. Vercel の Production に `BETTER_AUTH_SECRET`・`DEMO_PASSWORD` を入れる。
3. 本番の DB に `pnpm run auth:prepare-admin -- --github-id <今の AUTH_ALLOWED_GITHUB_IDS> --sid-sub <自分の sub> --email <SID のアドレス> --name <表示名>`。
4. マージ（本番のビルドがマイグレーションを当てる。止まったらデプロイは失敗し、前の版のまま）。
5. `/api/cron/demo-reset` を `CRON_SECRET` で 1 回呼ぶ（デモのパスワードを入れる）。
6. 管理者が SID で入って管理画面を開く。会員の 1 人で入ってノートを見る。
7. GitHub の OAuth App と、`AUTH_GITHUB_ID`・`GITHUB_WEB_CLIENT_SECRET`・`AUTH_ALLOWED_GITHUB_IDS` を消す。

- [ ] **Step 1: 文書を書き換える**

- [ ] **Step 2: 古い名前が残っていないことを確かめる**

Run: `grep -rnE "zl_session|zl_act_as|AUTH_ALLOWED_GITHUB_IDS|SignInThrottle|PasswordAccount|SidAccount|githubId|password:" src docs/architecture.md docs/development.md .env.example | grep -v "docs/superpowers"`
Expected: 出力なし（`docs/deployment.md` の「移行の記録」の過去の段階は除く）

- [ ] **Step 3: 全体の回帰**

Run: `pnpm run test:regression && pnpm run test:migration`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: Better Auth への切り替えを文書に書く"
```
