# Go 廃止 段階 0（土台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js が Go の `GET /v1/me` に頼らず、`zl_access` の JWT を自分で確かめ、Prisma で DB を読んで「ログイン中の人」を決められるようにする。段階 1 以降は、この上に機能を移していく。

**Architecture:** `CurrentUserProvider` の実装を、Go に聞く `GoApiCurrentUserProvider` から、新しい `TokenCurrentUserProvider` に差し替える。新しい実装は、JWT の検証（`node:crypto` の HS256）とアカウントの読み取り（Prisma）を、依存として受け取る。「メンバーとして見る」（`confirmedActAs`）も、この結果から決める。ほかの Go への呼び出し（`goApiAuthed`）とログイン・トークンの更新は、まだ Go のまま。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7（`src/generated/prisma`、`@prisma/adapter-pg`）、`node:test` + `tsx`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（決めたこと 4・5・7、段階 0、「動いている Go の止め方」）

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API を確かめる（`AGENTS.md`）。
- コメントは英語。ログや画面の文言は、今のものを変えない。
- 依存を増やさない（JWT は `node:crypto` で確かめる）。
- JWT の値は Go と同じにする：`alg` は `HS256` だけ、`iss` = `ffpf-zhuelog-api`、`aud` = `ffpf-zhuelog-mobile`、`exp` は必須、`iat` は必須で未来の時刻は拒否、`sub` は空でない。
- 役割ごとの決まり（Go の `auth/token.go` の `Verify` と同じ）：`admin` は `login` が必須。`member` は `sv` が 0 以上の整数で必須。`guest` は `sub` が `guest` に限る。それ以外の `role` は拒否する。
- `API_JWT_SECRET` は 32 バイト以上。足りないときは、トークンをすべて無効として扱う。
- `AUTH_ALLOWED_GITHUB_IDS` は、カンマで区切り、前後の空白を取り、`^[0-9]+$` に合うものだけを使う。空なら管理者は誰も通らない。
- 「メンバーとして見る」の相手は `^password:[a-z0-9]{1,64}$` に合い、実在する `PasswordAccount` に限る。
- デモのアカウントの判定：`passwordHash === "demo:no-password"`、または `DEMO_LOGIN_ID` が設定されていて `loginId` がそれと同じ。
- テストの実行：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps` で、ほかの run がないか確かめる）。
- `git commit` はサンドボックスの中では失敗する（lefthook と pnpm）。サンドボックスを外して実行する。

## Review Focus

1. **パスワードを変えた会員の、古いトークン。** `sv` が DB の `sessionVersion` と違えば、ログインしていない扱い（`null`）にする。→ Task 2 のテスト `a member whose sessionVersion moved on is signed out`。
2. **許可リストから外された管理者。** 署名が正しくても `role: "revoked"` を返す（今の 403 の扱いと同じ）。→ Task 2 のテスト `an admin no longer on the allowlist is revoked`。
3. **形のおかしい・消えた会員への「メンバーとして見る」。** 自分のデータを、その会員のものと取り違えないよう、`actAsIgnored: true` の管理者本人として返す。→ Task 2 のテスト `act-as a malformed or missing member is ignored`。
4. **期限切れ・別の秘密鍵・`alg: none`・`aud` 違いのトークン。** すべて `null` にする。→ Task 1 のテスト群。
5. **消された会員のトークン**（アカウントの行がない）。`null` にする。→ Task 2 のテスト `a member whose account is gone is signed out`。

---

### Task 1: アクセストークンの検証

**Files:**

- Create: `src/infrastructure/identity/access-token.ts`
- Test: `tests/access-token.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type AccessClaims =
    | { role: "admin"; ownerId: string; login: string }
    | { role: "member"; ownerId: string; sessionVersion: number }
    | { role: "guest"; ownerId: "guest" };
  export function verifyAccessToken(
    token: string,
    secret: string,
    now?: Date,
  ): AccessClaims | null;
  ```

- [ ] **Step 1: 失敗するテストを書く。** テストの中に、`node:crypto` の `createHmac` で HS256 のトークンを作る小さな `sign(header, payload, secret)` を置く。秘密鍵は 32 バイト以上。時刻は `now = new Date("2026-11-16T00:00:00Z")` で固定する。
  - `an admin token yields the owner id and login`：`{sub:"10001", role:"admin", login:"octocat", iss, aud:["ffpf-zhuelog-mobile"], iat, exp:iat+900}` → `{ role:"admin", ownerId:"10001", login:"octocat" }`
  - `a member token yields the session version`：`sv: 3`、`sub:"password:abc"` → `{ role:"member", ownerId:"password:abc", sessionVersion:3 }`
  - `aud as a plain string is accepted`：`aud:"ffpf-zhuelog-mobile"` でも通る。
  - `a guest token must have sub guest`：`sub:"guest"` は通り、`sub:"x"` は `null`。
  - `rejects`：次の 13 通りを 1 つずつ確かめ、すべて `null`。
    - `exp` が `now` 以前
    - `exp` がない
    - `iat` がない
    - `iat` が `now` より後
    - 別の秘密鍵で署名
    - `alg:"none"`（署名なし）
    - `alg:"HS512"`
    - `iss` 違い
    - `aud` 違い
    - `sub` が空
    - admin で `login` がない
    - member で `sv` が負、または小数、またはない
    - `role:"owner"`
  - `a short secret rejects every token`：31 バイトの秘密鍵 → `null`。
  - `malformed input is null, not a throw`：`""`、`"a.b"`、base64url でない部分 → `null`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/access-token.test.ts` → FAIL（モジュールが見つからない）。
