# Web のログインを Go API に移す（段階2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GO_API_URL` が設定されたときだけ、Web のログイン・ログアウト・今の利用者の取得を Go API で行う。

**Architecture:** Go API にゲスト・`/v1/me`・Web 用 OAuth App・リフレッシュの猶予・信頼する IP ヘッダーを足す。Next.js は Go のトークンを HttpOnly Cookie に入れ、`proxy.ts` でリフレッシュし、`GoApiCurrentUserProvider` が `/v1/me` で利用者を決める。未設定なら今の Auth.js のまま。

**Tech Stack:** Go 1.x net/http・pgx/v5・golang-jwt / Next.js 16（App Router、`src/proxy.ts`）・node:test（`tests/*.test.ts`）・Playwright。

**Spec:** `docs/superpowers/specs/2026-10-21-web-auth-via-go-api-design.md`

## Global Constraints

- スキーマ・マイグレーションは変えない。
- `GO_API_URL` が未設定のとき、Web の動きは 1 つも変えない（既存の unit・e2e がそのまま通る）。
- Next.js のコードを書く前に `node_modules/next/dist/docs/` の該当ガイド（`cookies`、`proxy`、Route Handlers、Server Actions）を読む。このリポジトリの Next.js は学習データと違う。
- Cookie 名：`zl_access`・`zl_refresh`・`zl_oauth`。`HttpOnly`・`SameSite=Lax`・`Path=/`、要求が HTTPS のとき `Secure`。`zl_access` の maxAge = `expiresIn - 60` 秒、`zl_refresh` = 30 日、`zl_oauth` = 600 秒。
- ヘッダー名：`X-Zhuelog-Client-IP`・`X-Zhuelog-Proxy-Secret`。環境変数：`API_WEB_PROXY_SECRET`（32 バイト以上）、`GO_API_URL`、Go 側 `GITHUB_WEB_CLIENT_ID`・`GITHUB_WEB_CLIENT_SECRET`・`GITHUB_WEB_REDIRECT_URI`。
- リフレッシュの猶予は 30 秒。Go API を呼ぶタイムアウトは 10 秒。
- Web の GitHub callback のパスは `/api/auth/callback/github/go`。
- 文言は今の `src/app/signin/page.tsx` の `errorMessages` のキー（`CredentialsSignin`・`AccessDenied`・`Configuration`・`OAuthCallbackError`）を使う。新しい文言は足さない。
- ログ・エラーに、トークン・パスワード・秘密を出さない。
- コメントは英語、ドキュメントは日本語（周りに合わせる）。`--no-verify` を使わない。

## Review Focus

1. 同じリフレッシュトークンで同時にリフレッシュが 2 回来る → 両方成功し、ログアウトされない（Task 3 のテスト）。
2. ゲストのトークンで書き込みのルートを呼ぶ → `403`。ゲストが owner `"guest"` としてノートを作れない（Task 1 のルート表のテスト）。
3. `X-Zhuelog-Client-IP` を直接 Go API に送る攻撃者（秘密なし・違う秘密）→ ヘッダーは無視される（Task 4）。
4. `zl_oauth` が無い・state が違う・`?error=access_denied` で戻る → `/signin?error=OAuthCallbackError`、トークンは出さない（Task 8）。
5. Go API が落ちている・タイムアウト → proxy は Cookie を消さず、ページは「ログインしていない」扱いで `/signin` に送られる（Task 9）。サインインの操作は Configuration ではなく一般のエラーを投げる。

---

### Task 1: Go — ゲストと `GET /v1/me`、ゲストの締め出し

**Files:**

- Modify: `services/api/auth/token.go`（`RoleGuest = "guest"`、Issue/Verify でゲストを扱う。ゲストは `login`・`sv` を持たない）
- Modify: `services/api/auth/session.go`（`principalFromRow`・`checkCurrent` にゲスト。ゲストは常に有効）
- Modify: `services/api/auth/login.go`（`LoginGuest`）
- Create: `services/api/auth/me.go`（`Me`）
- Modify: `services/api/httpapi/router.go`、`middleware.go`、`auth_handlers.go`
- Test: `services/api/auth/token_test.go`、`service_test.go`、`services/api/httpapi/auth_handlers_test.go`、`router_test.go`

**Interfaces:**

