# Go 廃止 段階 11a（`Session` の表と、Web が自分でログインするための部品）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 決めたこと 6 のセッション（乱数のトークン、DB の `Session` 表にはハッシュだけ、httpOnly の Cookie）と、Web が Go なしでログインするための部品（パスワード・ゲスト・デモ・GitHub・FFPF ID のログインのユースケース、GitHub と FFPF ID の OAuth のクライアント、セッションの保存）を足す。**この PR では、どの画面からもまだ使わない。** ログインは Go のまま、ログイン中の人の見分け方も今のまま（`zl_access`）。本番に入るのは `Session` の表（追加だけ）と、パスワードの変更・再設定でその人のセッションを消す処理（表が空なので何も起きない）だけ。切り替えは 11b。

**Architecture:**

- 決まり（長さ、行の形、回数の制限の数とキー、FFPF ID の表示名）は `src/domain/identity/` の純粋な関数と定数にする。
- ログインの順番（回数の制限 → 入力 → アカウント → パスワード → セッション）は `src/application/identity/sign-in.ts` の `createSignIn(deps)` に置く。依存はすべて引数（今の `own-password.ts` と同じ形）。
- 乱数・ハッシュ・HTTP・Prisma は `src/infrastructure/` に置く。
  - トークン：`auth/session-token.ts`
  - セッションの保存：`prisma/session-store.ts`
  - GitHub：`auth/github-oauth-client.ts`
  - FFPF ID：`auth/ffpf-oidc-client.ts`
  - 共通の HTTP の道具：`auth/oauth-http.ts`
- 組み立て（composition）と画面への配線は 11b。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7（新しいモデルとマイグレーション、interactive transaction、`$executeRaw`）、`node:crypto`（`randomBytes`、`createHash`、`createPublicKey`、`verify`、`ECDH.convertKey`）、`fetch`、`node:test` + `tsx`。依存は増やさない（`jose` などは入れない）。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 11、決めたこと 5・6、各 PR の共通の進め方）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage11-go-reference.md`（以下「参照」）。この計画で使うのは §1〜§3、§5〜§9、§12、§15。

**後の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage11b-switch.md`（この PR の上に重ねる別の PR）。

## 設計者の判断（コントローラーが確かめること）

1. **段階 11 を 2 つの PR に分ける。11a は部品だけで、どこからも呼ばない。**
   - 仕事は、表・セッション・5 つのログイン・2 つの OAuth・現在の利用者・Proxy・Go の削除・e2e・文書と 9 つ以上あり、1 つの PR では利用者が追えない。
   - 11a は、マージしても動きが変わらない。マイグレーションは表を足すだけで、今の Go と両立する（`docs/api-deployment.md` の「マイグレーションの制約」）。
   - 11b は、11a の部品をつなぎ、Go のログインを消す。切り替えは 11b の 1 回だけにする。両方のセッションを同時に受け付ける途中の形は作らない。読む人が追う分岐が増えるだけで、どのみち 11b で全員がログインし直すため。
2. **`Session` の表の形。**
   - `id`（cuid）、`tokenHash`（unique）、`ownerId`、`role`、`login`（管理者だけ）、`sessionVersion`（会員だけ）、`expiresAt`、`createdAt`。索引は `ownerId`（その人のセッションをまとめて消す）と `expiresAt`（掃除）。
   - 役割ごとの形は、マイグレーションの `CHECK` でも縛る（`LineLink_role_check` と同じやり方）。管理者は `login` があり `sessionVersion` が無い。会員は `login` が無く `sessionVersion >= 0`。ゲストは `ownerId = 'guest'` で、どちらも無い。
   - 行の役割・`login`・`sessionVersion` は、Go の refresh token の行（`ApiRefreshToken`）と同じ。そのため、毎回の確かめ（参照 §4）を今と同じ形で書ける。
3. **トークンは 32 バイトの `crypto.randomBytes` を base64url（43 文字）にし、DB には SHA-256 の小文字の 16 進だけを置く。**
   - Go の refresh token（参照 §3）と同じ強さと形にする。256 ビットあるので、ハッシュは速いもの（SHA-256）でよく、塩も要らない。DB が漏れてもトークンは作れない。
   - Cookie の値が `^[A-Za-z0-9_-]{43}$` でなければ、DB を読まずに「ログインしていない」にする。
4. **長さは固定にする（30 日、ゲストは 24 時間）。使っていても延ばさない。**
   - 今の Go は refresh のたびに 30 日を延ばすので、使い続ける人は切れない（参照 §3）。延ばすには、Cookie を書き直せる所（Proxy・Server Action・Route Handler）で毎回 DB を書く必要がある。Next.js の案内は、Proxy では Cookie だけを見て DB にさわらないことを勧めている（参照 §11.5）。
   - 仕様（決めたこと 6）は「ふつうのセッションが 30 日」と決めている。いちばん追いやすい「ログインから 30 日で切れる」にする。
   - 変わる点：毎日使う人も、30 日に 1 度ログインし直す。利用者が延ばしたいと決めたら、別の PR で足す。
5. **失効は 3 通りで、`sessionVersion` の確かめも残す。**
   - ログアウトでは、その行を消す（11b）。
   - パスワードの変更と管理者による再設定では、`sessionVersion` を上げる `UPDATE` と、その持ち主（`password:<id>`）の `Session` をすべて消す `deleteMany` を、1 つの interactive transaction で行う（この PR の Task 1）。
   - 管理者は、毎回 `AUTH_ALLOWED_GITHUB_IDS` を確かめる（11b。今と同じ）。
   - `sessionVersion` を行に持ち、毎回アカウントの今の値と比べるのは、決めたこと 5 を保つための守り。ログインの途中（パスワードを確かめたあと、行を入れる前）に変更が入っても、古い版の行は通らない。FFPF ID のアカウントの `sessionVersion` を上げる処理はアプリに無いが、DB で上げれば今と同じく効く。
6. **期限切れの行は、ログインのたびに掃除する。cron は足さない。**
   - 今の 2 つの cron（LINE の拾い直し、デモのリセット）は、LINE やデモを設定したときだけ動く。それに相乗りすると、設定しだいで掃除が止まる。掃除だけの cron を足すこともできる（Hobby の Cron は 100 個まで、どれも 1 日 1 回）が、ログインのたびに掃除すれば、別の仕事を足さずに済む。
   - ログインごとに、期限切れの行を最大 100 行消す（`DELETE … WHERE "id" IN (SELECT "id" … WHERE "expiresAt" <= now LIMIT 100 FOR UPDATE SKIP LOCKED)`）。`SignInThrottle` の掃除（`pruneThrottleSql`）と同じ形。
   - ゲストは 1 分に 10 回（1 つの IP から）までしか作れない。1 回の掃除で 100 行消えるので、期限切れの行がたまり続けることはない。
