# Sparklingstadt ID ログイン（zhuelog） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** zhuelog の「FFPF ID でログイン」を「Sparklingstadt ID でログイン」に置き換え、ログアウトで ID サーバーのログインも消す。

**Architecture:** 通信のやり取り（issuer からのエンドポイント、ES256、PKCE、nonce）は変えず、名前（表・持ち主の ID・環境変数・callback・画面・識別子・ファイル名）だけを置き換える。そのあと、`sid:` の人のログアウトに ID サーバーの `/oauth/logout` への転送を足す。

**Tech Stack:** Next.js 16.4.6、Prisma 7、Postgres、`node --test`（`pnpm run test:unit`）、Playwright（`pnpm run test:e2e`、Docker の Postgres と OIDC のスタブ）。

**Spec:** `docs/superpowers/specs/2026-11-22-sparklingstadt-id-login-design.md`

## Global Constraints

- 置き換えの表は Spec の「決めたこと」のとおり：`FfpfAccount`→`SidAccount`、`ffpf:`→`sid:`、`^sid:[a-z0-9]{1,64}$`、`SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET`、`/api/auth/callback/sid`、`provider: "sid"`、「Sparklingstadt ID でログイン」、`<issuer>/account`。
- リポジトリ名・ドメイン・パッケージ名としての `ffpf-zhuelog`（`@ffpf-zhuelog/web`、`ffpf-zhuelog.sparklingstadt.com` など）は変えない。`docs/superpowers/` の過去の文書と、過去のマイグレーション（`prisma/migrations/2026…` の既存のフォルダー）の中身は変えない。
- 通信のやり取りと、ほかの 4 つのログインの動きは変えない。
- AGENTS.md：Next.js のコードを書く前に `node_modules/next/dist/docs/` の該当ページを読む。
- E2E は一度に 1 本だけ（compose の名前とポートが固定）。走らせる前に `docker ps` で、ほかの E2E が動いていないことを確かめる。

## Review Focus

1. **古い Cookie**：`zl_oauth` に `provider: "ffpf"` が残った状態で `/api/auth/callback/sid` に来ても、ログインさせずにログイン画面へ戻す（Task 1 の `parseSidOAuthCookie` のテスト）。
2. **古いセッション**：`ownerId` が `ffpf:…` のセッションの Cookie を持って来ても、ログイン中として扱わない（マイグレーションで消えるが、`isOwnerId("ffpf:abc")` が `false` であることを Task 1 でテストする）。
3. **設定が片方だけ**：`SID_*` が無く古い `FFPF_ID_*` だけがある環境では、ボタンを出さない（Task 1 の環境変数のテスト）。
4. **`sid:` 以外の人のログアウト**：パスワード会員・ゲスト・管理者は、`SID_*` がそろっていても ID サーバーへ送らない（Task 2 のテスト）。
5. **設定なしでの `sid:` のログアウト**：`SID_*` が欠けていても、`/signin` へ戻って終わる（Task 2 のテスト）。

---

### Task 1: 名前の置き換えと、マイグレーション

**Files:**

- Rename（`git mv`）：`src/**/ffpf-*.ts`・`tests/ffpf-*.test.ts`・`e2e/ffpf-login.spec.ts`・`e2e/fixtures/ffpf-oidc-stub.ts`・`src/app/api/auth/callback/ffpf/` → `sid-*`・`…/callback/sid/`
- Modify：`git grep -il ffpf -- src tests e2e scripts prisma/schema.prisma` に出るファイル（リポジトリ名としての `ffpf-zhuelog` だけを含む行は除く）
- Create：`prisma/migrations/<timestamp>_replace_ffpf_accounts_with_sid_accounts/migration.sql`

**Interfaces:**

- Produces（Task 2 が使う）：`sidConfig(): { issuer: string; clientId: string; clientSecret: string } | null`（`src/infrastructure/config/environment.ts`、今の `ffpfIdConfig` の名前を変えたもの）、`SID_OWNER_PREFIX = "sid:"`（`src/domain/identity/owner-id.ts`）。

- [ ] **Step 1: 失敗するテストを書く**（既存のテストファイルに足す。名前はファイルの流儀に合わせる）
  - `isOwnerId("sid:abc123")` は `true`、`isOwnerId("ffpf:abc123")` は `false`。
  - `SID_ISSUER`・`SID_CLIENT_ID`・`SID_CLIENT_SECRET` がそろうと `sidConfig()` が値を返す。`FFPF_ID_*` の 3 つだけがあるときは `null`。
  - `parseSidOAuthCookie` は `provider: "sid"` の値を返し、`provider: "ffpf"` の値には `null` を返す。
  - `sidRedirectUri("https://x.example")` は `"https://x.example/api/auth/callback/sid"`。