- Produces（auth）：
  - `const GuestOwnerID = "guest"`
  - `func (s *Service) LoginGuest(ctx context.Context) (TokenPair, error)` — `startSession(Principal{OwnerID: GuestOwnerID, Role: RoleGuest})`
  - `type Me struct { OwnerID, Role, Login, DisplayName, AccountID string }`
  - `func (s *Service) Me(ctx context.Context, p Principal) (Me, error)` — 会員は `FindPasswordAccountByID(memberAccountID(p))` から `Login`（loginId）・`DisplayName`・`AccountID`。見つからなければ `ErrUnauthorized`。admin は `Login` だけ。ゲストは `Login: "guest"`。
- Produces（httpapi）：`Auth` interface に `LoginGuest`・`Me` を足す。`route` に `allowGuest bool`。
  - `POST /v1/auth/guest`（public、limited、本文は空でも `{}` でも可）→ `writeTokens`
  - `GET /v1/me`（authed、allowGuest）→ `200 {"ownerId","role","login","displayName"?,"accountId"?}`（空の値は省く）
  - `requireAuth(a Auth, allowGuest bool, next)`：`p.Role == auth.RoleGuest && !allowGuest` なら `403`（`writeError(w, 403, codeForbidden, msgForbidden)` — 既存の 403 の形を使う）。

- [ ] **Step 1: 失敗するテストを書く**
  - `TestSignerGuestRoundTrip`：`Issue(Principal{OwnerID:"guest", Role:"guest"})` → `Verify` で同じ Principal。
  - `TestLoginGuest`：トークン一式が返り、`Refresh` でゲストのまま回せる（`principalFromRow` がゲストを読める）。
  - `TestMeMember`：会員の `Me` が `{OwnerID:"password:<id>", Role:"member", Login:<loginId>, DisplayName, AccountID:<id>}`。`TestMeMemberMissing` → `ErrUnauthorized`。
  - `TestGuestEndpoint`：`POST /v1/auth/guest` → 200 とトークン。
  - `TestMeEndpoint`：admin・member・guest で 200 と期待の JSON。
  - `TestRoutesRejectGuests`（router_test.go）：ルート表のうち `authed && !allowGuest` の全ルートに、ゲストの Principal を返すフェイクの Auth で要求 → すべて `403`。`allowGuest` のルートは `GET /v1/me` だけであることも確かめる。
- [ ] **Step 2: `cd services/api && go test ./...` で失敗を確かめる**
- [ ] **Step 3: 実装する**（上の Interfaces どおり）
- [ ] **Step 4: `go test ./... && go vet ./...` が通る**（DB のテストは `API_TEST_DATABASE_URL` を設定して実行）
- [ ] **Step 5: Commit** `feat(api): ゲストのログインと GET /v1/me を足す`

### Task 2: Go — Web 用の GitHub OAuth App

**Files:**

- Modify: `services/api/config.go`（`GitHubWebClientID`・`GitHubWebClientSecret`・`GitHubWebRedirectURI`。3 つとも空か、3 つとも設定。片方だけならエラー `GITHUB_WEB_CLIENT_ID, GITHUB_WEB_CLIENT_SECRET and GITHUB_WEB_REDIRECT_URI must be set together`）
- Create: `services/api/auth/github_apps.go`
- Modify: `services/api/main.go`
- Test: `services/api/config_test.go`、`services/api/auth/github_apps_test.go`

**Interfaces:**

- Produces：`type GitHubApps []*GitHubClient` と `func (a GitHubApps) Exchange(ctx, code, verifier, redirectURI string) (GitHubUser, error)` — `RedirectURI` が完全一致した最初のクライアントで交換。一致が無ければ、既存の `GitHubClient.Exchange` が不一致のときに返すのと同じエラー（`ErrUnauthorized` 系。github.go:56 を参照）。`main.go` は `GitHub: auth.GitHubApps{mobile, web?}`。

- [ ] **Step 1: テスト**：`TestGitHubAppsPicksByRedirectURI`（2 つのクライアントのうち、redirectURI が一致した方だけがフェイクの GitHub サーバーに呼ばれる。`client_id` で見分ける）、`TestGitHubAppsUnknownRedirect`、`TestLoadConfigGitHubWebAllOrNone`。
- [ ] **Step 2: 失敗を確かめる**
- [ ] **Step 3: 実装**
- [ ] **Step 4: `go test ./...` が通る**
- [ ] **Step 5: Commit** `feat(api): Web 用の GitHub OAuth App を選べるようにする`