7. **ログインの決まりは、Go の数・キー・順番をそのまま使う（参照 §2・§5・§7）。**
   - どのログインも、最初に `route:auth:<client>` を 1 分に 10 回で数える（`AUTH_ROUTE_THROTTLE`）。対象はパスワード・ゲスト・デモ・GitHub と FFPF ID のコールバック。ログアウトと OAuth の開始は数えない。ログアウトは、いつでも Cookie を消せるべきなため。OAuth の開始は、DB にも外にもさわらないため。
   - パスワード：`client:<client>` 15 分に 20 回 → 入力の形 → `login:<client>:<loginId>` 15 分に 5 回 → アカウント → scrypt。成功で `login:` のキーだけを消す。
   - 失敗は、どれも scrypt をちょうど 1 回だけ使い、同じ答え（`invalid`）にする。パスワードは最初の 128 コードポイントまでしか scrypt に渡さない。
   - デモ：`demo:<client>` 15 分に 20 回。アカウントが無い・ハッシュが `demo:no-password` でないときは `demo-unavailable`。
   - キーと数を変えないので、今 `SignInThrottle` にある Go の数え（同じ IP からの回数）は、そのまま 11b に引き継がれる。
8. **scrypt は段階 9b の `ScryptPasswordHasher`（`verify`・`simulate`、golden ファイル）を使い、`warm()` を足す。**
   - 9b は、ダミーのハッシュを最初の `simulate` で作る。そのため、インスタンスの最初の「無い ID」のログインだけ、scrypt が 1 回多くかかり、時間で ID の有無が分かりうる。
   - Go は起動時に `Warm` していた（参照 §5）。Web も、11b でログインの入れ物を読み込んだときに `warm()` を呼ぶ。この PR では `warm()` を足し、テストで確かめる。
9. **GitHub は Web の OAuth App だけを使い、管理者だけを通す（参照 §8）。**
   - モバイル用のアプリ（`GITHUB_MOBILE_*`）は作られていないので、持ってこない（仕様の決めたこと 2）。
   - `redirect_uri` は、開始とコールバックの両方で同じ関数（`AUTH_URL` から作る。今の `githubRedirectUri`）で作る。Go のような「設定値と完全一致」の確かめは要らない。GitHub と FFPF ID は、登録した URL にしか戻さない。
   - 管理者は、数字の ID が許可リストにあるかで決める。`login` は表示のためだけに持つ。
10. **FFPF ID の ID トークンの確かめは、Go を 1 つずつ移す（参照 §9）。依存は足さず、`node:crypto` で ES256 を確かめる。**
    - 確かめる順番と理由の語は、Go のテストの表（`TestFFPFExchangeRejectsIDToken`）と同じにする。
    - JWKS は 10 分、クライアントのオブジェクトの中に持つ。11b でモジュールに 1 つだけ作るので、インスタンスごとに 1 つになる（Go のプロセスごとと同じ）。
    - 点が曲線の上にあることは `crypto.ECDH.convertKey(…, "prime256v1")` で確かめる（`createPublicKey` だけに頼らない）。
11. **秘密の値の名前。**
    - GitHub の Client Secret は、Web では `GITHUB_WEB_CLIENT_SECRET`（Go と同じ名前・同じ値）とする。`AUTH_GITHUB_SECRET` は使わない。Auth.js の時代の古い値が Web の Vercel に残っているかもしれず（`docs/api-deployment.md` の「6. Web の設定」）、それを黙って使うと GitHub のログインが分かりにくい形で失敗するため。Client ID は今の `AUTH_GITHUB_ID` のまま。
    - FFPF ID は `FFPF_ID_CLIENT_SECRET`（Go と同じ）。
    - この PR は、2 つを読む関数を足すだけ。ボタンの出し分けは 11b で変える。
12. **e2e は 11b で行う。** この PR の部品は、まだ画面から届かないため。GitHub の偽のサーバーは e2e に足さない。今も e2e は GitHub のログインを最後まで通しておらず（参照 §13）、偽のサーバーを使うには、トークンの URL を環境変数で差し替える口が要る。その口は本番で悪用されうる。GitHub のクライアントは、偽の `fetch` を使う unit テストで Go のテストをすべて移す。FFPF ID は、今の e2e の偽のサーバーで 11b に確かめる。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` を確かめる（`AGENTS.md`）。この PR は Next.js の API を使わないが、11b の形を決めるのに読む：`01-app/02-guides/authentication.md`（Session Management、Optimistic checks with Proxy）、`01-app/03-api-reference/04-functions/cookies.md`。
- コメントは英語。画面の文言は変えない。依存を増やさない。
- 層：
  - `src/domain/` は domain のほかを import しない。
  - `src/application/` は domain だけを import し、`console` を使わない。
  - Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`node:crypto` は `src/infrastructure/` だけ。
- SQL はタグ付きテンプレートだけ。時刻は `CAST(${now} AS TIMESTAMP(3))`。持ち主の書き込みは影響した行の数で決める。interactive transaction は `{ maxWait, timeout }` を明示する。
- ログには、トークン・トークンのハッシュ・認可コード・verifier・nonce・state・Client Secret・パスワード・ログイン ID・メールアドレス・owner ID を出さない。出すのは決まったコードと、決まった語（Go の `reason`）、HTTP の状態、`loggableOAuthErrorCode` を通した OAuth のエラーコード、エラーの名前だけ。
- 数（参照）：
  - トークンは 32 バイトで、43 文字。
  - 長さは 2_592_000 秒、ゲストは 86_400 秒。
  - `route:auth:` は 60 秒に 10 回。`client:` と `demo:` は 900 秒に 20 回。`login:` は 900 秒に 5 回。
  - パスワードは 128 コードポイントまで。表示名は 50 コードポイントまで。
  - HTTP は 10 秒・1 MiB。JWKS は 600 秒。`exp` の猶予は 60 秒。
  - セッションの掃除は 100 行。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`（e2e は 1 度に 1 本だけ。先に `docker ps`）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **トークンとハッシュ。** CSPRNG の 32 バイトか。DB に生の値が入らないか。形の違う Cookie で DB を読まないか。→ Task 1 の `a session token is 32 random bytes as base64url` と `start stores only the SHA-256 of the token`。
2. **パスワードの変更・再設定で、その人のセッションが同じトランザクションで消えるか。** 失敗した変更（CAS が外れた）では消さないか。→ Task 1 の `a password change deletes the owner's sessions in the same transaction` と `a replaced-meanwhile change deletes nothing`。
3. **ログインの数とキーと順番が Go と同じか。失敗がすべて 1 回の scrypt か。** → Task 2 の表のテスト。
4. **GitHub と FFPF ID の失敗の分け方（`invalid`・`unavailable`・`forbidden`）と、ログに秘密が出ないか。** → Task 3・4 の `nothing secret reaches the log`。
5. **ID トークンの確かめが Go と同じか。** 署名・`alg`・`typ`・`kid`・`iss`・`aud`・`exp`・`nonce`・`email_verified`・`email`・`sub`、JWKS のキャッシュと取り直し。→ Task 4 の表のテスト。

---

### Task 1: `Session` の表、トークン、セッションの保存、パスワードの変更でセッションを消す

**Files:**

- Modify: `prisma/schema.prisma`（`model Session`）
- Create: `prisma/migrations/20261117090000_add_session/migration.sql`
- Create: `src/domain/identity/session.ts`、`src/infrastructure/auth/session-token.ts`、`src/infrastructure/prisma/session-store.ts`
- Modify: `src/infrastructure/prisma/password-account-store.ts`（`setPassword`・`replacePassword`）
- Test: `tests/session.test.ts`、`tests/session-token.test.ts`、`tests/session-store.test.ts`（新規）、`tests/password-account-store.test.ts`（足す）

