# Go 廃止 段階 11b（Web が自分でログインし、Go のログインを消す）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 11a の部品をつなぎ、Web が Go なしでログインするようにする。対象は、パスワード・ゲスト・デモ・GitHub・FFPF ID のログインと、ログアウト。

- ログイン中の人は、`zl_session` の Cookie と `Session` の表で決める。
- `src/proxy.ts` は、Cookie があるかだけを見る門番になる。refresh はなくなる。
- Go のログインと、それだけが使うコードを、Go と Web の両方から消す。Go に残るのは `/health`・`/healthz`・`/ping` だけ。
- 切り替えた時点で、今のログインはすべて切れる（決めたこと 6）。

**Architecture:**

- Cookie の名前と属性は `src/infrastructure/auth/session-cookies.ts`。読み書き（`next/headers`）は `src/infrastructure/auth/web-session.ts`。
- ログイン中の人は `SessionCurrentUserProvider`（今の `TokenCurrentUserProvider` を、JWT の代わりに `Session` の行で動くようにしたもの。`src/infrastructure/identity/session-current-user-provider.ts`）。
- 門番は `src/presentation/http/session-gate.ts`。`src/proxy.ts` がそれを呼ぶ。
- 組み立ては `src/composition/sign-in-container.ts`（新規）と、今の `identity-container.ts`・`current-user.ts`。
- OAuth の開始の道具（`github-oauth.ts`・`ffpf-oauth.ts`）は、中身を変えずに `src/infrastructure/auth/` へ移す。
- Go は参照 §14 の表のとおりに消す。

**Tech Stack:** Next.js 16.4（`proxy.ts`、`cookies()`、Server Actions、Route Handler、`redirect`）、TypeScript、Prisma 7、`node:test` + `tsx`、Playwright、Go の `testing`。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 11、決めたこと 5・6・8）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage11-go-reference.md`（以下「参照」）。この計画で使うのは §2、§4、§10〜§15。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage11a-sessions.md`（11a。この計画は 11a の PR の上に重ねた別の PR。分ける理由は 11a の判断 1）。**後：** 段階 12（後片付け）。

**マージの条件：** 11a が本番にあり、`Session` の表が本番の DB にあること。Web の Production に `GITHUB_WEB_CLIENT_SECRET` と `FFPF_ID_CLIENT_SECRET` があること（Task 5 の「11b のマージの前と後」）。

## 設計者の判断（コントローラーが確かめること）

1. **Cookie は `zl_session` の 1 つにする。** 属性は `HttpOnly`、`SameSite=Lax`、`Path=/`、`Secure`（`isSecureRequest`。今と同じ決め方）、`Max-Age` 2_592_000（ゲストは 86_400。行の `expiresAt` と同じ）。
   - 今の `zl_access`・`zl_refresh` と同じ属性で、長さは今の `zl_refresh` と同じ（参照 §11.3）。
   - `SameSite=Strict` にはしない。GitHub や FFPF ID から戻った直後のページの読み込みに Cookie が付かず、ログインしていないように見えるため。
   - `__Host-` の接頭辞は付けない。`Secure` が要るので、http で動く e2e（`http://127.0.0.1:3107`）と手元の開発で使えない。名前を環境で変えると、門番と読み手の両方に分岐が要る。
2. **ログインのたびに新しいトークンを作る（セッションの固定を防ぐ）。**
   - ブラウザがすでに `zl_session` を持っていれば、その行を消してから新しい行を作る。消すのに失敗しても、ログインは続ける（ログは `SESSION_END_FAILED` とエラーの名前だけ）。
   - 同時に、`zl_act_as` と、Go の古い Cookie（`zl_access`・`zl_refresh`）を消す。
   - Cookie に置かれた値は、ログインの結果には一切使わない。
3. **`zl_act_as` は、名前・値の形・長さ（30 日）・確かめ方を変えない。**
   - 読む側（`SessionCurrentUserProvider`）は、今の `TokenCurrentUserProvider` と同じ。管理者のときだけ、`^password:[a-z0-9]{1,64}$` に合い、実在する `PasswordAccount` のときだけ効く。外されたら `actAsIgnored`。
   - 書く側（「会員として見る」）は、Go の `/v1/me` に確かめさせていた（参照 §4）。これを Web で直接確かめる。今の人が `role: "admin"` であること、同じ形、`PasswordAccount` があること。3 つがそろったときだけ書く。
   - ログイン・ログアウトで消す。
4. **Proxy は Cookie があるかだけを見る。DB は読まない。**
   - Next.js の案内のとおりにする（参照 §11.5）。ほんとうの確かめは、これまでどおりページ・Action・Route Handler の `getCachedCurrentUser`。
   - 公開のルート、`/api/*` の 401、Server Action の素通し、`/signin?callbackUrl=…` への 302、CSP は今と同じ。
   - refresh と、Cookie の書き換えはなくなる。
   - `x-zhuelog-path` もやめる。読むのは `goApiAuthed` だけで、それを呼ぶ所はもう無い（参照 §11.1）。
   - Go の古い Cookie だけを持つ人は、門で `/signin` に送られる（全員がログインし直す、決めたこと 6）。
5. **CSRF の守りは今と同じにする。**
   - ログインの開始とログアウトは、今と同じく Server Action のまま。Next.js は Server Action を `POST` だけで受け、`Origin` を `Host` と比べる（参照 §11.4）。Cookie は `SameSite=Lax`。
   - Go の間の「Web のサーバーからの呼び出し」の秘密（`API_WEB_PROXY_SECRET`）は、間が無くなるので要らない。
   - OAuth のコールバックは `GET` のままで、守りは `zl_oauth` の `state`（定数時間の比較）と PKCE。FFPF ID はさらに `nonce`。`zl_oauth` の形・属性・10 分は変えない。
6. **失敗の行き先は今と同じにする**（参照 §11.4）。
   - パスワード：`invalid`・`throttled` → `CredentialsSignin`。DB・scrypt の例外は投げる（`src/app/signin/error.tsx`。今の Go の 500 と同じ）。
   - ゲスト：失敗も例外も → `Unknown`。
   - デモ：`demo-unavailable` → `DemoUnavailable`。ほか → `Unknown`。
   - GitHub：`forbidden` → `AccessDenied`。ほかと例外 → `OAuthCallbackError`。
   - FFPF ID：すべて `OAuthCallbackError`。
   - 設定が無い → `Configuration`。
   - ログは決まったコードと、失敗の語かエラーの名前だけ。