### Task 3: Go — リフレッシュの猶予

**Files:**

- Modify: `services/api/auth/session.go`（`Refresh`）、`services/api/auth/service.go`（`Store` interface）
- Modify: `services/api/store/refresh_tokens.go`
- Test: `services/api/auth/service_test.go`、`services/api/store/refresh_tokens_test.go`

**Interfaces:**

- Produces（store）：`func (s *Store) FamilyActive(ctx context.Context, familyID string, now time.Time) (bool, error)` — `revokedAt IS NULL AND expiresAt > now` の行がファミリーにあるか。
- `const RefreshReuseGrace = 30 * time.Second`（auth）
- `Refresh` の `row.RevokedAt != nil` の分岐：`now.Sub(*row.RevokedAt) <= RefreshReuseGrace` かつ `FamilyActive` なら、`principalFromRow`・`checkCurrent`（失敗時は今と同じくファミリー失効）を通したうえで `newPair(p, row.FamilyID, now)` を `InsertRefreshToken` して返す（ファミリーは失効させない）。それ以外は今までどおり `revokeFamily`。

- [ ] **Step 1: テスト**：
  - `TestRefreshConcurrentWithinGrace`：RT1 で Refresh → RT2。10 秒後に RT1 で Refresh → 成功（RT3）。RT2・RT3 どちらでもその後 Refresh できる。
  - `TestRefreshReuseAfterGrace`：31 秒後に RT1 → `ErrUnauthorized`、ファミリー失効（RT2 も使えない）。
  - `TestRefreshReuseAfterFamilyRevoked`：Logout（またはファミリー失効）後、猶予内でも RT1 → `ErrUnauthorized`。
  - `TestRefreshGraceStillChecksRevocation`：猶予内でも会員の sessionVersion が上がっていれば `ErrUnauthorized`。
  - store：`TestFamilyActive`（有効な行あり・全部失効・期限切れ）。
- [ ] **Step 2〜4: 失敗 → 実装 → `go test ./...`**
- [ ] **Step 5: Commit** `feat(api): 同時のリフレッシュでログアウトされないよう 30 秒の猶予を設ける`

### Task 4: Go — Next.js から渡されるクライアントの IP

**Files:**

- Modify: `services/api/config.go`（`WebProxySecret []byte`、任意、設定するなら 32 バイト以上。エラー `API_WEB_PROXY_SECRET must be at least 32 bytes`）
- Modify: `services/api/httpapi/router.go`（`Deps.WebProxySecret []byte`）、`middleware.go`（`clientKey`）、`auth_handlers.go`、`main.go`
- Test: `services/api/httpapi/middleware_test.go`、`services/api/config_test.go`

**Interfaces:**

- `clientKey` を `func clientKeyFunc(secret []byte) func(*http.Request) string` に替える（rate limiter と `loginPassword` の両方がこれを使う）。`len(secret) > 0` かつ `X-Zhuelog-Proxy-Secret` が `subtle.ConstantTimeCompare` で一致し、`X-Zhuelog-Client-IP` が空でない（前後の空白を除く）ときはその値。それ以外は今の処理。

- [ ] **Step 1: テスト**：`TestClientKeyTrustsWebProxy`（一致 → ヘッダーの値）、`TestClientKeyIgnoresWrongSecret`、`TestClientKeyIgnoresWhenUnset`（秘密が空なら、正しそうなヘッダーでも XFF を使う）、`TestClientKeyEmptyForwardedIP`、`TestPasswordLoginThrottleUsesWebClientIP`（2 人の利用者が同じ Next.js から来ても、IP が違えば別に数えられる）、config の長さのテスト。
- [ ] **Step 2〜4: 失敗 → 実装 → `go test ./...`**
- [ ] **Step 5: Commit** `feat(api): Next.js から渡された利用者の IP でログイン試行を数える`

### Task 5: Go のドキュメント

**Files:**

- Modify: `docs/api-deployment.md`（環境変数の表に 4 つ、レート制限の節に `X-Zhuelog-Client-IP` の条件、リフレッシュの猶予）
- Modify: `docs-site/` の該当ページ（エンドポイント一覧に `POST /v1/auth/guest`・`GET /v1/me`、認証のページにゲスト・猶予、運用のページに環境変数）。既存の構成に合わせて置く。
- Modify: `services/api/README.md` などがあれば同様に。