**Interfaces:**

```prisma
// A signed-in browser (stage 11 of the Go retirement). The cookie holds a
// random token; only its SHA-256 is kept here. role/login/sessionVersion are
// what ApiRefreshToken kept, so the per-request check stays the same. The
// CHECK constraint in the migration pins the shape of each role.
model Session {
  id             String   @id @default(cuid())
  tokenHash      String   @unique // SHA-256 hex of the cookie's token
  ownerId        String
  role           String // "admin" | "member" | "guest"
  login          String? // admin only: GitHub login at sign-in (display only)
  sessionVersion Int? // member only: the account's sessionVersion at sign-in
  expiresAt      DateTime
  createdAt      DateTime @default(now())

  @@index([ownerId])
  @@index([expiresAt])
}
```

マイグレーション（`prisma migrate dev --create-only --name add_session` で作り、`CHECK` を手で足す）：

```sql
-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "login" TEXT,
    "sessionVersion" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_role_check" CHECK (
      ("role" = 'admin' AND "ownerId" <> '' AND "login" IS NOT NULL AND "login" <> '' AND "sessionVersion" IS NULL)
      OR ("role" = 'member' AND "ownerId" <> '' AND "login" IS NULL AND "sessionVersion" IS NOT NULL AND "sessionVersion" >= 0)
      OR ("role" = 'guest' AND "ownerId" = 'guest' AND "login" IS NULL AND "sessionVersion" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_ownerId_idx" ON "Session"("ownerId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
```

```ts
// src/domain/identity/session.ts
export const GUEST_OWNER_ID = "guest";
// Go: RefreshTTL and GuestRefreshTTL (auth/token.go:14-17). Fixed from sign-in.
export const SESSION_TTL_MS = 2_592_000_000;
export const GUEST_SESSION_TTL_MS = 86_400_000;
export type SessionPrincipal =
  | { role: "admin"; ownerId: string; login: string }
  | { role: "member"; ownerId: string; sessionVersion: number }
  | { role: "guest"; ownerId: typeof GUEST_OWNER_ID };
export function sessionTtlMs(principal: SessionPrincipal): number;
// Go: Signer.Verify's role rules (auth/token.go:126-145). null for a row the
// check must never accept: an unknown role, an admin without a login, a
// member without a non-negative integer version or with an empty ownerId,
// a guest whose ownerId is not "guest".
export function toSessionPrincipal(row: {
  ownerId: string;
  role: string;
  login: string | null;
  sessionVersion: number | null;
}): SessionPrincipal | null;
```

```ts
// src/infrastructure/auth/session-token.ts
export const SESSION_TOKEN_BYTES = 32;
export function newSessionToken(): string; // randomBytes(32).toString("base64url")
export function isSessionTokenShape(value: string): boolean; // /^[A-Za-z0-9_-]{43}$/
export function hashSessionToken(token: string): string; // sha256, lowercase hex
```

```ts
// src/infrastructure/prisma/session-store.ts
export const SESSION_PRUNE_BATCH = 100;
export const SESSION_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };
// Deletes at most SESSION_PRUNE_BATCH expired rows; SKIP LOCKED so concurrent
// sign-ins never wait on each other's cleanup (as pruneThrottleSql).
export function pruneSessionsSql(now: Date): Prisma.Sql;
export type SessionTokens = {
  newToken(): string;
  hash(token: string): string;
  isShape(value: string): boolean;
};
export function createSessionStore(
  db: () => PrismaClient,
  tokens: SessionTokens = {
    newToken: newSessionToken,
    hash: hashSessionToken,
    isShape: isSessionTokenShape,
  },
): {
  // Prunes expired rows, then stores a new session; returns the token (the
  // only time it exists outside the browser).
  start(principal: SessionPrincipal, now: Date): Promise<string>;
  // null for a token of the wrong shape (no query), an unknown hash, a row
  // with expiresAt <= now, or a row toSessionPrincipal refuses.
  find(token: string, now: Date): Promise<SessionPrincipal | null>;
  // Deletes the row of this token; nothing for an unknown or malformed one.
  end(token: string): Promise<void>;
};
```

`password-account-store.ts`：`setPassword`・`replacePassword` を `db().$transaction(async (tx) => { … }, SESSION_TRANSACTION_OPTIONS)` にする。中で今の `setPasswordSql` を `tx.$queryRaw` で実行し、1 行返ったときだけ `tx.session.deleteMany({ where: { ownerId: \`password:${id}\` } })`。先頭のコメントの「nothing touches ApiRefreshToken」を、「the same transaction deletes the owner's Session rows (stage 11); ApiRefreshToken is left to Go until stage 12」に直す。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/session.test.ts`
    - `the session lengths are Go's refresh lengths`：`SESSION_TTL_MS === 30 * 24 * 3600 * 1000`、`GUEST_SESSION_TTL_MS === 24 * 3600 * 1000`、`sessionTtlMs` は管理者と会員が前者、ゲストが後者。
    - `toSessionPrincipal keeps only the shapes Go would accept`：
      - `{ownerId:"10001", role:"admin", login:"alice", sessionVersion:null}` → 管理者。
      - `{ownerId:"password:c1", role:"member", login:null, sessionVersion:0}` → 会員（版 0）。
      - `{ownerId:"guest", role:"guest", login:null, sessionVersion:null}` → ゲスト。
      - 次は `null`：管理者で `login: ""`・`null`、会員で `sessionVersion: null`・`-1`・`1.5`、会員で `ownerId: ""`、ゲストで `ownerId: "x"`、`role: "owner"`。
  - `tests/session-token.test.ts`
    - `a session token is 32 random bytes as base64url`：1000 個がすべて `^[A-Za-z0-9_-]{43}$` で、すべて違う。`Buffer.from(t, "base64url").length === 32`。
    - `the hash is SHA-256 in lowercase hex`：`hashSessionToken("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`。
    - `only 43 base64url characters look like a token`：`"A".repeat(43)` は true。`"A".repeat(42)`、`"A".repeat(44)`、`"A".repeat(42) + "="`、`"A".repeat(42) + "+"`、`""` は false。
  - `tests/session-store.test.ts`（Prisma の偽物を `as unknown as PrismaClient` で渡す。`tests/line-link-store.test.ts` と同じやり方）
    - `pruneSessionsSql deletes a bounded batch of expired rows`：文に `DELETE FROM "Session" WHERE "id" IN (`、`"expiresAt" <= CAST($1 AS TIMESTAMP(3))`、`LIMIT $2 FOR UPDATE SKIP LOCKED` を含み、`values` は `[now, 100]`。
    - `start prunes, then stores only the SHA-256 of the token`：`newToken` が `"T".repeat(43)` を返す偽物で、会員 `{ownerId:"password:c1", sessionVersion:2}` と `now = 2026-11-17T03:00:00.000Z`。
      - `$executeRaw` が先に 1 回呼ばれる。
      - `session.create` の `data` は `{tokenHash: hash("T"…), ownerId: "password:c1", role: "member", login: null, sessionVersion: 2, expiresAt: 2026-12-17T03:00:00.000Z}`。
      - 返り値は `"T".repeat(43)` で、`data` のどこにも生のトークンが無い。
    - `a guest session ends after 24 hours and an admin keeps the login`：`expiresAt` がそれぞれ `now + 86_400_000` と `now + 2_592_000_000`。管理者の `login` はそのまま入る。
    - `find refuses a malformed token without a query`：`"short"` → `null` で、`findUnique` が呼ばれない。
    - `find returns the principal of a live row only`：`findUnique` の `where` は `{tokenHash: hash(token)}`。`expiresAt = now + 1 ms` → 会員。`expiresAt = now` → `null`。行が無い → `null`。`role: "owner"` の行 → `null`。
    - `end deletes by the token's hash only`：`deleteMany` の `where` が `{tokenHash: hash(token)}`。形の違うトークンでは呼ばれない。
  - `tests/password-account-store.test.ts` に足す（偽の `$transaction(fn, options)` が `fn(tx)` を呼び、`options` を記録する）
    - `a reset deletes the owner's sessions in the same transaction`：`setPassword("cx", …)` で、`tx.$queryRaw` が `[{loginId:"taro"}]` を返す。
      - `tx.session.deleteMany({where:{ownerId:"password:cx"}})` が 1 回呼ばれる。
      - `options` は `{maxWait: 5000, timeout: 10000}`。
      - 返り値は `"taro"`。
    - `a reset of a missing account deletes nothing`：`[]` → `deleteMany` は呼ばれず、`null`。
    - `a password change deletes the owner's sessions in the same transaction`：`replacePassword` で 1 行 → `deleteMany` 1 回、`true`。
    - `a replaced-meanwhile change deletes nothing`：`[]` → 呼ばれず、`false`。