- [ ] **Step 2:** `pnpm run test:unit` → 新しいテストが FAIL（名前がまだ無い）。
- [ ] **Step 3:** ファイルを `git mv` し、識別子・文字列・コメント・画面の文言を Global Constraints のとおりに置き換える。SQL の中の `'ffpf:' || f."id"` と `"FfpfAccount"` も置き換える。`prisma/schema.prisma` のモデルを `SidAccount` にする。
- [ ] **Step 4:** マイグレーションを書く。`CREATE TABLE "SidAccount"`（`FfpfAccount` と同じ列・同じ制約）、Spec の「データ」に挙げた表から `ffpf:` で始まる持ち主の行を消す（`Follow` は `followerId`・`followeeId` のどちらでも。`Hint` と `ImportBatch` は、スキーマの関係をたどって、`ffpf:` の持ち主の `LearningEntry` にひもづくものを消す）、`DROP TABLE "FfpfAccount"`。`Session` に CHECK 制約などがあれば、それに合う形にする。
- [ ] **Step 5:** `pnpm run db:generate`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test:unit` → すべて PASS。
- [ ] **Step 6:** E2E のスタブ（`e2e/fixtures/sid-oidc-stub.ts`）と `e2e/server.ts`・`e2e/environment.ts` が `SID_*` を渡すことを確かめ、`pnpm run build && pnpm run test:e2e` → PASS。
- [ ] **Step 7:** `git grep -il ffpf -- src tests e2e scripts prisma/schema.prisma` の残りが、リポジトリ名・ドメイン・パッケージ名としての `ffpf-zhuelog` だけであることを確かめ、その一覧を報告に書く。
- [ ] **Step 8:** Commit `feat(auth): FFPF ID のログインを Sparklingstadt ID に置き換える`

### Task 2: ログアウトで ID サーバーにも知らせる

**Files:**

- Create：`src/infrastructure/auth/sid-logout.ts`
- Modify：`src/composition/identity-container.ts`（`signOutCurrentUser`）、必要なら `src/infrastructure/security/content-security-policy.ts`／`src/proxy.ts`（Server Action からの転送先が CSP で止まる場合だけ）
- Test：`tests/sid-logout.test.ts`、`e2e/sid-login.spec.ts`、`e2e/fixtures/sid-oidc-stub.ts`

**Interfaces:**

- Consumes：`sidConfig()`、`SID_OWNER_PREFIX`（Task 1）。
- Produces：`sidLogoutUrl(input: { ownerId: string | null; config: { issuer: string; clientId: string } | null; origin: string }): string | null` — ID サーバーへ送る URL か、送らないなら `null`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/sid-logout.test.ts`：
  - `ownerId: "sid:abc"`、`config: { issuer: "https://id.example", clientId: "zhuelog" }`、`origin: "https://z.example"` → `"https://id.example/oauth/logout?client_id=zhuelog&post_logout_redirect_uri=https%3A%2F%2Fz.example%2Fsignin"`
  - `ownerId` が `"password:abc…"`、`"12345"`（管理者）、ゲストの ID、`null` → `null`
  - `config: null` → `null`
- [ ] **Step 2:** `pnpm run test:unit` → FAIL。
- [ ] **Step 3:** `sidLogoutUrl` を実装する。`signOutCurrentUser` は、セッションを消す**前に**今の持ち主の ID を読み、セッションと Cookie を消してから、`sidLogoutUrl(...) ?? "/signin"` へ `redirect` する。`origin` は、callback の `redirect_uri` を決めるのと同じ規則（`AUTH_URL` の origin）で決める。なりすまし中（管理者が会員として操作）のときは、管理者自身の ID で判断する。
- [ ] **Step 4:** E2E：スタブに `GET /oauth/logout`（`post_logout_redirect_uri` へ 302 で戻し、呼ばれた回数と引数を覚える）を足す。`e2e/sid-login.spec.ts` に「Sparklingstadt ID でログインした人がログアウトすると、スタブの `/oauth/logout` を `client_id` と `post_logout_redirect_uri=<origin>/signin` 付きで通り、`/signin` に戻り、`zl_session` が消えている」と、「パスワード会員のログアウトは、スタブの `/oauth/logout` を通らない」を足す。
- [ ] **Step 5:** `pnpm run test:unit`、`pnpm run build && pnpm run test:e2e` → PASS。
- [ ] **Step 6:** Commit `feat(auth): Sparklingstadt ID の人のログアウトで ID サーバーのログインも消す`

### Task 3: 文書

**Files:** Modify：`docs/deployment.md`、`docs/features.md`、`README.md`、`.env.example`

- [ ] **Step 1:** `docs/deployment.md`：環境変数の表と「5. FFPF ID でのログイン」を Sparklingstadt ID に書き直す（issuer は `https://id.sparklingstadt.com`、クライアントの登録は sparklingstadt-id の `pnpm run oidc:client zhuelog`、`redirectUris` に `<origin>/api/auth/callback/sid`、`postLogoutRedirectUris` に `<origin>/signin`、ログアウトの動き、マイグレーションで `ffpf:` のデータが消えること）。Go の時代の経緯として FFPF ID に触れている節（移行の手順の記録）は、過去の記録なので文面を変えず、冒頭に「今は Sparklingstadt ID に置き換えた」と 1 行足す。
- [ ] **Step 2:** `docs/features.md`・`README.md`・`.env.example` の FFPF ID を Sparklingstadt ID と `SID_*` に直す。
- [ ] **Step 3:** `pnpm run format:check` → PASS。`git grep -n "FFPF ID\|FFPF_ID" -- README.md docs/deployment.md docs/features.md .env.example` の残りが、Step 1 で残すと決めた過去の記録だけであることを確かめる。
- [ ] **Step 4:** Commit `docs: ログインの説明を Sparklingstadt ID に直す`