- [ ] **Step 1: 書く**
- [ ] **Step 2: `pnpm run api-docs:build` が通る**
- [ ] **Step 3: Commit** `docs(api): ゲスト・/v1/me・Web 用の設定を書く`

### Task 6: Web — 設定、Go API のクライアント、Cookie

**Files:**

- Modify: `src/infrastructure/config/environment.ts`
- Create: `src/infrastructure/go-api/client.ts`、`src/infrastructure/go-api/session-cookies.ts`
- Test: `tests/go-api-client.test.ts`、`tests/go-api-session-cookies.test.ts`

**Interfaces:**

- `environment.ts`：`export function goApiUrl(): string | undefined`（前後の空白を除き、空なら undefined、末尾の `/` を除く）、`export function isGoAuthEnabled(): boolean`（`goApiUrl()` がある）、`export function isGoAuthConfigured(): boolean`（`GO_API_URL`・`API_WEB_PROXY_SECRET`・`AUTH_GITHUB_ID` がそろう）。`isAuthConfigured()` は Go 版なら `isGoAuthConfigured()` を返す。
- `client.ts`：
  - `export type GoTokens = { accessToken: string; refreshToken: string; expiresIn: number }`
  - `export type GoMe = { ownerId: string; role: "admin" | "member" | "guest"; login: string; displayName?: string; accountId?: string }`
  - `export class GoApiError extends Error { constructor(readonly status: number, readonly code: string) }` — Go の JSON エラー（`{"error":{"code":...}}` など、`services/api/httpapi/respond.go` の形に合わせる）を読む。届かない・タイムアウトは `status: 0, code: "unavailable"`。
  - `export async function goApi<T>(path: string, init: { method: string; body?: unknown; accessToken?: string; clientIp?: string }): Promise<T>` — `fetch(goApiUrl()+path)`、`AbortSignal.timeout(10_000)`、`cache: "no-store"`、`content-type: application/json`、`Authorization: Bearer`、`X-Zhuelog-Client-IP`・`X-Zhuelog-Proxy-Secret`（`clientIp` があるときだけ。秘密は `API_WEB_PROXY_SECRET`）。2xx 以外は `GoApiError`。
  - 便利関数：`loginPassword(loginId, password, clientIp)`、`loginGuest(clientIp)`、`loginGitHub(code, codeVerifier, redirectUri, clientIp)`、`refreshTokens(refreshToken, clientIp)`、`logout(refreshToken)`、`fetchMe(accessToken)`。
- `session-cookies.ts`：`export const ACCESS_COOKIE = "zl_access"`、`REFRESH_COOKIE = "zl_refresh"`、`OAUTH_COOKIE = "zl_oauth"`、`export function sessionCookieOptions(tokens: GoTokens, secure: boolean): Array<{ name: string; value: string; options: {...} }>`、`export function clearedSessionCookies(): ...`（maxAge 0）。値は Global Constraints どおり。`secure` は呼ぶ側が要求の URL の protocol から決める。
- クライアントの IP は今の `src/infrastructure/auth/client-address.ts` の `clientAddress(headers)` を使う。

- [ ] **Step 1: テスト**（`fetch` を差し替えて）：ヘッダー（Bearer、IP と秘密は clientIp があるときだけ）、エラーの JSON → `GoApiError(status, code)`、ネットワークエラー → `status 0`、`goApiUrl` の正規化、Cookie の maxAge と属性。
- [ ] **Step 2〜4: 失敗 → 実装 → `pnpm run test:unit && pnpm run typecheck && pnpm run lint`**
- [ ] **Step 5: Commit** `feat(web): Go API のクライアントとセッションの Cookie を足す`

### Task 7: Web — 今の利用者の取得、パスワード・ゲストのログイン、ログアウト

**Files:**

- Create: `src/infrastructure/go-api/go-api-current-user-provider.ts`、`src/infrastructure/go-api/go-api-session.ts`
- Modify: `src/composition/identity-container.ts`
- Modify（必要なら）：`src/presentation/actions/auth-actions.ts`（Go 版の失敗を `passwordSignInFailureUrl` と同じ URL にする）、`src/presentation/http/password-sign-in-failure.ts`
- Test: `tests/go-api-current-user-provider.test.ts`、`tests/go-api-session.test.ts`