- [ ] **Step 2: テストが失敗することを確かめる。**
- [ ] **Step 3: 実装する。** schema とマイグレーションを足し、`pnpm db:generate`。`toSessionPrincipal` の整数の確かめは `Number.isInteger(v) && v >= 0`。`start` は `$executeRaw(pruneSessionsSql(now))` のあと `session.create`（`id` は Prisma の `cuid()`）。`find` は `select: { ownerId, role, login, sessionVersion, expiresAt }`、`expiresAt.getTime() > now.getTime()` のときだけ通す。
- [ ] **Step 4: テストが通ることを確かめる。** e2e の DB で `node node_modules/prisma/build/index.js migrate deploy` が通ること（`docker compose -f compose.e2e.yaml up -d --wait` のあと、`DATABASE_URL` を e2e のものにして実行。終わったら `pnpm test:e2e:stop`）。`pnpm typecheck && pnpm lint`。
- [ ] **Step 5: コミット。** `feat(web): ログインのセッションを DB に置く表と、その保存を足す`

### Task 2: パスワード・ゲスト・デモのログインのユースケース

**Files:**

- Modify: `src/domain/identity/sign-in-throttle.ts`（ログインの数とキー）
- Create: `src/application/identity/sign-in.ts`
- Modify: `src/infrastructure/security/scrypt-password-hasher.ts`（`warm()`）
- Test: `tests/sign-in.test.ts`（新規）、`tests/sign-in-throttle.test.ts`・`tests/scrypt-password-hasher.test.ts`（足す）

**Interfaces:**

```ts
// src/domain/identity/sign-in-throttle.ts（足す）
// Go: maxAttemptsPerClient (20) per throttleWindow (15 min), "client:<client>".
export const SIGN_IN_CLIENT_THROTTLE: ThrottleRule = {
  limit: 20,
  windowMs: 900_000,
};
// Go: maxFailuresPerLogin (5) per 15 min, "login:<client>:<loginId>"; reset on success.
export const SIGN_IN_LOGIN_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 900_000,
};
// Go: LoginDemo's limit (20 per 15 min), "demo:<client>".
export const DEMO_SIGN_IN_THROTTLE: ThrottleRule = {
  limit: 20,
  windowMs: 900_000,
};
export function signInClientThrottleKey(client: string): string; // `client:${client}`
export function signInLoginThrottleKey(client: string, loginId: string): string; // `login:${client}:${loginId}`
export function demoSignInThrottleKey(client: string): string; // `demo:${client}`
```

```ts
// src/application/identity/sign-in.ts
export type SignInFailure =
  "invalid" | "throttled" | "forbidden" | "unavailable" | "demo-unavailable";
export type IssuedSession = { token: string; maxAgeSeconds: number };
export type SignInResult =
  { ok: true; session: IssuedSession } | { ok: false; reason: SignInFailure };
export type GitHubIdentity = { id: number; login: string };
export type FfpfIdentity = { sub: string; email: string; name: string };
// What an OAuth client answers: the user, or why not ("invalid": the code or
// token was refused; "unavailable": the provider could not be used).
export type ExchangeOutcome<T> =
  { ok: true; user: T } | { ok: false; reason: "invalid" | "unavailable" };
export type SignInDeps = {
  throttle: {
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  passwordAccounts: {
    // The account with this (already normalised) loginId, or null.
    findByLoginId(loginId: string): Promise<{
      id: string;
      passwordHash: string;
      sessionVersion: number;
    } | null>;
  };
  ffpfAccounts: {
    // Go: UpsertFfpfAccount. Creates with sessionVersion 0 or updates email,
    // displayName and lastLoginAt; returns the stored sessionVersion.
    upsert(
      input: { id: string; email: string; displayName: string },
      now: Date,
    ): Promise<{ sessionVersion: number }>;
  };
  passwords: {
    verify(password: string, hash: string): Promise<boolean>;
    simulate(password: string): Promise<void>;
  };
  sessions: { start(principal: SessionPrincipal, now: Date): Promise<string> };
  github: {
    exchange(
      code: string,
      verifier: string,
      redirectUri: string,
    ): Promise<ExchangeOutcome<GitHubIdentity>>;
  } | null;
  ffpf: {
    exchange(
      code: string,
      verifier: string,
      redirectUri: string,
      nonce: string,
    ): Promise<ExchangeOutcome<FfpfIdentity>>;
  } | null;
  allowedGitHubIds: ReadonlySet<string>;
  demoLoginId: string | undefined;
  now: () => Date;
};
export function createSignIn(deps: SignInDeps): {
  withPassword(
    input: { loginId: string; password: string },
    client: string,
  ): Promise<SignInResult>;
  asGuest(client: string): Promise<SignInResult>;
  asDemo(client: string): Promise<SignInResult>;
  // Task 3 and Task 4.
  withGitHub(
    input: { code: string; verifier: string; redirectUri: string },
    client: string,
  ): Promise<SignInResult>;
  withFfpf(
    input: {
      code: string;
      verifier: string;
      redirectUri: string;
      nonce: string;
    },
    client: string,
  ): Promise<SignInResult>;
};
```

```ts
// src/infrastructure/security/scrypt-password-hasher.ts（足す）
// Builds the dummy hash now, so the first simulate costs one verify like the
// rest (Go: Warm at startup). Never throws; a failure is retried by simulate.
async warm(): Promise<void>;
```