- [ ] **Step 3: `verifyAccessToken` を実装する。** 署名は `createHmac("sha256", secret)` で `header.payload` から作り、`timingSafeEqual` で比べる（長さが違えば `null`）。時刻は秒で比べ、猶予（leeway）は付けない。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。
- [ ] **Step 5: コミット。** `feat(web): Go のアクセストークンを Next.js で確かめる`

### Task 2: トークンから「ログイン中の人」を決める

**Files:**

- Create: `src/infrastructure/identity/token-current-user-provider.ts`
- Test: `tests/token-current-user-provider.test.ts`
- Delete: `src/infrastructure/go-api/go-api-current-user-provider.ts`、`tests/go-api-current-user-provider.test.ts`（Task 4 の差し替えと同じコミットで消す。ここではまだ消さない）

**Interfaces:**

- Consumes: Task 1 の `AccessClaims`、`verifyAccessToken`。`CurrentUserProvider`・`AuthenticatedUser`（既存）。
- Produces:

  ```ts
  export type IdentityAccount = {
    id: string;
    loginId: string;
    displayName: string;
    passwordHash: string;
    sessionVersion: number;
  };
  export type FfpfIdentityAccount = {
    id: string;
    email: string;
    displayName: string;
    sessionVersion: number;
  };
  export interface IdentityAccounts {
    findPasswordAccount(id: string): Promise<IdentityAccount | null>;
    findFfpfAccount(id: string): Promise<FfpfIdentityAccount | null>;
  }
  export type TokenIdentityConfig = {
    allowedGitHubIds: ReadonlySet<string>;
    demoLoginId?: string;
  };
  export class TokenCurrentUserProvider implements CurrentUserProvider {
    constructor(
      readAccessToken: () => Promise<string | undefined>,
      readActAs: () => Promise<string | undefined>,
      verify: (token: string) => AccessClaims | null,
      accounts: IdentityAccounts,
      config: TokenIdentityConfig,
    );
    getCurrentUser(): Promise<AuthenticatedUser | null>;
  }
  ```

  `IdentityAccounts` はインフラの中のアダプタ同士の取り決めなので、このファイルに置く（`domain/*/repositories` には置かない）。