**Interfaces:**

- `GoApiCurrentUserProvider implements CurrentUserProvider`：`constructor(readAccessToken: () => Promise<string | undefined>, me: (token: string) => Promise<GoMe>)`。トークン無し → `null`。`GoMe` を `AuthenticatedUser` に直す（`githubLogin ← login`、`githubId ← ownerId`、`role`、member のときだけ `displayName`・`accountId`）。`GoApiError` 401 → `null`、403 → 同じ利用者の形で `role: "revoked"`（me が無いので `{ githubLogin: "", role: "revoked" }`）、それ以外は投げる。`identity-container.ts` は `getCurrentUser` を React の `cache()` で包んだものを使う。
- `go-api-session.ts`（Server Action から呼ぶ。`cookies()`・`headers()` を使う）：
  - `signInWithPasswordViaGo({ loginId, password, redirectTo })`：成功で Cookie を付けて `redirect(redirectTo)`。`GoApiError` の 400・401・429 は `redirect(passwordSignInFailureUrl 相当: /signin?error=CredentialsSignin&callbackUrl=...)`、それ以外は投げる。
  - `signInAsGuestViaGo(redirectTo)`、`signOutViaGo(redirectTo)`（`zl_refresh` があれば `logout` を呼び、失敗しても Cookie を消して redirect）。
- `identity-container.ts` の `signInWithGitHub`・`signInAsGuest`・`signInWithPassword`・`signOutCurrentUser`・`signOutTo` は `isGoAuthEnabled()` で振り分ける（GitHub は Task 8）。

- [ ] **Step 1: テスト**：provider の 200（admin・member・guest の変換）・401・403・500・トークン無し。パスワードの失敗 URL（401 と 429 が同じ URL、入力を URL に含めない）。
- [ ] **Step 2〜4: 失敗 → 実装 → unit・typecheck・lint**
- [ ] **Step 5: Commit** `feat(web): GO_API_URL があるときは Go API でログインする`

### Task 8: Web — GitHub ログイン（PKCE と callback）

**Files:**

- Create: `src/infrastructure/go-api/github-oauth.ts`、`src/app/api/auth/callback/github/go/route.ts`
- Modify: `src/composition/identity-container.ts`（`signInWithGitHub` の Go 版）
- Test: `tests/go-api-github-oauth.test.ts`

**Interfaces:**

- `github-oauth.ts`：
  - `export function githubRedirectUri(origin: string): string` → `${origin}/api/auth/callback/github/go`
  - `export function createOAuthStart(callbackPath: string): { state: string; verifier: string; challenge: string; cookieValue: string }` — state・verifier は 32 バイトの乱数の base64url、challenge は S256。`cookieValue` は `{state, verifier, callbackPath}` の JSON の base64url。
  - `export function parseOAuthCookie(value: string | undefined): { state: string; verifier: string; callbackPath: string } | null`
  - `export function githubAuthorizeUrl({ clientId, redirectUri, state, challenge }): string` — `https://github.com/login/oauth/authorize`、`scope` は `read:user`、`code_challenge_method=S256`。
- Go 版の `signInWithGitHub(redirectTo)`：`zl_oauth` を付けて `redirect(githubAuthorizeUrl(...))`。origin は要求のヘッダー（`AUTH_URL` があればそれ）から。
- callback の `GET`：Go 版でなければ `404`。`?error=` がある・Cookie が無い・state が違う（`timingSafeEqual`）→ `/signin?error=OAuthCallbackError`。`loginGitHub` の 403 → `AccessDenied`、その他の失敗 → `OAuthCallbackError`。成功 → セッションの Cookie を付け、`zl_oauth` を消し、`getSafeCallbackPath(callbackPath)` へ 303。どの場合も `zl_oauth` を消す。

- [ ] **Step 1: テスト**：URL の組み立て、cookie の往復と壊れた値 → null、callback ハンドラ（`goApi` を差し替えて）：state 不一致・error パラメーター・403・成功（Cookie と Location）・Go 版でないと 404。
- [ ] **Step 2〜4: 失敗 → 実装 → unit・typecheck・lint**
- [ ] **Step 5: Commit** `feat(web): GitHub ログインを Go API で行う`