決まり（参照 §5〜§7）：

- 5 つとも、最初に `throttle.consume(authRouteThrottleKey(client), AUTH_ROUTE_THROTTLE, now)`。false → `throttled`。`now` は 1 回だけ読む。
- `withPassword`：
  1. `client:` 20 回 → `throttled`。
  2. `normalizeLoginId(loginId)` が `null`、`password === ""`、または `!isPlausibleCurrentPassword(password)`（128 コードポイントを超える）→ `simulate(firstCodePoints(password, 128))` して `invalid`。
  3. `login:<client>:<normalised>` 5 回 → `throttled`。
  4. `findByLoginId` が `null` → `simulate(password)` して `invalid`。
  5. `verify` が false → `invalid`（ほかの計算をしない）。
  6. `throttle.reset(loginKey)`。
  7. `sessions.start({role:"member", ownerId:"password:"+id, sessionVersion})`。
  - ストア・ハッシュの例外は投げたままにする（`invalid` にしない）。
- `asGuest`：ゲストのセッション（`ownerId: "guest"`）。
- `asDemo`：`demoLoginId` が無い → `demo-unavailable`（`demo:` は数えない）。`demo:<client>` 20 回 → `throttled`。`findByLoginId(demoLoginId)` が `null`、または `passwordHash !== DEMO_PASSWORD_HASH` → `demo-unavailable`。そうでなければ、その版で会員のセッション。
- 成功の `maxAgeSeconds` は `sessionTtlMs(principal) / 1000`。

- [ ] **Step 1: 失敗するテストを書く**（`tests/sign-in.test.ts`。偽の throttle は窓つきの数えを持ち、`consumed` に呼ばれたキーを順に記録する。偽の hasher は `verify`/`simulate` の回数と渡された文字列を記録する。`client = "203.0.113.7"`、アカウント `{id:"cacc1", loginId:"alice", password:"pw", sessionVersion:0}`）。
  - `every sign-in first counts route:auth:<client>, 10 a minute`：`asGuest` を 10 回は ok、11 回目は `throttled`、セッションは 10 個。61 秒後はまた ok。
  - `a password member signs in with the account's sessionVersion`：版 3 のアカウントで ok。
    - `sessions.start` の引数は `{role:"member", ownerId:"password:cacc1", sessionVersion:3}`。
    - `maxAgeSeconds === 2592000`。
    - `reset` は `["login:203.0.113.7:alice"]` だけ。
  - `every credential failure is "invalid" after exactly one hash`：Go の 8 つ（参照 §5）を表で。
    - ケース：`a`、`al ice`、33×`a`、空のパスワード、129×`x`、129×`パ`、`nobody`、間違ったパスワード。
    - それぞれ `invalid`。hasher の計算は合わせて 1 回で、渡された文字列は 128 コードポイント以下。`reset` は呼ばれない。
    - `consumed`（`route:auth:` を除く）は、形の悪い入力では `["client:203.0.113.7"]`、ほか 2 つでは `["client:203.0.113.7", "login:203.0.113.7:<id>"]`。
    - アカウントを読むのは、あとの 2 つだけ。
  - `the 21st attempt from one client is throttled before hashing`：Go の `TestLoginPasswordClientLimitBlocksBeforeHashing` と同じ。
    - 20 回、ID を変え、4 回に 1 回は形の悪い `x` にする。21 回目は正しいパスワードでも `throttled`。
    - 21 回目は計算もアカウントの読み出しも増えない。
    - 別の client は ok。15 分後は ok。
    - `route:auth:` に引っかからないよう、テストでは時計を 1 回ごとに 7 秒進める。
  - `the 6th attempt on a loginId is throttled; other clients and loginIds are not`：5 回間違えたあと、6 回目の `" ALICE "` と正しいパスワードは `throttled`（計算は増えない）。別の client の `alice` は ok。同じ client の `bob` は `invalid`。15 分後は ok。
  - `success resets the login count, not the client count`：4 回の失敗と 1 回の成功で `login:` の数は 0、`client:` の数は 5。成功のあと、また 5 回まで失敗できる。
  - `an unknown loginId is counted like a known one`：`nobody` で 5 回 → 計算 5 回。6 回目は `throttled`。数は `client:` 6、`login:` 6。
  - `store and hasher errors are thrown, not "invalid"`：`findByLoginId` が投げる `Error("db")` と、`verify` が投げる `Error("hash")` が、そのまま reject される。
  - `a guest shares the owner id "guest" for 24 hours`：`start` に `{role:"guest", ownerId:"guest"}`、`maxAgeSeconds === 86400`。
  - `no DEMO_LOGIN_ID is demo-unavailable without counting the demo key`：`consumed` は `["route:auth:203.0.113.7"]` だけ。
  - `the demo signs in to the reset's account with its sessionVersion`：`{id:"cdemo", passwordHash:"demo:no-password", sessionVersion:0}` → 会員 `password:cdemo`、版 0。パスワードの計算は 0 回。
  - `a missing demo account or a real password is demo-unavailable`：`null` と、`passwordHash: "scrypt:…"` の両方。
  - `the 21st demo sign-in from one client is throttled`：別の client は ok。
- [ ] **Step 2: テストが失敗することを確かめる。**
- [ ] **Step 3: 実装する。** `withGitHub`・`withFfpf` は、この Task では `route:auth:` を数えたあと `unavailable` を返す仮の形にする（Task 3・4 で埋める）。`warm()` と、そのテスト（`tests/scrypt-password-hasher.test.ts`：`warm then simulate builds the dummy hash once`。ハッシュを作る回数を数える）を足す。`tests/sign-in-throttle.test.ts` に、3 つのキーの形と数のテストを足す。
- [ ] **Step 4: テストが通ることを確かめる。** `pnpm typecheck && pnpm lint`。
- [ ] **Step 5: コミット。** `feat(web): パスワード・ゲスト・デモのログインを Web で行うユースケースを足す`

### Task 3: GitHub の OAuth のクライアントと、GitHub でのログイン

**Files:**

- Create: `src/infrastructure/auth/oauth-http.ts`、`src/infrastructure/auth/github-oauth-client.ts`
- Modify: `src/application/identity/sign-in.ts`（`withGitHub`）、`src/infrastructure/config/environment.ts`（`githubOAuthConfig`）
- Test: `tests/oauth-http.test.ts`、`tests/github-oauth-client.test.ts`（新規）、`tests/sign-in.test.ts`・`tests/identity-environment.test.ts`（足す）

**Interfaces:**