7. **ログアウトは、行を消してから Cookie を消す。** DB に届かないときも、Cookie は消してログアウトする。今の「Go に届かなくてもログアウトする」と同じ。行は 30 日で切れ、掃除で消える。
8. **ボタンの出し分けは、秘密の値まであるかで決める。**
   - GitHub のボタンは `githubOAuthConfig()`（`AUTH_GITHUB_ID` と `GITHUB_WEB_CLIENT_SECRET`）があるときだけ使える。今の `isAuthConfigured`（`GO_API_URL`・`API_WEB_PROXY_SECRET` も要った）をやめる。
   - FFPF ID のボタンは、`ffpfIdConfig()` が `FFPF_ID_CLIENT_SECRET` まであるときだけ出す。
   - 秘密を入れ忘れたときは、ボタンが消える・使えない形で見える。ログインを押してから失敗するより分かりやすい。
   - デモのボタンは、Go に聞かず `DEMO_LOGIN_ID` があるかで出す（Go の `GET /v1/auth/demo` と同じ判断）。
9. **Go は、この PR で `/health`・`/healthz`・`/ping` だけにする（参照 §14）。**
   - 消すもの：`auth`・`jsstr`・`httpclient` のパッケージ、ログインのハンドラ・回数の制限・`requireAuth`・act-as、`store` のアカウント・refresh token・回数の制限。`go mod tidy` で `golang-jwt` と `x/crypto` が外れる。
   - 残すもの：`main.go`・`config.go`（`PORT` と `DATABASE_URL` だけ）・health・`store.Open`。
   - 段階 12 で `services/api/` ごと消すまで、Go の Vercel プロジェクトがビルドでき、`/health` が 200 を返す形を保つ。
   - 段階 12 に残すもの：Web の `src/infrastructure/go-api/` の残り（`goApi`・`GoApiError` とその利用者、`learning-json.ts`）、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET`、`api:*` のスクリプト、`compose.api.yaml`、`docs-site/` そのもの、`ApiRefreshToken` の表。
   - この PR で Web から消すもの（ログインだけが使っていたもの）：`go-api-session.ts`・`go-proxy.ts`・`session-cookies.ts`・`authed.ts`・`act-as.ts`・`current-path.ts`、`client.ts` のログインと `/v1/me` の関数、`identity/access-token.ts`、`apiJwtSecret`・`isAuthConfigured`。
   - `isSafeGoApiUrl` は `isHttpsOrLoopbackUrl` と名前を変える。FFPF ID の issuer の確かめと、`goApi` の両方が使うため。
10. **e2e は Go を起動しない。** Web はもう Go を呼ばない。
    - 管理者のセッションは、テストが `Session` の行を直接入れて、その Cookie を置く。今の JWT を作るのと同じく、テストだけの道具で、アプリに抜け道は作らない。
    - GitHub の偽のサーバーは足さない（11a の判断 12）。
    - FFPF ID は、今の偽のサーバーで最後まで通す。
11. **Go の止め方。**
    - マージ → Web の本番の Ready → `vercel promote`。ここで全員がログインし直す。
    - 次に、Go を main から出し直す（実行の前に利用者に確かめる）。これで Go の `/v1/auth/*` と `/v1/me` が 404 になる。
    - Go の Vercel プロジェクトの値は、`DATABASE_URL`（と `GOFLAGS`）のほかは消してよい。消すのは段階 12 でもよい。
    - 戻すとき：
      - Web だけを戻すと、ログインは Go に戻る。Go がまだ古い（出し直す前）ならそのまま動く。出し直したあとなら、Go も戻す。
      - `Session` の行は残るが、害は無い。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で次を確かめる（`AGENTS.md`）。
  - `01-app/03-api-reference/03-file-conventions/proxy.md`（Node.js の runtime、`NextResponse.next`、matcher）
  - `01-app/03-api-reference/04-functions/cookies.md`（Server Action と Route Handler でだけ書ける）
  - `01-app/03-api-reference/04-functions/redirect.md`（`try` の中で呼ばない）
  - `01-app/02-guides/authentication.md`（Optimistic checks with Proxy）
  - `01-app/02-guides/data-security.md`（Server Actions の Origin の確かめ）
- コメントは英語。画面の文言は変えない。依存を増やさない。
- 層：
  - `src/domain/` は domain のほかを import しない。
  - `src/application/` は domain だけを import し、`console` を使わない。
  - Prisma は `src/infrastructure/prisma/` だけ。`node:crypto` と `next/headers` は `src/infrastructure/` と `src/presentation/` だけ。
  - `src/app/` と画面の部品は、`@/infrastructure/go-api` を import しない（eslint のまま）。
- `redirect()` は `try` の中で呼ばない。Cookie を書くのは Server Action と Route Handler だけ（Server Component では書かない）。
- Cookie：
  - `zl_session` は `HttpOnly`、`SameSite=Lax`、`Path=/`、`Secure` は `isSecureRequest`（コールバックはリクエストの URL が https のときも）。`Max-Age` は 2_592_000 か 86_400。
  - `zl_act_as` は同じ属性で 2_592_000。
  - `zl_oauth` は今のまま（600）。
  - 消すときは値 `""`・`Max-Age` 0。
- ログには、トークン・ハッシュ・コード・verifier・nonce・state・秘密・パスワード・ログイン ID・メールアドレス・owner ID を出さない。決まったコード（`SIGN_IN_*`、`SESSION_END_FAILED` など）と、失敗の語かエラーの名前だけを出す。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && gofmt -l . && go vet ./... && go test ./...`。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **毎回の確かめが、決めたこと 5 のすべてを保つか。**
   - 管理者の許可リスト、会員の `sessionVersion`（パスワード会員と FFPF ID 会員）、`zl_act_as`（管理者だけ・形・実在）、デモの印、ゲスト。
   - 期限切れ・消された行・形の悪い Cookie は、ログインしていない。
   - → Task 1 の `tests/session-current-user-provider.test.ts`。e2e は `e2e/session.spec.ts`、`e2e/security.spec.ts`、`e2e/act-as.spec.ts`。
2. **ログインのたびに新しいトークンになり、前の行と古い Cookie が消えるか。ログアウトで行が消えるか。パスワードの変更・再設定で、その人のすべての行が消えるか。** → Task 2 の unit、Task 3 の `e2e/session.spec.ts` と `e2e/accounts.spec.ts`。
3. **Proxy が DB にさわらず、公開のルートと 401・302 が今と同じか。** → Task 1 の `tests/session-gate.test.ts`、`tests/vercel-config.test.ts`。
4. **失敗の行き先とログ。** → Task 2 の `tests/sign-in-controller.test.ts`、コールバックのテスト。
5. **Go に health だけが残り、ビルドとテストが通るか。Web からログインの Go の部品が消えたか。** → Task 4 の grep。

---

### Task 1: Cookie の道具、セッションでの現在の利用者、Proxy の門番

**Files:**

- Create: `src/infrastructure/auth/session-cookies.ts`、`src/infrastructure/auth/secure-request.ts`、`src/presentation/http/session-gate.ts`
- Rename (`git mv`): `src/infrastructure/identity/token-current-user-provider.ts` → `session-current-user-provider.ts`、`tests/token-current-user-provider.test.ts` → `tests/session-current-user-provider.test.ts`
- Test: `tests/session-cookies.test.ts`、`tests/session-gate.test.ts`（新規）、`tests/session-current-user-provider.test.ts`（直す）

**Interfaces:**

```ts
// src/infrastructure/auth/session-cookies.ts
export const SESSION_COOKIE = "zl_session";
export const ACT_AS_COOKIE = "zl_act_as";
export const OAUTH_COOKIE = "zl_oauth";
// Go's cookies before stage 11; cleared at every sign-in and sign-out.
export const LEGACY_SESSION_COOKIES = ["zl_access", "zl_refresh"] as const;
export const ACT_AS_MAX_AGE = 2_592_000;
export type CookieWrite = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: boolean;
    maxAge: number;
  };
};
export function cookieWrite(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): CookieWrite;
// zl_session with the session's max-age, then zl_act_as, zl_access and
// zl_refresh cleared.
export function signedInCookieWrites(
  session: IssuedSession,
  secure: boolean,
): CookieWrite[];
// zl_session, zl_act_as, zl_access and zl_refresh cleared.
export function signedOutCookieWrites(secure: boolean): CookieWrite[];
export function actAsCookieWrite(ownerId: string, secure: boolean): CookieWrite;
export function clearedActAsCookieWrite(secure: boolean): CookieWrite;
```

```ts
// src/infrastructure/auth/secure-request.ts (moved from go-api-session.ts, unchanged)
export function isSecureRequest(requestHeaders: Headers): boolean;
```

```ts
// src/infrastructure/identity/session-current-user-provider.ts
export class SessionCurrentUserProvider implements CurrentUserProvider {
  constructor(
    readSessionToken: () => Promise<string | undefined>,
    readActAs: () => Promise<string | undefined>,
    findSession: (token: string) => Promise<SessionPrincipal | null>,
    accounts: IdentityAccounts, // unchanged type
    config: { allowedGitHubIds: ReadonlySet<string>; demoLoginId?: string },
  );
  getCurrentUser(): Promise<AuthenticatedUser | null>;
}
// ACT_AS_PATTERN stays here and is exported for startActingAs (Task 2).
export const ACT_AS_PATTERN: RegExp; // /^password:[a-z0-9]{1,64}$/
```

The body is `TokenCurrentUserProvider`'s with `claims` replaced by the `SessionPrincipal` that `findSession` returns. The admin, member, FFPF, demo, guest and act-as branches do not change.

```ts
// src/presentation/http/session-gate.ts
// The proxy's gate: passes public routes and any request carrying zl_session;
// it never reads the database (the pages check the session itself).
export function sessionGate(
  request: NextRequest,
  next: (request: NextRequest) => NextResponse,
): NextResponse;
export function isPublicRoute(pathname: string): boolean; // unchanged list
export function isMetadataFile(pathname: string): boolean; // unchanged
```

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/session-cookies.test.ts`：
    - `a signed-in browser gets zl_session and loses the act-as and Go cookies`：`signedInCookieWrites({token:"T".repeat(43), maxAgeSeconds:2592000}, true)` が、順に次の 4 つ。
      - `zl_session`（値はトークン、`maxAge` 2592000）。
      - `zl_act_as`・`zl_access`・`zl_refresh`（値 `""`、`maxAge` 0）。
      - どれも `{httpOnly:true, sameSite:"lax", path:"/", secure:true}`。
    - `a guest's cookie lasts 24 hours`。
    - `signing out clears all four`。
    - `the act-as cookie lives 30 days`。
  - `tests/session-gate.test.ts`（`tests/go-proxy.test.ts` から、refresh のテストを除いて移す。`next` の偽物は呼ばれた回数を数え、`x-test-next: 1` を付ける）：
    - `a session cookie passes the gate without any lookup`：`zl_session=…` の `/logs` は `next` が 1 回。`globalThis.fetch` は呼ばれない（呼ばれたら投げる偽物に替える）。
    - `signed-out page requests go to /signin with the callback path`：`/logs?x=1` は 302 で、`Location` が `https://zhuelog.test/signin?callbackUrl=%2Flogs%3Fx%3D1`。
    - `the old Go cookies alone are signed out`：`zl_access=a; zl_refresh=r` の `/logs` は 302。
    - `signed-out /api requests get a 401 JSON that is not cached`：本文は `{"error":"認証が必要です。"}`、`Cache-Control: no-store`。
    - `signed-out Server Actions pass through to their own authorization`：`POST` で `next-action` のヘッダーがある。
    - `public routes pass while signed out`：`/signin`、`/api/auth/callback/github/go`、`/api/auth/callback/ffpf`、`/robots.txt`、`/sitemap.xml`、`/opengraph-image.png`。
    - `the LINE webhook and the cron routes are public`：`/api/line/webhook`、`/api/cron/line-drain`、`/api/cron/demo-reset`。
    - `a route that only looks public is gated`：`/signin/other`、`/api/authx`。
    - `the gate never sets cookies`：どの答えにも `set-cookie` が無い。
    - `only the metadata files Next.js serves for crawlers count as metadata files`（今のテストをそのまま）。
  - `tests/session-current-user-provider.test.ts`：今の 15 のテストを、`verify` の代わりに `findSession` の偽物で書き直す。すべての期待値は変えない。
    - 足すテスト `a cookie the store does not find is signed out`：`findSession` が `null`（期限切れ・消された行）→ `null`。
    - 足すテスト `no cookie never asks the store`：`findSession` が呼ばれない。
- [ ] **Step 2: テストが失敗することを確かめる。**
- [ ] **Step 3: 実装する。** `TokenCurrentUserProvider` を `git mv` で移し、名前を変える。まだ `current-user.ts` は直さない（Task 2）。そのため、この Task の間は古い名前を re-export する 1 行を `token-current-user-provider.ts` に残してよい（Task 2 で消す）。
- [ ] **Step 4: テストが通ることを確かめる。** `pnpm typecheck && pnpm lint`。
- [ ] **Step 5: コミット。** `feat(web): セッションの Cookie と、それで動く現在の利用者と門番を足す`

### Task 2: 切り替える（ログイン・ログアウト・コールバック・会員として見る・Proxy）

**Files:**

- Create: `src/composition/sign-in-container.ts`、`src/infrastructure/auth/web-session.ts`、`src/presentation/controllers/sign-in-controller.ts`
- Move (`git mv`): `src/infrastructure/go-api/github-oauth.ts` → `src/infrastructure/auth/github-oauth.ts`、`src/infrastructure/go-api/ffpf-oauth.ts` → `src/infrastructure/auth/ffpf-oauth.ts`（中身は、コメントの「through the Go API」を直すだけ）。`tests/go-api-github-oauth.test.ts` → `tests/github-oauth.test.ts`、`tests/go-api-ffpf-oauth.test.ts` → `tests/ffpf-oauth.test.ts`。
- Modify:
  - `src/composition/current-user.ts`、`src/composition/identity-container.ts`、`src/composition/account-container.ts`（なければ変えない）
  - `src/presentation/http/github-callback.ts`、`ffpf-callback.ts`
  - `src/presentation/actions/password-account-actions.ts`
  - `src/infrastructure/preferences/hsk-basis-cookie.ts`（`isSecureRequest` の import 先）
  - `src/infrastructure/config/environment.ts`、`src/app/signin/page.tsx`、`src/proxy.ts`
  - `src/infrastructure/go-api/client.ts`（ログイン・refresh・logout・`fetchMe`・`isDemoAvailable`・`GoTokens`・`GoMe`・`GoActingAs` を消す）
- Delete:
  - `src/infrastructure/go-api/go-api-session.ts`、`go-proxy.ts`、`session-cookies.ts`、`authed.ts`、`act-as.ts`、`current-path.ts`
  - `src/infrastructure/identity/access-token.ts`、`src/infrastructure/identity/token-current-user-provider.ts`（Task 1 の re-export）
  - `tests/access-token.test.ts`、`tests/go-proxy.test.ts`、`tests/go-api-session.test.ts`、`tests/go-api-session-cookies.test.ts`、`tests/go-api-authed.test.ts`
- Test: `tests/sign-in-controller.test.ts`（新規。`tests/go-api-session.test.ts` の確かめを移す）、`tests/github-oauth.test.ts`・`tests/ffpf-oauth.test.ts`（コールバックの部分を書き直す）、`tests/go-api-client.test.ts`（ログインの関数と `isAuthConfigured` のテストを消す）、`tests/identity-environment.test.ts`、`tests/vercel-config.test.ts`

**Interfaces:**

```ts
// src/infrastructure/auth/web-session.ts (next/headers; Server Actions and Route Handlers only for writes)
export async function readSessionToken(): Promise<string | undefined>;
export async function readActAsCookie(): Promise<string | undefined>;
export async function writeCookies(list: CookieWrite[]): Promise<void>;
export async function requestIsSecure(): Promise<boolean>; // isSecureRequest(await headers())
```

```ts
// src/composition/sign-in-container.ts
// One per instance: the JWKS cache and the warm dummy hash live here.
export const sessionStore: ReturnType<typeof createSessionStore>;
export const signIn: ReturnType<typeof createSignIn>;
// Ends the browser's previous session (a failure is logged as
// SESSION_END_FAILED with the error's name, never thrown) and returns the
// cookies to write for the new one.
export async function newSessionCookies(
  previousToken: string | undefined,
  session: IssuedSession,
  secure: boolean,
): Promise<CookieWrite[]>;
```

It is built from:

- `createSignIn`：
  - `throttle: createSignInThrottleStore(prisma)`
  - `passwordAccounts`（`prisma().passwordAccount.findUnique({where:{loginId}, select:{id, passwordHash, sessionVersion}})`）
  - `ffpfAccounts: createFfpfAccountStore(prisma)`
  - `passwords`（`new ScryptPasswordHasher()`。モジュールの読み込みで `void passwords.warm()`）
  - `sessions: sessionStore`
  - `github`：`githubOAuthConfig()` があれば `createGitHubOAuthClient(…)`、なければ `null`
  - `ffpf`：`ffpfIdConfig()` があれば `createFfpfOidcClient(…)`、なければ `null`
  - `allowedGitHubIds()`、`demoLoginId()`、`now`

```ts
// src/presentation/controllers/sign-in-controller.ts (pure; replaces goPasswordFailureUrl & co.)
export function passwordFailureUrl(
  reason: SignInFailure,
  redirectTo: string,
): string; // /signin?error=CredentialsSignin&callbackUrl=…
export function guestFailureUrl(redirectTo: string): string; // /signin?error=Unknown&callbackUrl=…
export function demoFailureUrl(
  reason: SignInFailure | "error",
  redirectTo: string,
): string; // DemoUnavailable or Unknown
export function oauthFailurePath(reason: SignInFailure | "error"): string; // "/signin?error=AccessDenied" for "forbidden", else "/signin?error=OAuthCallbackError"
```

`identity-container.ts`（関数の名前と引数は今のまま。中を Go から Web に替える）：

- `signInWithPassword({loginId, password, redirectTo})`：
  1. `client = clientAddress(await headers())`。
  2. `result = await signIn.withPassword(…)`。例外は投げたまま。
  3. 失敗 → `redirect(passwordFailureUrl(reason, redirectTo))`。
  4. 成功 → `writeCookies(await newSessionCookies(await readSessionToken(), result.session, await requestIsSecure()))` のあと、`redirect(redirectTo)`。
- `signInAsGuest(redirectTo)`：
  - 例外は `console.error("SIGN_IN_GUEST_FAILED", errorName(error))` をしてから `guestFailureUrl` へ。
  - `!ok` も `guestFailureUrl` へ（`console.error("SIGN_IN_GUEST_REFUSED", reason)`）。
- `signInAsDemo(redirectTo)`：同じ形で `demoFailureUrl`。コードは `SIGN_IN_DEMO_FAILED`・`SIGN_IN_DEMO_REFUSED`。
- `signInWithGitHub(redirectTo)`：
  - `githubOAuthConfig()` が無い → `/signin?error=Configuration`。
  - あれば、今の `signInWithGitHubViaGo` と同じく `zl_oauth` を書いて、authorize へ。
- `signInWithFfpf(redirectTo)`：`ffpfIdConfig()` で同じ形。
- `demoAvailable()`：`Promise.resolve(Boolean(demoLoginId()))`。
- `signOutTo(redirectTo)`：
  1. `token = await readSessionToken()`。
  2. あれば `sessionStore.end(token)`。失敗は `console.error("SESSION_END_FAILED", errorName(error))` だけ。
  3. `writeCookies(signedOutCookieWrites(secure))`。
  4. `redirect(redirectTo)`。
  - `signOutCurrentUser` は `signOutTo("/signin")`（今のまま）。
- `startActingAs(ownerId)`：
  1. `user = await getCachedCurrentUser()`。`user?.role !== "admin"` → false。
  2. `ACT_AS_PATTERN` に合わない → false。
  3. `prismaIdentityAccounts.findPasswordAccount(ownerId.slice("password:".length))` が `null` → false。
  4. `writeCookies([actAsCookieWrite(ownerId, secure)])` をして true。
- `stopActing()`：`clearedActAsCookieWrite`。

ほかの変更：

- `current-user.ts`：`new SessionCurrentUserProvider(readSessionToken, readActAsCookie, (t) => sessionStore.find(t, new Date()), prismaIdentityAccounts, {allowedGitHubIds: allowedGitHubIds(), demoLoginId: demoLoginId()})`。秘密の長さの警告は消す。
- `password-account-actions.ts`：`changeOwnPasswordAction` の最後を `signOutTo("/signin?notice=password-changed")` にする（`identity-container` から）。コメントを「the change already deleted every Session row of the member; signOutTo clears this browser's cookies」に。
- `github-callback.ts`・`ffpf-callback.ts`：
  - deps を `{ signIn: (input, client) => Promise<SignInResult>; sessionCookies: (previous, session, secure) => Promise<CookieWrite[]> }` にする。既定は `signIn.withGitHub`／`withFfpf` と `newSessionCookies`。
  - `zl_oauth` は、どの結果でも消す。
  - 成功 → `newSessionCookies(request.cookies.get(SESSION_COOKIE)?.value, …)` を書いて、`getSafeCallbackPath(saved.callbackPath)` へ 303。
  - 失敗 → `oauthFailurePath(reason)`。ログは `console.warn("SIGN_IN_GITHUB_REFUSED", reason)`。
  - 例外 → `oauthFailurePath("error")`。ログは `console.error("SIGN_IN_GITHUB_FAILED", errorName(error))`。
  - FFPF ID も同じ形。コードは `SIGN_IN_FFPF_*`。
  - `state` が合わない・`error` がある・Cookie が無いときは、今と同じく `signIn` を呼ばない。
- `environment.ts`：
  - `isAuthConfigured`・`apiJwtSecret` を消す。
  - `isSafeGoApiUrl` を `isHttpsOrLoopbackUrl` に名前替えし、`client.ts` の 1 か所も直す。
  - `ffpfIdConfig()` は `{issuer, clientId, clientSecret}` を返し、`FFPF_ID_CLIENT_SECRET` も要る。11a の `ffpfIdClientSecret` はこの中に畳む。
  - 先頭のコメントの「Sign-in goes through the Go API」を消す。
- `signin/page.tsx`：`isConfigured = Boolean(githubOAuthConfig())`。ほかは変えない。
- `src/proxy.ts`：`return sessionGate(request, passThrough)`。`passThrough(request)` は `request.headers` を基にする（cookie のヘッダーを書き換えない）。`refreshTokens`・`goProxy` の import を消す。
- `tests/vercel-config.test.ts`：`goProxy` の代わりに `sessionGate` で、cron の道が公開であることを確かめる。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/sign-in-controller.test.ts`：
    - `invalid and throttled both lead to the one credential rejection URL`：`/signin?error=CredentialsSignin&callbackUrl=%2Flogs%3Fa%3D1`。
    - `the failure URL never carries the login id or password`：`passwordFailureUrl` は入力を受け取らない（型で確かめ、URL に `alice` が無い）。
    - `any guest failure shows the generic message`。
    - `a demo that is off says so; other demo failures are generic`：`demo-unavailable` → `DemoUnavailable`。`throttled`・`error` → `Unknown`。
    - `only a forbidden GitHub sign-in is AccessDenied`：`forbidden` → `/signin?error=AccessDenied`。`invalid`・`unavailable`・`throttled`・`error` → `/signin?error=OAuthCallbackError`。
  - `tests/github-oauth.test.ts`（コールバックの部分）：
    - `a successful callback sets zl_session, clears the act-as and Go cookies and goes to the saved path`：
      - `Set-Cookie` は 5 つ：`zl_oauth=;`、`zl_session=<token>; Max-Age=2592000`、`zl_act_as=;`、`zl_access=;`、`zl_refresh=;`。
      - どれも `HttpOnly; SameSite=lax; Path=/`。
      - 303 の行き先は `/notes?x=1`。
      - `signIn` には `{code, verifier: 保存した verifier, redirectUri: "https://zhuelog.test/api/auth/callback/github/go"}` と client が渡る。
    - `a browser's previous session is handed over to be ended`：`zl_session=<old>` を付けると、`sessionCookies` の偽物が `<old>` を受け取る。
    - `an unsafe saved path falls back to /`。
    - `a state mismatch is rejected without signing in`。
    - `an error parameter or a missing cookie is rejected`。
    - `forbidden is AccessDenied; other failures and errors are OAuthCallbackError`：`forbidden`、`invalid`、`unavailable`、`throttled` と、投げる `Error("db")`。それぞれ `zl_session` は書かれず、`zl_oauth` は消える。
    - `nothing secret is logged`：`console` の偽物に、code・state・verifier・トークンが出ない。
  - `tests/ffpf-oauth.test.ts`：同じ形。成功のテストでは、`signIn` に保存した `nonce` が渡る。失敗はすべて `OAuthCallbackError`。
  - `tests/identity-environment.test.ts`：
    - `ffpfIdConfig needs the issuer, the client id and the secret`：秘密が無いと `undefined`。
    - `ffpfIdConfig keeps the https-or-loopback rule for the issuer`：`http://ffpf.example` → `undefined`、`http://127.0.0.1:3110` → ok。
- [ ] **Step 2: テストが失敗することを確かめる。**
- [ ] **Step 3: 実装する。** 上のとおり。Go の部品を消したあと、次の grep で何も出ないことを確かめる。
  - `grep -rn "go-api-session\|go-proxy\|go-api/session-cookies\|go-api/authed\|go-api/act-as\|current-path\|access-token\|apiJwtSecret\|isAuthConfigured\|refreshTokens\|loginPassword\|loginGuest\|loginDemo\|loginGitHub\|loginFFPF\|fetchMe\|isDemoAvailable\|GoTokens\|readAccessToken\|x-zhuelog-path" src tests`
- [ ] **Step 4: 確かめる。** `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`。e2e はまだ直していない（Task 3）ので、ここでは走らせない。
- [ ] **Step 5: コミット。** `feat(web): ログインとログアウトを Web のセッションに切り替える`

### Task 3: e2e を Web のセッションに合わせ、Go を起動しない

**Files:**

- Modify:
  - `e2e/environment.ts`、`e2e/server.ts`、`e2e/fixtures.ts`
  - `e2e/accounts.spec.ts`、`e2e/ffpf-login.spec.ts`、`e2e/security.spec.ts`（と、`grep -rn "zl_\|cookieName\|goApiURL\|goJwtSecret" e2e` に出るほかの spec）
  - `scripts/lighthouse.mjs`
- Delete: `e2e/go-session.spec.ts`
- Create: `e2e/session.spec.ts`

**決まり：**

- `e2e/environment.ts`：
  - `goApiURL`・`goJwtSecret`・`goProxySecret` を消す。
  - `cookieName` を `sessionCookieName = "zl_session"` にする。
  - 先頭のコメントの「The web signs in through the Go API」を消す。
- `e2e/server.ts`：
  - `startGoApi` と、Go の `env`、`api` のプロセスの扱いを消す。
  - Web の `env` から `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す。
  - `GITHUB_WEB_CLIENT_SECRET: "e2e-github-secret"` を足す（コメント「Enables the GitHub button only; there is no GitHub stub and the e2e never completes a GitHub sign-in」）。
  - `FFPF_ID_CLIENT_SECRET: ffpf.clientSecret` を足す。
  - `ffpf` のコメントを「the web is its client」にする。
- `e2e/fixtures.ts`：
  - `TRUNCATE` の最初の文に `"Session"` を足す。
  - `X-Forwarded-For` のコメントを「Each test gets its own client address, so the per-client sign-in limits in SignInThrottle never carry over within a test file's flow」にする。
  - `addAdminSession` は、次の行を入れて、その token を `zl_session` に置く。コメントは「Test-only session row, as the web's sign-in writes it. No app auth bypass.」。
    - `token = randomBytes(32).toString("base64url")`
    - `INSERT INTO "Session" ("id","tokenHash","ownerId","role","login","expiresAt") VALUES ($1,$2,$3,'admin',$4, NOW() + interval '1 hour')`
    - `$1 = "c" + randomBytes(12).toString("hex")`、`$2 = createHash("sha256").update(token).digest("hex")`
  - `addAdminSession` は `db` も受け取る。呼ぶ所（`asAdmin`）も直す。
  - `goAccessToken` を消す。
- `e2e/session.spec.ts`（新規。`go-session.spec.ts` の代わり）：
  - `signing in stores only the token's hash, and signing out deletes the row`：
    - `createMember` → `asMember`。
    - `zl_session` は 43 文字で、`httpOnly`、`sameSite: "Lax"`。`expires` は今から 2_592_000 秒後の ±120 秒。
    - `Session` は 1 行。
      - `tokenHash` は `sha256(cookie)`。
      - `ownerId` は `password:<id>`、`role` は `member`、`sessionVersion` は 0、`login` は null。
      - どの列にも Cookie の値そのものは無い（`SELECT count(*) FROM "Session" WHERE "tokenHash" = $1 OR "id" = $1` に Cookie の値で 0）。
    - `signOut` → 行は 0、`zl_session` は無い。
    - 古い Cookie を戻して `/logs` → `/signin` へ。
  - `a planted session cookie and Go's old cookies are replaced at sign-in`：
    - 先に `zl_session = "A".repeat(43)`、`zl_access = "x"`、`zl_refresh = "y"` を置いてから `asMember`。
    - `zl_session` は `"A"…` と違う。`zl_access`・`zl_refresh` は無い。`Session` は 1 行。
  - `a guest session lasts 24 hours and is shared by the owner id guest`：Cookie の `expires` が 86_400 秒後の ±120 秒。行は `role` `guest`、`ownerId` `guest`。
  - `an expired session is signed out`：`UPDATE "Session" SET "expiresAt" = NOW() - interval '1 second'` → `/logs` は `/signin` へ。
  - `a sign-in prunes expired sessions`：期限切れの行を 3 つ直接入れて `asGuest` → 3 つとも無い。
  - `the old Go cookies alone are signed out`：`zl_access`・`zl_refresh` だけで `/logs` → `/signin`。
- `e2e/accounts.spec.ts`：
  - `goAuth`・`refreshCookie`・`goApiURL` の import を消す。
  - 「reset revokes existing member sessions」を書き直す。
    - 会員を 2 つのブラウザーでログインさせる（`memberContext` と `secondContext`）。
    - 再設定の前は、`SELECT count(*) FROM "Session" WHERE "ownerId" = 'password:' || $1` が 2。
    - 再設定のあとは 0。
    - 2 つのブラウザーとも `/logs` が `/signin` へ。
    - 古いパスワードは失敗し、新しいパスワードでログインできる。
  - 「a created member signs in through Go with the password the web hashed」の名前を「a created member signs in with the password the web hashed」にする。
  - 「member changes own password」の最後に、その会員の `Session` が 0 行であることを足す。
- `e2e/ffpf-login.spec.ts`：
  - `sessionCookies` は `zl_session` だけを返す。
  - FFPF ID でのログインのあと、`Session` に `ownerId` `ffpf:e2estub01`、`role` `member`、`sessionVersion` 0 の行が 1 つある。
  - ログアウトのあと、Cookie も行も無い。
  - 上のコメントの「hands it to the Go API, which exchanges it」を「the web exchanges it at the stub and verifies the ID token itself」にする。
- `e2e/security.spec.ts`：
  - 「revoked admin JWT …」を「a de-listed admin's session cannot access pages or import actions」にし、`addAdminSession(context, db, {githubId: "removed", login: "removed"})` を使う。
  - `cookieName` を `sessionCookieName` にする（ゲストの Cookie の `HttpOnly`・`Lax`）。
- `scripts/lighthouse.mjs:104`：`zl_session`。

- [ ] **Step 1: 直す。**
- [ ] **Step 2: 全体を確かめる。**
  - `docker ps` で、ほかの e2e が無いことを確かめる。
  - `pnpm test:regression` → PASS。Go を起動しないこと（`e2e/server.ts` の出力に `go build` が無い）も確かめる。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 3: コミット。** `test(e2e): Web のセッションでログインを確かめ、Go を起動しない`

### Task 4: Go のログインを消す（Go は health だけ）

**Files:**（参照 §14 の表のとおり）

- 消す（パッケージごと）：`services/api/auth/`（`password_golden_test.go` も）、`jsstr/`、`httpclient/`。
- 消す（ファイル）：
  - `httpapi/auth_handlers.go`、`auth_handlers_test.go`、`demo.go`、`demo_test.go`、`owner.go`、`act_as_test.go`、`throttle_db_test.go`
  - `store/accounts.go`、`accounts_test.go`、`ffpf_accounts.go`、`ffpf_accounts_test.go`、`refresh_tokens.go`、`refresh_tokens_test.go`、`throttle.go`、`throttle_test.go`
- 直す：
  - `httpapi/router.go`・`middleware.go`・`respond.go`：参照 §14 の「keep」のものだけを残す。
  - `httpapi/router_test.go`：`TestPublicRouteSetIsExactlyTheKnownRoutes` の `want` を `GET /health`・`GET /healthz`・`GET /ping` だけにする。`TestNoRouteAcceptsUserParam`・`TestRoutesRejectGuests` を消す。`TestRetiredSignInRoutesAre404` を足す（`POST /v1/auth/password`、`POST /v1/auth/refresh`、`GET /v1/auth/demo`、`GET /v1/me` → 404 `not_found`）。
  - `httpapi/middleware_test.go`：`TestRecoverReturns500`・`TestRecoverAfterHeadersSentKeepsResponse`・`TestRecoverRepanicsAbortHandler`・`TestNoStoreHeader`・`TestNotFoundAndMethodNotAllowed`・`TestHealthz`・`TestPingDoesNotTouchDatabase`・`TestAccessLogFields` を残す。ほかは消す。
  - `httpapi/testutil_test.go`：使われなくなった偽物を消す。
  - `store/store.go`：参照 §14 のとおり。`store_test.go` から `TestNewIDFormat` を消す。`testhelpers_test.go`・`testdb_test.go` は、`TestOpenAndPing` が使うものだけを残す。
  - `config.go`：`Config{Port, DatabaseURL}`。`LoadConfig` は `PORT`（既定 `8080`）と、必須の `DATABASE_URL` だけを読む。
  - `config_test.go`：`TestLoadConfigDefaults`（`PORT` が無ければ `8080`）、`TestLoadConfigMissing`（`DATABASE_URL` が無いと `DATABASE_URL is required`）を残す。`TestLoadConfigIgnoresRetiredVariables` を足す（`API_JWT_SECRET=short`、`GITHUB_WEB_CLIENT_ID=x` だけ、`FFPF_ID_ISSUER=http://evil` があっても、エラーにならない）。ほかは消す。
  - `main.go`：`store.Open` → `httpapi.NewRouter(httpapi.Deps{DB: db, Logger: logger})` → serve。`newGitHubHTTPClient` と auth を消す。
  - `main_test.go`：`TestRunStartupFailureDoesNotLeakDatabaseURL`・`TestShutdownTimeoutFitsStopGrace` を残す。`TestRunEndToEnd` は `/ping` 200、`/health` 200、`POST /v1/auth/password` 404 にする。`TestNewGitHubHTTPClientRefusesRedirects` を消す。
  - `go mod tidy`。
- `scripts/api-smoke.sh`：`GET /health` 200、`GET /ping` 200、`POST /v1/auth/password` 404 だけにする。先頭のコメントを「the Go API serves only its health routes since stage 11」にする。
- `scripts/api-local-seed.ts`・`scripts/api-local-env.sh`：Go のログインのための値（`API_JWT_SECRET` など）は段階 12 で消すので、今は「unused since stage 11」のコメントを 1 行だけ足す。
- Web：
  - `tests/scrypt-password-hasher.test.ts` などの golden のテストのコメントにある「the golden file Go writes」を、「the golden file Go wrote before its auth package was removed (stage 11b); it is now a fixed file」にする。
  - `src/infrastructure/security/scrypt-password-hasher.ts` の先頭のコメントも同じ。
  - `src/domain/identity/sign-in-throttle.ts` の「so the web and Go's sign-in share the same counts until sign-in moves too」を「Go's keys and numbers, kept so the counts in SignInThrottle carried over when sign-in moved (stage 11)」にする。
  - `src/infrastructure/prisma/sign-in-throttle-store.ts`、`password-account-store.ts` の「Go's sign-in, which stays until stage 11」の類いを直す。
- docs-site（段階 1〜10 と同じ扱い）：
  - `docs-site/guide/auth.md`・`docs-site/reference/auth.md` を消し、`.vuepress/config.ts` のナビとサイドバーから外す。
  - `docs-site/README.md` は「Go に残るのは health だけで、サイトは段階 12 で消す」にする。認証・トークン・環境変数の表は `PORT`・`DATABASE_URL` だけにする。
  - `docs-site/reference/README.md`・`errors.md`・`operations/deploy.md`・`operations/local.md` から、ログイン・トークン・`API_*`・`GITHUB_*`・`FFPF_*`・`DEMO_LOGIN_ID` を消す。

- [ ] **Step 1: Go を消す。**
  - `cd services/api && go mod tidy && gofmt -l . && go vet ./... && go build ./... && go test ./...` → 成功（`store` の DB のテストは開発用 DB（Docker）で）。
  - `grep -rn "auth\.\|jwt\|scrypt\|RefreshToken\|SignInThrottle\|PasswordAccount\|FfpfAccount\|API_JWT_SECRET\|API_WEB_PROXY_SECRET\|GITHUB_\|FFPF_\|DEMO_LOGIN_ID\|AUTH_ALLOWED" services/api` → 何も出ない。
  - `grep -n "golang-jwt\|x/crypto" services/api/go.mod` → 何も出ない。
- [ ] **Step 2: docs-site とスクリプトを直す。** `node_modules/.bin/vuepress build docs-site` が通る（`docs-site/.vuepress/dist` はコミットしない）。
- [ ] **Step 3: 全体を確かめる。** `pnpm test:regression` → PASS（e2e は Go を使わない）。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go のログインを消し、Go を health だけにする`

### Task 5: ドキュメント

**Files:** `README.md`、`docs/architecture.md`、`docs/features.md`、`docs/roadmap.md`、`docs/api-deployment.md`、`docs/api-local.md`、`docs/development.md`、`.env.example`、`docs-site/`（`.vuepress/dist` を除く。Task 4 の残り）

段階 7〜10 の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、`grep` で探してすべて直す。

- [ ] **Step 1: 直す。**
  - `README.md`：
    - API の行を「Go（標準の `net/http`）。段階 11 で、ログインも Web に移り、Go に残るのは `/health` だけです（段階 12 で消します）」にする。
    - DB の行の「Go API はログイン（refresh token とログインの試行回数）だけを受け持ちます」を消し、Web が書くものに「ログインのセッション（`Session`）とログインの試行回数」を足す。
    - 手元の起動の説明から、Go を動かす手順を「要らなくなった」に直す。
  - `docs/architecture.md`：
    - mermaid から、Web → Go のログインの矢印を消す（Go は health だけの箱にするか、消す）。
    - ログインの節を書き直す。
      - `zl_session`（ハッシュを `Session` に）、30 日・ゲスト 24 時間（延ばさない）。
      - 毎回の確かめ：許可リスト・`sessionVersion`・`zl_act_as`・デモ。
      - ログアウトで行を消す。パスワードの変更・再設定で、その人の行をすべて消す。
      - Proxy は Cookie があるかだけを見る。
      - 期限切れの行は、ログインのたびに 100 行まで消す。
    - 「会員として操作」の節を、Go の確かめから Web の確かめに直す。
  - `docs/features.md`：ログイン・ゲスト・デモ・FFPF ID の箇条から Go を消す。「30 日でログインし直す」を足す。
  - `docs/roadmap.md`：「移行中の Go API（ログイン）」を「移行中の Go API（health だけ。段階 12 で消す）」にする。
  - `docs/api-deployment.md`：
    - §3 の Go の表を `DATABASE_URL`・`GOFLAGS` だけにする。ほかは「段階 11b で Go から外した。Go の Vercel プロジェクトからも消してよい」と 1 行で書く。
    - 「6. Web の設定」の表と「Web が実行時に使う DB と秘密」を直す。
      - `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` は「段階 11b から読まない（段階 12 で消す）」にする。
      - `GITHUB_WEB_CLIENT_SECRET`・`FFPF_ID_CLIENT_SECRET` を足す。
      - `AUTH_URL` が GitHub と FFPF ID の `redirect_uri` を決めることを書く。
      - 足りないときの症状を書く。秘密が無いと、GitHub のボタンが押せない・FFPF ID のボタンが出ない。`AUTH_URL` が違うと、GitHub と FFPF ID が登録した URL と合わず、ログインできない。
    - 「9. FFPF ID でのログイン」と「10. デモアカウント」から Go を消す。
    - 「運用上の注意」から、`API_JWT_SECRET` のローテーション・リフレッシュの猶予・ゲストとデモのセッションの Go の説明を消し、Web のセッションの説明（長さ、掃除、全員をログアウトさせたいときは `DELETE FROM "Session"`）にする。
    - 11a の Task 5 で作った「段階11（ログイン）のマージの前と後」の「##### 11b のマージの前と後」を書く。
      - **マージの前に、利用者が行うこと**：
        1. 11a が本番にあり、`migrate status` が up to date であること。
        2. Web の Production に `GITHUB_WEB_CLIENT_SECRET` と `FFPF_ID_CLIENT_SECRET` があること（11a で入れていなければ、ここで入れる。値は Go と同じ。GitHub の値を読み戻せないときは、新しい Client Secret を作る。古い Secret は手順 4 まで消さない）。
        3. Web の Production の `AUTH_URL` が `https://ffpf-zhuelog.sparklingstadt.com` であること（GitHub と FFPF ID の `redirect_uri` を、Go の `GITHUB_WEB_REDIRECT_URI`・`FFPF_ID_REDIRECT_URI` と 1 文字も違わない値にするため）。
        4. GitHub の OAuth App の callback URL は変えない（`/api/auth/callback/github/go` は、登録済みの `/api/auth/callback/github` の下）。FFPF ID の portal に登録した redirect URI も変えない。
        5. マイグレーションは無い（11a で済み）。
      - **マージのあと**：
        1. Web の Production のデプロイが Ready になる。
        2. `vercel promote` する。この時点で、全員のログインが切れる（`zl_access`・`zl_refresh` は使われない）。自分も含め、一度ログインし直す。
        3. 確かめる：
           - パスワード・ゲスト・デモ・FFPF ID・GitHub（管理者）でログインできる。
           - `SELECT "role", count(*) FROM "Session" GROUP BY 1` に行が増える。
           - ログアウトで自分の行が消える。
           - 「会員として見る」が動く。
        4. main から Go を再デプロイする（実行の前に、使う人に確かめる）。
        5. `curl -i https://ffpf-zhuelog-api.vercel.app/v1/auth/password -X POST` が `404`、`/health` が `200` であることを確かめる。
        6. Go の Vercel プロジェクトから、`DATABASE_URL` と `GOFLAGS` のほかを消してよい（段階 12 でプロジェクトごと消す）。
           - 消してよいもの：`API_JWT_SECRET`、`API_WEB_PROXY_SECRET`、`AUTH_ALLOWED_GITHUB_IDS`、`GITHUB_MOBILE_*`、`GITHUB_WEB_*`、`FFPF_ID_*`、`DEMO_LOGIN_ID`。
           - 古い GitHub の Client Secret は、ここで消してよい。
        7. Web の Production の `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` は、もう読まれない。消すのは段階 12 のコードと一緒にする。
      - **戻すとき**：
        - Web だけを戻すと、ログインは Go に戻る。手順 4 の前ならそのまま動く。手順 4 のあとなら、Go も前のデプロイに戻す（Vercel の **Instant Rollback**）。
        - `Session` の行は残るが、害は無い。
        - 手順 6 で Go の値を消したあとは、戻す前に値を戻す。
  - `docs/api-local.md`：手元の Web のログインに Go が要らなくなったことを書く。Go のログインの `curl` の例を消し、health だけにする。
  - `docs/development.md`：
    - 手元の起動から Go を外す（DB と Web だけ）。
    - e2e は Go を起動しない。
    - `GITHUB_WEB_CLIENT_SECRET`・`FFPF_ID_CLIENT_SECRET`（手元で FFPF ID を試すときだけ）を書く。
  - `.env.example`：
    - Web の欄の `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` のコメントを「段階 11b から読まない（段階 12 で消す）」にする。
    - `zl_access` を確かめる説明を消す。
    - Go 用の欄を `DATABASE_URL`・`PORT` だけにする。
  - `docs-site/`：Task 4 で消し残したログインの記述が無いことを確かめる。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "zl_access\|zl_refresh\|/v1/auth\|/v1/me\|refresh token\|リフレッシュ\|API_JWT_SECRET\|API_WEB_PROXY_SECRET\|GO_API_URL\|GITHUB_WEB_REDIRECT_URI\|FFPF_ID_REDIRECT_URI\|Go API でログイン\|Go のログイン" README.md docs docs-site .env.example --include='*.md' --include='*.example' --include='*.ts' | grep -v "docs/superpowers\|docs/releases\|\.vuepress/dist"` の結果を 1 行ずつ読む。
  - Go がログインを行う・Web が JWT を確かめる、と書いた所が残っていないことを確かめる。
  - 「段階 N のマージの前と後」の節の、歴史としての説明は残してよい。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: ログインを Web のセッションに移し、Go を health だけにしたことを書く`