- [ ] **Step 1: 失敗するテストを書く。** `verify` は、決まった `AccessClaims` を返す偽物。`accounts` はメモリ上の偽物。返り値は、今の `GoApiCurrentUserProvider` と同じ形にする（`tests/go-api-current-user-provider.test.ts` の期待値を移す）。
  - `no cookie or an invalid token is signed out` → `null`
  - `an admin on the allowlist keeps the GitHub login and id` → `{ githubLogin:"octocat", githubId:"10001", role:"admin" }`
  - `an admin no longer on the allowlist is revoked` → `{ githubLogin:"", role:"revoked" }`
  - `a password member gets the profile and account id` → `{ githubLogin: loginId, githubId:"password:<id>", role:"member", displayName, accountId:id }`
  - `an FFPF ID member is shown by email` → `{ githubLogin: email, githubId:"ffpf:<sub>", role:"member", displayName }`（`accountId` はなし）
  - `a member whose sessionVersion moved on is signed out` → `null`
  - `a member whose account is gone is signed out` → `null`
  - `a member owner id with neither prefix is signed out`（例：`sub:"12345"` で role member）→ `null`
  - `the demo account is flagged`：`passwordHash:"demo:no-password"` のとき、`DEMO_LOGIN_ID` と同じ `loginId` のときの両方 → `demo: true`。どちらでもなければ `demo` のキーはない。
  - `a guest owns no records` → `{ githubLogin:"guest", role:"guest" }`
  - `an admin acts as an existing member` → `githubId` は会員の ownerId、`actingAs: { ownerId, loginId, displayName }`、`role:"admin"`
  - `act-as a malformed or missing member is ignored`：`"password:ABC"`、`"ffpf:x"`、ない会員 → 管理者本人で `actAsIgnored: true`
  - `act-as is ignored for members and guests` → 会員・ゲストは act-as の Cookie があっても、ふつうの結果（`actAsIgnored` はない）
  - `an admin off the allowlist is revoked even while acting` → `revoked`
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/token-current-user-provider.test.ts` → FAIL。
- [ ] **Step 3: `TokenCurrentUserProvider` を実装する。** 会員の ownerId は、`password:` か `ffpf:` の接頭辞で、どちらのテーブルを読むか決める（接頭辞の後が空なら `null`）。act-as の確かめは、許可リストを確かめた後に行う。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。
- [ ] **Step 5: コミット。** `feat(web): トークンと DB からログイン中の人を決める`

### Task 3: Prisma をつなぎ、アカウントを読む

**Files:**

- Create: `src/infrastructure/prisma/prisma-client.ts`
- Create: `src/infrastructure/prisma/identity-accounts.ts`
- Modify: `src/infrastructure/config/environment.ts`
- Test: `tests/identity-environment.test.ts`

**Interfaces:**

- Consumes: Task 2 の `IdentityAccounts`、`TokenIdentityConfig`。`prisma/postgres-connection.ts` の `securePostgresConnectionString`。
- Produces:

  ```ts
  // prisma-client.ts
  export function prisma(): PrismaClient; // one client per process; throws "DATABASE_URL is not set" without it
  // identity-accounts.ts
  export const prismaIdentityAccounts: IdentityAccounts;
  // environment.ts
  export function apiJwtSecret(): string; // API_JWT_SECRET; "" when unset
  export function allowedGitHubIds(): ReadonlySet<string>; // AUTH_ALLOWED_GITHUB_IDS parsed as in Global Constraints
  export function demoLoginId(): string | undefined; // DEMO_LOGIN_ID trimmed; undefined when empty
  ```

- [ ] **Step 1: 失敗するテストを書く。** `tests/identity-environment.test.ts` で `process.env` を書き換えて確かめる。
  - `allowedGitHubIds keeps only numeric ids`：`" 10001, abc ,2002,,"` → `{"10001","2002"}`
  - `allowedGitHubIds is empty when unset`
  - `demoLoginId is undefined when blank`：`"  "` → `undefined`
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/identity-environment.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `prisma()`：`new PrismaClient({ adapter: new PrismaPg({ connectionString: securePostgresConnectionString(url) }) })`。開発中のホットリロードで接続が増えないよう、`globalThis` に 1 つだけ持つ。
  - `prismaIdentityAccounts`：`passwordAccount.findUnique` と `ffpfAccount.findUnique` で、必要な列だけを `select` する。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドで PASS。`pnpm typecheck` も PASS。
- [ ] **Step 5: コミット。** `feat(web): Web から Prisma で DB を読めるようにする`

### Task 4: 差し替えと e2e

**Files:**

- Modify: `src/composition/identity-container.ts`（`GoApiCurrentUserProvider` を `TokenCurrentUserProvider` に替える）
- Modify: `src/infrastructure/go-api/act-as.ts`（`confirmedActAs` を、ログイン中の人の `actingAs?.ownerId` から決める。`fetchMeOnce` を消す）
- Modify: `e2e/server.ts`（Web の env に `API_JWT_SECRET: goJwtSecret()`、`AUTH_ALLOWED_GITHUB_IDS: "10001"`、`DEMO_LOGIN_ID: demoLoginId` を足す。`DATABASE_URL` のコメントを、Web も実行時に使う、に直す）
- Delete: `src/infrastructure/go-api/go-api-current-user-provider.ts`、`tests/go-api-current-user-provider.test.ts`

**Interfaces:**

- Consumes: Task 1〜3 のすべて。
- Produces: `getCurrentUser`・`getCurrentAdminUser` など、`identity-container.ts` の今の公開関数（名前と型は変えない）。`confirmedActAs(): Promise<string | undefined>`（今と同じ）。

- [ ] **Step 1: つなぎ替える。** `identity-container.ts` で次のように組み立て、今と同じく React の `cache()` で包む。
  ```ts
  new TokenCurrentUserProvider(
    readAccessToken,
    readActAsCookie,
    (t) => verifyAccessToken(t, apiJwtSecret()),
    prismaIdentityAccounts,
    { allowedGitHubIds: allowedGitHubIds(), demoLoginId: demoLoginId() },
  );
  ```
  `confirmedActAs` が `identity-container` を読み込むと循環するときは、`cache()` で包んだ取得関数を `src/composition/current-user.ts` に分け、両方からそれを使う。
- [ ] **Step 2: Go の `/v1/me` に頼る残りがないことを確かめる。** `grep -rn "fetchMeOnce\|GoApiCurrentUserProvider" src tests` → 何も出ない。
- [ ] **Step 3: unit・typecheck・lint を確かめる。** `pnpm typecheck && pnpm lint && pnpm test:unit` → すべて PASS。
- [ ] **Step 4: e2e を確かめる。** `docker ps` でほかの e2e がないことを確かめてから `pnpm test:e2e`。期待：全件 PASS。特に `act-as.spec.ts`・`go-session.spec.ts`・`accounts.spec.ts`（パスワード変更でログインが切れる）・`demo.spec.ts`・`security.spec.ts`。
- [ ] **Step 5: コミット。** `refactor(web): ログイン中の人を Go に聞かずに決める`

### Task 5: 環境変数とドキュメント、PR

**Files:**

- Modify: `.env.example`（Web にも `DATABASE_URL`〔実行時は Neon の pooled の URL〕、`API_JWT_SECRET`〔Go と同じ値〕、`AUTH_ALLOWED_GITHUB_IDS`、`DEMO_LOGIN_ID` が要る、と書く）
- Modify: `docs/api-deployment.md`（Web の Production と Preview の環境変数。Preview は本番と別の Neon ブランチと、別の `API_JWT_SECRET`。Preview のブランチのスキーマの合わせ方〔本番から作り直すか、そのブランチに向けて `prisma migrate deploy`〕）
- Modify: `docs/development.md`（ローカルで Web が DB と `API_JWT_SECRET` を使うこと）

- [ ] **Step 1: ドキュメントを直す。** 上の 3 つ。Web の本番の `DATABASE_URL` が direct の URL だったときの扱い（実行時用に pooled の値を別の変数で足す）も、`docs/api-deployment.md` に書く。
- [ ] **Step 2: 全体を確かめる。** `pnpm test:regression` → PASS（e2e を含む。Step 4 と同じく、ほかの run がないことを先に確かめる）。
- [ ] **Step 3: コミット。** `docs: Web が DB と JWT の秘密鍵を使うことを書く`
- [ ] **Step 4: PR を作る。** 説明は日本語。次の 3 つを書く。
  - 「Go ではどこで何をしていたか → TypeScript ではどのファイルか」の対応表（例：`auth/token.go` の `Verify` → `access-token.ts`、`auth/session.go` の `checkCurrent` と `auth/me.go` の `Me`・`ActAs` → `token-current-user-provider.ts`）
  - **マージの前に利用者が行うこと**
    - Web の Production に `API_JWT_SECRET`（Go と同じ値）・`AUTH_ALLOWED_GITHUB_IDS`・`DEMO_LOGIN_ID` を入れる。`DATABASE_URL` が pooled かを確かめる。
    - Web の Preview に、別の Neon ブランチの `DATABASE_URL` と、別の `API_JWT_SECRET` を入れる。
  - デプロイの手順（ローカルのテストが通ってから Vercel CLI で出す。出す前に利用者に確かめる）

---

## 段階 1 からの進め方（このあとの計画）

段階 1〜12 は、設計書の順番どおり、段階ごとに `docs/superpowers/plans/2026-11-16-deprecate-go-stage<N>-<機能>.md` として、そこに着いたときに書く。どの段階の計画にも、次のことを入れる。

- 移す Go のハンドラ・store・テストと、そこから TypeScript に移す確かめごとの一覧
- `notForDemo` だった操作は、TypeScript でもデモのアカウントに閉じる
- 管理者の `?user=` での読み取りと「メンバーとして見る」の扱い（`resolveRecordOwner`・`TokenCurrentUserProvider` の `actingAs`）
- 同じ PR で消す Go のコードと Web の Go アダプタ。消したあとに Go を出し直す手順