```ts
// src/infrastructure/auth/oauth-http.ts
export const OAUTH_TIMEOUT_MS = 10_000;
export const OAUTH_MAX_BODY_BYTES = 1_048_576;
// Go: loggableOAuthErrorCode. The code when it matches ^[a-z_]{1,64}$, else
// "unrecognized", so an answer that echoes a secret never reaches the log.
export function loggableOAuthErrorCode(code: unknown): string;
// Go: url.QueryEscape (unreserved kept, space as "+", everything else %XX upper case).
export function formUrlEncode(value: string): string;
// One request that never follows redirects (a 3xx comes back as the
// response), times out after timeoutMs, and reads at most maxBytes of the
// body (the rest is dropped, as Go's LimitReader). "unavailable" for a
// network error, a timeout or a body read error; the cause is never kept.
export function fetchLimited(
  fetchFn: typeof fetch,
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  },
  options?: { timeoutMs?: number; maxBytes?: number },
): Promise<{ status: number; text: string } | "unavailable">;
// A logger for fixed codes: console.warn(code, fields).
export type OAuthLog = (
  code: string,
  fields?: Record<string, string | number>,
) => void;
```

```ts
// src/infrastructure/auth/github-oauth-client.ts
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_URL = "https://api.github.com";
export function createGitHubOAuthClient(config: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch; // tests
  tokenUrl?: string; // tests only; never from the environment
  apiUrl?: string; // tests only
  timeoutMs?: number; // tests
  log?: OAuthLog;
}): {
  exchange(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<ExchangeOutcome<GitHubIdentity>>;
};
```

```ts
// src/infrastructure/config/environment.ts（足す）
// The web OAuth App: AUTH_GITHUB_ID (as today) and GITHUB_WEB_CLIENT_SECRET
// (the value Go has today). Both trimmed and non-empty, else undefined.
export function githubOAuthConfig():
  { clientId: string; clientSecret: string } | undefined;
// FFPF ID's client secret (Go: FFPF_ID_CLIENT_SECRET), trimmed; undefined when blank.
export function ffpfIdClientSecret(): string | undefined;
```

決まり（参照 §8）：

- `code` か `verifier` が空 → `invalid`（呼ばない）。
- トークン：`POST tokenUrl`。本文は `URLSearchParams` の `client_id`・`client_secret`・`code`・`code_verifier`・`redirect_uri`。ヘッダーは `Content-Type: application/x-www-form-urlencoded`、`Accept: application/json`。
  - 状態が 200 でない、JSON でない → `unavailable`。
  - `error` が文字列で空でない → `log("GITHUB_TOKEN_REJECTED", { github_error: loggableOAuthErrorCode(error) })` をして `invalid`。
  - `access_token` が空でない文字列でない → `unavailable`。
- 利用者：`GET apiUrl + "/user"`。ヘッダーは `Authorization: Bearer <token>`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`。
  - 401・403 → `invalid`。ほかの 2xx でない状態 → `unavailable`。
  - JSON の `id` が `Number.isSafeInteger` で正、`login` が空でない文字列 → `{id, login}`。そうでなければ `unavailable`。
- `withGitHub`：
  1. `route:auth:` を数える。
  2. `deps.github === null` → `unavailable`。
  3. `exchange` の失敗はそのまま返す。
  4. `String(user.id)` が `allowedGitHubIds` に無い → `forbidden`（セッションは作らない）。
  5. 管理者のセッション `{role:"admin", ownerId:String(id), login}` を作る。

- [ ] **Step 1: 失敗するテストを書く**（`fetch` の偽物は、URL ごとに答えを返し、受け取った `init` を記録する。`testClientSecret = "gh-secret-0123456789"`、`testCode = "gh-code-abcdef"`、`testVerifier = "gh-verifier-0123456789abcdef"`、GitHub のトークン `gho_test_token_123`）。
  - `tests/oauth-http.test.ts`
    - `only code-shaped OAuth errors are logged as is`：`bad_verification_code` はそのまま。`Bad`、`a-b`、`""`、65×`a`、`1`（数）、`null` は `unrecognized`。
    - `formUrlEncode is Go's url.QueryEscape`：`"a b"→"a+b"`、`"a+b"→"a%2Bb"`、`"x!'()*~"→"x%21%27%28%29%2A~"`、`"é"→"%C3%A9"`。
    - `fetchLimited never follows redirects`：`init.redirect === "manual"`。307 の答えは `{status:307}` で返る。
    - `fetchLimited cuts the body at maxBytes`。
    - `fetchLimited turns a network error or a timeout into "unavailable"`：`timeoutMs: 20` で、答えない偽物。
  - `tests/github-oauth-client.test.ts`
    - `the code exchange posts Go's form and reads the user with Go's headers`（Go `TestExchangeSuccess`）：トークンの要求の方法・ヘッダー・本文の 5 つの値。利用者の要求の方法と 3 つのヘッダー。結果は `{ok:true, user:{id:123, login:"Alice"}}`。
    - `empty code or verifier is invalid without calling GitHub`：`fetch` が呼ばれない。
    - `a token error is invalid and logs only a code-shaped error`：`{"error":"bad_verification_code"}` → `invalid`、log は `[["GITHUB_TOKEN_REJECTED", {github_error:"bad_verification_code"}]]`。`{"error":"<the client secret>"}` → `unrecognized`。
    - `a 401 or 403 from /user is invalid`。
    - `GitHub's failures are "unavailable"`（Go `TestExchangeUnavailable` の 10 個）：トークンが 500、`not json`、`{}`、つながらない、利用者が 500・404、`{"id":`、`id` 0・-5、`login` が空。ほかに、トークンが 302 のとき（`redirect` を追わない）と、`id` が `1.5` のとき。
    - `nothing secret reaches the log or the result`：すべてのケースのログと、`JSON.stringify(結果)` に、秘密・コード・verifier・GitHub のトークンが出ない。
  - `tests/sign-in.test.ts` に足す
    - `an allowlisted GitHub id signs in as an admin with the login`：`{id:10001, login:"Alice"}`、許可リスト `{"10001"}` → `start` に `{role:"admin", ownerId:"10001", login:"Alice"}`。
    - `a GitHub id off the allowlist is forbidden and starts nothing`。
    - `the allowlist is by id whatever the login`：`login:"root"`・`id:10002` は `forbidden`。`login:"someone-else"`・`id:10001` は ok。
    - `GitHub's invalid and unavailable pass through; no GitHub is unavailable`。
  - `tests/identity-environment.test.ts` に足す
    - `githubOAuthConfig needs both the client id and the secret`：片方だけ、空白だけ → `undefined`。前後の空白は取り除く。
    - `ffpfIdClientSecret is the trimmed secret`。
- [ ] **Step 2〜4:** 失敗を確かめ、実装し、通す。`pnpm typecheck && pnpm lint`。
- [ ] **Step 5: コミット。** `feat(web): GitHub の OAuth のコード交換を Web で行うクライアントを足す`

### Task 4: FFPF ID（OpenID Connect）のクライアントと、FFPF ID でのログイン

**Files:**

- Create: `src/domain/identity/ffpf-account.ts`、`src/infrastructure/auth/ffpf-oidc-client.ts`、`src/infrastructure/prisma/ffpf-account-store.ts`
- Modify: `src/application/identity/sign-in.ts`（`withFfpf`）
- Test: `tests/ffpf-account.test.ts`、`tests/ffpf-oidc-client.test.ts`、`tests/ffpf-account-store.test.ts`（新規）、`tests/sign-in.test.ts`（足す）

**Interfaces:**