### Task 9: Web — `proxy.ts` のリフレッシュと入口の判定

**Files:**

- Create: `src/infrastructure/go-api/go-proxy.ts`
- Modify: `src/proxy.ts`
- Test: `tests/go-proxy.test.ts`

**Interfaces:**

- `export async function goProxy(request: NextRequest, finish: (request: NextRequest, extra: { cookieHeader?: string; setCookies: ...; clear: boolean }) => NextResponse): Promise<Response>` のように、今の CSP を付ける処理（`proxy.ts` の本体）を共有できる形にする。手順：
  1. `zl_access` が無く `zl_refresh` がある → `refreshTokens(refresh, clientAddress(headers))`。成功 → 応答に新しい Cookie、要求の `cookie` ヘッダーの `zl_access`・`zl_refresh` を書き換える。`GoApiError` 401 → 両方を消す（ログインしていない扱い）。それ以外の失敗 → 何もしない。
  2. 入口：`/signin`・`/api/auth/*` は通す。ログイン済み（`zl_access` がある、またはリフレッシュで得た）なら通す。それ以外は今の `authorized` と同じ（`/api/*` は `401` JSON、`POST` かつ `next-action` ヘッダーは通す、ほかは `/signin?callbackUrl=` へ redirect）。
- `src/proxy.ts`：`isGoAuthEnabled()` なら `goProxy`、そうでなければ今の `auth(...)`。CSP・`x-nonce`・`Cache-Control` は両方で同じ。

- [ ] **Step 1: テスト**（`NextRequest` を作り、`refreshTokens` を差し替え）：リフレッシュ成功（応答の Set-Cookie と、ページに渡る要求の cookie）、401 で両方消す、届かないとき何もしない、`zl_access` があるならリフレッシュしない、未ログインの redirect と `/api` の 401 と Server Action の通過。
- [ ] **Step 2〜4: 失敗 → 実装 → unit・typecheck・lint・`pnpm run build`**
- [ ] **Step 5: Commit** `feat(web): proxy で Go API のトークンをリフレッシュする`

### Task 10: e2e を Go 版でも動かす、Web のドキュメント

**Files:**

- Modify: `e2e/server.ts`（`ZHUELOG_E2E_AUTH=go` のとき、`go build -o <tmp>/zhuelog-api ./services/api` → 同じ DB の `DATABASE_URL`（`?schema=` を除く）、`API_JWT_SECRET`（e2e 用の乱数、`e2e/environment.ts` に置く）、`AUTH_ALLOWED_GITHUB_IDS=10001`、GitHub mobile はダミーの値、`API_WEB_PROXY_SECRET`、`PORT=3108` で起動し `/ping` を待つ。Next には `GO_API_URL=http://127.0.0.1:3108`・`API_WEB_PROXY_SECRET`・`AUTH_GITHUB_ID=e2e-client` を渡す）
- Modify: `e2e/environment.ts`、`e2e/fixtures.ts`（Go 版の `asAdmin`：`jose` などで HS256 の JWT（`iss: ffpf-zhuelog-api`、`aud: ffpf-zhuelog-mobile`、`sub: "10001"`、`role: "admin"`、`login: "e2e-admin"`、`iat`、`exp`）を作り `zl_access` に入れる。依存が無ければ `node:crypto` で HMAC を組む）
- Modify: `.github/workflows/ci.yml`（e2e のジョブを `matrix.auth: [authjs, go]` にし、go のときは `actions/setup-go`（`services/api/go.mod` の版）を入れ、`ZHUELOG_E2E_AUTH=go` を渡す。成果物の名前に matrix を入れる）
- Modify: `.env.example`、`docs/`（Web 側の切り替え手順。仕様書の「切り替えの手順」を `docs/api-deployment.md` か新しい `docs/web-auth-via-go.md` に）
- Test: e2e 全体（両方の版）

- [ ] **Step 1: e2e の Go 版を作る**
- [ ] **Step 2: ローカルで `pnpm run test:e2e`（今の版）と `ZHUELOG_E2E_AUTH=go pnpm run test:e2e` が通る**。Go 版で落ちるテストは、Go 版の不具合として直す（テストを Go 版だけ飛ばさない）。ゲストの e2e があればそれも通ること。
- [ ] **Step 3: Commit** `test(e2e): Go API でのログインでも e2e を動かす`