```ts
// src/domain/identity/ffpf-account.ts
// Go: ffpfSub (auth/ffpf.go:40). The sub becomes the owner id ffpf:<sub>.
export const FFPF_SUB_PATTERN = /^[a-z0-9]{1,64}$/;
export const FFPF_DISPLAY_NAME_MAX_CODE_POINTS = 50;
// Go: verify's name rule and LoginFFPF's truncation (auth/ffpf.go:261-265,
// auth/login.go:53-57): Go's TrimSpace (goTrimSpace), at most 50 code points;
// blank → the email before its first "@", at most 50 code points.
export function ffpfDisplayName(name: string, email: string): string;
```

```ts
// src/infrastructure/auth/ffpf-oidc-client.ts
export const FFPF_JWKS_CACHE_MS = 600_000;
export const FFPF_LEEWAY_MS = 60_000;
export function createFfpfOidcClient(config: {
  issuer: string; // trailing slashes dropped
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: OAuthLog;
}): {
  exchange(
    code: string,
    verifier: string,
    redirectUri: string,
    nonce: string,
  ): Promise<ExchangeOutcome<FfpfIdentity>>;
};
```

```ts
// src/infrastructure/prisma/ffpf-account-store.ts
// Go's UpsertFfpfAccount (store/ffpf_accounts.go:25-41), one statement.
export function upsertFfpfAccountSql(
  input: { id: string; email: string; displayName: string },
  now: Date,
): Prisma.Sql;
export function createFfpfAccountStore(db: () => PrismaClient): {
  upsert(
    input: { id: string; email: string; displayName: string },
    now: Date,
  ): Promise<{ sessionVersion: number }>;
};
```

`upsertFfpfAccountSql` は Go の文をそのまま書く：

```sql
INSERT INTO "FfpfAccount" ("id", "email", "displayName", "sessionVersion", "createdAt", "updatedAt", "lastLoginAt")
VALUES (${id}, ${email}, ${displayName}, 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "displayName" = EXCLUDED."displayName", "lastLoginAt" = EXCLUDED."lastLoginAt", "updatedAt" = EXCLUDED."updatedAt"
RETURNING "sessionVersion"
```

決まり（参照 §9。順番と、ログの `reason` の語は Go と同じ）：

- 入力：`code`・`verifier`・`nonce` のどれかが空 → `invalid`（呼ばない）。
- トークンの要求：`POST <issuer>/oauth/token`。
  - 本文は `grant_type=authorization_code`・`code`・`code_verifier`・`redirect_uri`。
  - ヘッダーは `Authorization: Basic base64(formUrlEncode(clientId) + ":" + formUrlEncode(clientSecret))`、`Content-Type: application/x-www-form-urlencoded`、`Accept: application/json`。
  - 4xx → `log("FFPF_ID_REJECTED", {reason:"token_endpoint", status, ffpf_error: loggableOAuthErrorCode(body.error)})` をして `invalid`。
  - ほかの 2xx でない状態（3xx を含む）→ `log("FFPF_ID_UNAVAILABLE", {reason:"token_status", status})` をして `unavailable`。
  - JSON でない、`id_token` が空でない文字列でない → `invalid`（`id_token`）。
- ID トークン（どれも `invalid` で、`log("FFPF_ID_REJECTED", {reason})`）：
  1. 3 つの区切り、それぞれ `^[A-Za-z0-9_-]+$` → `malformed`。
  2. 3 つとも正規の base64url（`Buffer.from(s,"base64url").toString("base64url") === s`）→ `malformed`。header が JSON のオブジェクト → `header`。
  3. `alg === "ES256"` → `alg`。
  4. `typ` が無いか、`"JWT"` → `typ`。`kid` が空でない文字列 → `kid`。
  5. 鍵（下の JWKS）。取れない → `unavailable`。fresh な JWKS にも無い → `kid`。
  6. 署名が 64 バイトで、`crypto.verify("sha256", header.payload, {key, dsaEncoding:"ieee-p1363"}, sig)` → `signature`。
  7. claims が JSON のオブジェクトで、読む値の型が合う → `claims`。
     - `iss`・`nonce`・`sub`・`email`・`name` は、あれば文字列。
     - `aud` は文字列か、文字列の配列。
     - `exp` は数。`"9999999999"` は `claims`。
  8. `iss === issuer`（末尾の `/` は不可）→ `iss`。`aud` に `clientId` がある → `aud`。
  9. `exp`：無い、`0 <= exp <= 2**53` でない → `exp`。`nowMs <= Math.trunc(exp) * 1000 + 60_000` でない → `exp`。
  10. `nonce === 要求の nonce` → `nonce`。
  11. `email_verified === true`（真偽値の `true` だけ）→ `email_verified`。
  12. `email` が空でない → `email`。
  13. `FFPF_SUB_PATTERN` → `sub`。
  - `iat` と `nbf` は読まない。
- 結果は `{sub, email, name: ffpfDisplayName(name ?? "", email)}`。
- JWKS：`GET <issuer>/oauth/jwks`、`Accept: application/json`。
  - 取ってから 600 秒は使い回す。古い、または `kid` が無いときに取り直す。ただし 1 つのトークンで取るのは 1 回まで。
  - 取り直しに失敗したら、古い鍵があっても `unavailable`（`log("FFPF_ID_UNAVAILABLE", {reason:"jwks_status"|"jwks_body"|"transport"})`）。
  - 状態が 200 でない、JSON でない、`keys` が配列でない → `unavailable`。
  - 残す鍵：`kty === "EC"`、`crv === "P-256"`、`kid` が空でない、`use` が無いか `"sig"`、同じ `kid` は最初の 1 つだけ。
  - `x`・`y` は正規の base64url の 32 バイトで、`crypto.ECDH.convertKey(Buffer.concat([0x04, x, y]), "prime256v1")` が投げない（曲線の上にある）。
  - 鍵は `createPublicKey({key:{kty:"EC", crv:"P-256", x, y}, format:"jwk"})`。
- すべての HTTP は `fetchLimited`（10 秒、1 MiB、リダイレクトを追わない）。
- `withFfpf`：
  1. `route:auth:` を数える。
  2. `deps.ffpf === null` → `unavailable`。
  3. `exchange` の失敗はそのまま返す。
  4. `FFPF_SUB_PATTERN` にもう一度合わない → `invalid`。
  5. `ffpfAccounts.upsert({id: sub, email, displayName: ffpfDisplayName(name, email)}, now)`。
  6. 会員のセッション `{ownerId:"ffpf:"+sub, sessionVersion}` を作る。許可リストは無い。

- [ ] **Step 1: 失敗するテストを書く**（`tests/ffpf-oidc-client.test.ts`。鍵は `generateKeyPairSync("ec", {namedCurve:"P-256"})`、署名は `sign("sha256", …, {key, dsaEncoding:"ieee-p1363"})`。Go のテストの値を使う：client `zhuelog`、秘密 `ffpf-client-secret-xyz`、redirect `https://zhuelog.example/api/auth/callback/ffpf`、code `ffpf-code-0123456789`、verifier `ffpf-verifier-abcdefghijklmnopqrstuvwxyz0123456789`、nonce `ffpf-nonce-0123456789`、now `2026-10-27T12:00:00Z`、issuer `https://ffpf.example`、claims `{iss, aud:"zhuelog", sub:"cabc123", exp: now+300, iat: now, nonce, email:"alice@example.com", email_verified:true, name:"ふわ"}`）。
  - `a valid code gives the ID token's user`（Go `TestFFPFExchangeSuccess`）：
    - 結果は `{sub:"cabc123", email:"alice@example.com", name:"ふわ"}`。
    - トークンの要求の方法・`Content-Type`・`Accept`・Basic の 2 つの値・本文の 4 つの値（ほかの値が無い）。
    - トークンの要求 1 回、JWKS 1 回。
  - `the Basic credentials are form-encoded first`：clientId `a b` と秘密 `p+q:r` → `base64("a+b:p%2Bq%3Ar")`。
  - `accepted ID tokens`（Go `TestFFPFExchangeAccepts`）：`exp` が 60 秒前、`aud` が `["other","zhuelog"]`、`name` が無い（→ `alice`）、`name` が `"  "`（→ `alice`）。
  - `refused ID tokens name Go's reason`（Go `TestFFPFExchangeRejectsIDToken` の 30 個すべて。それぞれ `invalid` で、ログの `reason` が Go の語）：
    - `iss`：別の `iss`、末尾に `/` の付いた `iss`。
    - `aud`：`"other"`、`["other"]`、`aud` が無い。
    - `exp`：61 秒前、`exp` が無い。
    - `claims`：`exp` が文字列。
    - `nonce`：別の `nonce`、`nonce` が無い。
    - `email_verified`：`false`、`"true"`、無い。
    - `email`：`email` が無い、空。
    - `sub`：`A/B`、`Cabc`、65×`a`、無い。
    - `signature`：別の鍵、63 バイトの署名。
    - `malformed`：`alg:none` で署名が空、4 つの区切り、末尾に `=`、`not a jwt`。
    - `alg`：`alg:none` に署名がある、`HS256`。
    - `typ`：`at+jwt`。
    - `kid`：`kid` が無い、JWKS に無い `kid`。
  - `refused token answers`（Go `TestFFPFExchangeRejectsTokenResponse`）：400 の `invalid_grant`、401 の `invalid_client`、秘密を返す 400（ログは `unrecognized`）、`id_token` が無い、`{"id_token":1}`、`<html>`。それぞれ `invalid` で、JWKS は 0 回、ログが 1 行。
  - `empty code, verifier or nonce is invalid without calling`。
  - `unavailable answers`（Go `TestFFPFExchangeUnavailable`）：
    - トークンが 500・502。
    - 307（追わないので、トークンの要求は 1 回）。
    - JWKS が 500、`<html>`、`{}`。
    - つながらない。
  - `a rotated key costs one refetch; an unknown kid one more, then is refused`（Go `TestFFPFRefetchesJWKSOnceForUnknownKid`。JWKS の回数 2、3）。
  - `the JWKS is kept 10 minutes, and a failed refetch is not covered by stale keys`（Go `TestFFPFCachesJWKS`）：
    - 3 回で 1 回だけ取る。
    - 600_001 ms 後に 2 回目を取る。
    - さらに 600_001 ms 後に失敗させると `unavailable`。
  - `unusable JWKs are left out`（Go `TestFFPFIgnoresUnusableJWKs`）：RSA、P-384、`y` が 32 バイトの 0（曲線の外）、`use:"enc"` だけ → `invalid`。`use` の無い使える鍵を足すと ok。
  - `nothing secret reaches the log or the result`：どのケースのログにも、秘密・code・verifier・`eyJ` が出ない。
  - `tests/ffpf-account.test.ts`：
    - `"  ふわ  "` → `ふわ`。
    - 51×`あ` → 50×`あ`。
    - `""` と `alice@example.com` → `alice`。
    - `"　"`（全角の空白）と `bob@x` → `bob`。
    - `""` と `60×"a" + "@x"` → 50×`a`。
    - 50×`😀` + `x` → 50×`😀`（コードポイントで数える）。
  - `tests/ffpf-account-store.test.ts`：`upsertFfpfAccountSql keeps sessionVersion and createdAt on a second sign-in`。文に `ON CONFLICT ("id") DO UPDATE SET` を含み、`"sessionVersion" =` と `"createdAt" =` は SET に無い。`RETURNING "sessionVersion"`、`values` は `[id, email, displayName, now, now, now]`。
  - `tests/sign-in.test.ts` に足す：
    - `an FFPF ID user is upserted and signs in as ffpf:<sub> with its sessionVersion`：版 2 → `start` に `{role:"member", ownerId:"ffpf:cabc123", sessionVersion:2}`。`upsert` には `ffpfDisplayName` の名前。
    - `a sub that cannot form an owner id is invalid`：`exchange` が `sub:"A/B"` を返す偽物 → `invalid`、`upsert` は呼ばれない。
    - `no FFPF ID is unavailable`。
- [ ] **Step 2〜4:** 失敗を確かめ、実装し、通す。`pnpm typecheck && pnpm lint`。
- [ ] **Step 5: コミット。** `feat(web): FFPF ID の ID トークンを Web で確かめるクライアントを足す`

### Task 5: ドキュメント（11a の分）

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`.env.example`

- [ ] **Step 1: 直す。**
  - `docs/api-deployment.md` の「段階10…のマージの前と後」の後ろに、「段階11（ログイン）のマージの前と後」の節を作る。
    - 冒頭に、11a と 11b の 2 つの PR に分けたことと、それぞれで何が変わるかを 3 行で書く。
    - 「##### 11a のマージの前と後」：
      - マージの前に行うことは無い。
      - 本番のビルドが `Session` の表を足す（`prisma migrate deploy`。表の追加だけで、今の Go と両立する）。Preview のブランチには、手で `prisma migrate deploy` を当てる（「Web のプレビュー（Preview）」の手順）。
      - マージのあとに、`migrate status` で「Database schema is up to date!」を確かめる。
      - 動きは変わらない。ログインは Go のまま。
      - 11b の前に、Web の Production に次の 2 つを入れておいてよい（11a では読まない）。
        - `GITHUB_WEB_CLIENT_SECRET`：Go の同じ名前の値。Vercel から読み戻せないときは、GitHub の OAuth App の画面で **Generate a new client secret** を押して作る。古い Secret は 11b のあと Go を出し直すまで消さない。
        - `FFPF_ID_CLIENT_SECRET`：Go と同じ値。
      - Preview には入れない。プレビューの URL は、GitHub と FFPF ID に登録したコールバックの URL と合わないため。
    - 「##### 11b のマージの前と後」は、見出しと「11b の計画の Task 5 で書く」の 1 行だけを置く。
  - `docs/architecture.md`：データの表の一覧（あれば）に `Session`（「段階 11b から Web のログインが使う。11a では空」）を足す。
  - `.env.example`：Web の欄に `GITHUB_WEB_CLIENT_SECRET=""` と `FFPF_ID_CLIENT_SECRET=""` を足す。コメントは「段階 11b から Web がログインに使う（Go と同じ値）」。
  - 秘密の値は書かない。
- [ ] **Step 2:** 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: 段階 11a（セッションの表とログインの部品）のマージの前と後を書く`
