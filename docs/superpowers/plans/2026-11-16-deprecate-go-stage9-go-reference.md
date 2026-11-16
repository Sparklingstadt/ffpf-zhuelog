# 段階 9 の参照：Go のフォロー・タイムライン・会員の一覧・会員管理・パスワード変更の今の動き（2026-11-17 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for both plans of stage 9: docs/superpowers/plans/2026-11-16-deprecate-go-stage9a-social.md (follows, timeline, member directory) and docs/superpowers/plans/2026-11-16-deprecate-go-stage9b-accounts.md (admin accounts, own password). Stages 1–8 are merged into this branch: the web already decides who is signed in itself (`TokenCurrentUserProvider`, checks `sv` against `sessionVersion` on every request), reads and writes learning notes including `sharedAt` (`src/infrastructure/prisma/learning-note-writes.ts:93`), and keeps the shared-note rules (`handleShare`). Go keeps sign-in (stage 11), LINE and the demo reset cron (stage 10).

## 0. Routes, roles, act-as, demo

| Route                                   | Registered (router.go)           | Wrapper, outermost first                                               | Handler                                          |
| --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /v1/members`                       | `memberRoutes` :258-264, always  | `notForDemo` = `requireAuth` → `rejectUserParam` → `notDemo`           | `listMembers` follow_handlers.go:21-43           |
| `PUT /v1/follows/{ownerId}`             | same                             | same                                                                   | `followMember` follow_handlers.go:48-74          |
| `DELETE /v1/follows/{ownerId}`          | same                             | same                                                                   | `unfollowMember` follow_handlers.go:76-88        |
| `GET /v1/timeline`                      | same                             | same                                                                   | `listTimeline` follow_handlers.go:96-121         |
| `POST /v1/account/password`             | `accountRoutes` :266-271, always | `limited` (rate limit) → `requireAuth` → `rejectUserParam` → `notDemo` | `changePassword` account_handlers.go:15-39       |
| `GET /v1/admin/accounts`                | `adminRoutes` :275-279, always   | `adminOnly` = `requireAuth` → `rejectUserParam` → `requireAdmin`       | `listAccounts` admin_handlers.go:78-94           |
| `POST /v1/admin/accounts`               | same                             | same                                                                   | `createAccount` admin_handlers.go:96-134         |
| `POST /v1/admin/accounts/{id}/password` | same                             | same                                                                   | `resetAccountPassword` admin_handlers.go:136-176 |

- `requireAuth` (middleware.go:143-166): no/malformed `Authorization: Bearer` or a failed `Authenticate` → **401** `unauthorized` 「認証が必要です。」 (or **403** `forbidden` 「このアカウントは利用できません。」 for a de-listed admin, `writeServiceError`); **guest → 403** `forbidden` 「このアカウントは利用できません。」 (no route here allows guests).
- `rejectUserParam` (owner.go:11-22): any `?user=` → **400** `invalid_request` 「リクエストが不正です。」.
- **Act-as** (`X-Zhuelog-Act-As`, middleware.go:168-194; `ActAs` auth/me.go:29-40): only an admin not already acting, value `^password:[a-z0-9]{1,64}$` and an existing `PasswordAccount`. The principal keeps **`Role: admin`**, `OwnerID` = the member, `ActorID` = the admin. None of the stage-9 routes uses `notActing`, so:
  - members/follows/timeline run **as the member** (`principalFrom(ctx).OwnerID`): an acting admin follows as the member (`TestActAsWritesGoToTheMember` act_as_test.go:34-58 pins exactly that with `PUT /v1/follows/password:x`);
  - the admin routes stay open (role is still admin);
  - `POST /v1/account/password` answers **403** 「この操作は会員だけが利用できます。」 (`ChangePassword` refuses role ≠ member, password_change.go:44).
- **Demo** (`notDemo` httpapi/demo.go:56-72 → `IsDemo` auth/demo.go:48-75): the demo is a member whose `passwordHash` is `store.DemoPasswordHash` (`"demo:no-password"`, store/demo.go:17) or whose `loginId` is `DEMO_LOGIN_ID`; an admin acting as the demo is **not** the demo. The five member routes (four social + password) answer **403** `forbidden` 「デモでは使えません。」; an `IsDemo` store error → 500. The admin routes are closed to the demo by `requireAdmin` instead (403 「管理者だけが利用できます。」). Closed-route list pinned in `TestDemoIsRefusedExactlyTheClosedRoutes` demo_test.go:52-93.
- `requireAdmin` (admin_handlers.go:52-61): role ≠ admin → **403** `forbidden` 「管理者だけが利用できます。」 (`msgAdminOnly` respond.go:20).
- Every answer: `{"error":{"code","message"}}`, `Cache-Control: no-store` (respond.go:78-95). A store/hash error → `writeServiceError` (respond.go:110-141) → **500** `internal` 「サーバーでエラーが発生しました。」 (the error text is logged, never the body).
- Bodies (`decodeBody` respond.go:177-195): exactly one JSON object, unknown fields refused, trailing data refused, `null` for a `jsonString` field refused (auth_handlers.go:33-46) → **400** 「リクエストが不正です。」; over 1 MiB → **413**. A missing field is `""`.

## 1. `GET /v1/members` (member directory)

- Viewer = `principalFrom(ctx).OwnerID` (the member; the admin's GitHub id when not acting — matches no account, so every member is listed).
- Store `ListMembers` (store/follows.go:42-77), statement 1:

  ```sql
  SELECT a."ownerId", a."displayName",
         EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = $1 AND f."followeeId" = a."ownerId"),
         EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = a."ownerId" AND f."followeeId" = $1)
  FROM (SELECT $2 || p."id" AS "ownerId", p."displayName", p."createdAt" FROM "PasswordAccount" p
        UNION ALL
        SELECT $3 || f."id", f."displayName", f."createdAt" FROM "FfpfAccount" f) a
  WHERE a."ownerId" <> $1
  ORDER BY a."displayName" COLLATE "ja-x-icu", a."createdAt", a."ownerId"
  ```

  `$2 = "password:"`, `$3 = "ffpf:"` (`memberAccounts` follows.go:32-40). Statement 2 (not in a transaction with 1): `SELECT count(*) FROM "Follow" WHERE "followeeId" = $1`.

- `followingCount` = listed members the viewer follows (a follow of a deleted account is **not** counted); `followerCount` = **every** follow row pointing at the viewer, admins' GitHub ids included (`TestListMembers` store/follows_test.go:33-80: admin follower counts, deleted followee does not → 2 and 3).
- Response 200 `{"members":[{"ownerId","displayName","following","followsMe"}],"followingCount","followerCount"}` — **no loginId** (it is half of the credentials). `[]` when none.
- Order pinned by `TestListMembersOrderMatchesWeb` follows_test.go:265-343: 「カズ」「サーシャ」「アキラ」「コーヘイ」「イチロー」「ケーキ」「コウヘイ」 + two 「ダブル」 (earlier/later createdAt) → `アキラ, イチロー, カズ, ケーキ, コウヘイ, コーヘイ, サーシャ, ダブル(earlier), ダブル(later)`.
- `ja-x-icu` must exist in the database: docs/api-deployment.md:94 and docs-site/operations/deploy.md:87 tell how to check it (without it the directory is a 500).

## 2. Follow and unfollow

`PUT /v1/follows/{ownerId}` (follow_handlers.go:48-74), in this order:

1. `{ownerId}` must match `^(password|ffpf):[a-z0-9]{1,64}$` (`memberOwnerIDPattern` :11-12) else **404** `not_found` 「見つかりません。」 (`pathValue` respond.go:158-172).
2. Equal to the caller's own `OwnerID` → **400** `self_follow` 「自分はフォローできません。」 (`msgSelfFollow` respond.go:23). An admin can never hit it (their id does not match the pattern).
3. `MemberExists` (follows.go:79-96: the prefix picks `PasswordAccount` or `FfpfAccount`, `SELECT EXISTS (… WHERE "id" = $1)`) false → **404** 「見つかりません。」.
4. `Follow` (follows.go:98-106): `INSERT INTO "Follow" ("followerId","followeeId","createdAt") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING` — following twice is a no-op 204. `createdAt` = `dbTime(now)`.
5. **204**.

- Steps 3 and 4 are two statements, not atomic: a member deleted in between still gets the row (no foreign key, `prisma/schema.prisma:93-102`).
- The follower may be an admin's GitHub id (the `Follow` table has no FK; admin follows only count as followers).

`DELETE /v1/follows/{ownerId}` (:76-88): same pattern check (404); then `DELETE FROM "Follow" WHERE "followerId" = $1 AND "followeeId" = $2` (follows.go:108-115); **204** whether or not a row existed, self included.

## 3. `GET /v1/timeline`

- Query (`readListQuery` entry_handlers.go:76-109): `limit` 1..100 (default 50; digits only, one value), `cursor` base64url(`"<unix ms>|<id>"`) (`decodeCursor` validate.go:29-48); anything else → **400** 「リクエストが不正です。」.
- Store `ListTimeline` (follows.go:117-157), asked for `limit + 1`:

  ```sql
  SELECT e."id", e."kind", e."originalText", e."correctedText", e."pinyin", e."createdAt", e."sharedAt",
         e."ownerId", a."displayName"
  FROM "LearningEntry" e
  JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = $1
  JOIN (<memberAccounts>) a ON a."ownerId" = e."ownerId"
  WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL
    AND ($2::timestamp IS NULL OR (e."createdAt", e."id") < ($2::timestamp, $3::text))
  ORDER BY e."createdAt" DESC, e."id" DESC
  LIMIT $4
  ```

  then the hints of all rows in one query, each entry's by `position` (`attachHints` entries.go:119-148).

- So: only followed owners that still have a member account (`TestTimelineSkipsDeletedMembers` :234-263), shared and not in the trash, newest first, ties by id descending.
- `paginate` (entry_handlers.go:111-120): more than `limit` rows → `nextCursor` from the last kept row. Response `{"items":[{"entry":{id,kind,originalText,correctedText,pinyin,hints:[{id,content,position}],createdAt,sharedAt},"ownerId","ownerName"}],"nextCursor"}`.
- **The web only ever asks `?limit=100` with no cursor** (social-gateway.ts:25-26,53-62): one page of the 100 newest; Go's cursor is unused by any caller after stage 2.

## 4. Admin accounts

`GET /v1/admin/accounts` (admin_handlers.go:78-94; store `ListPasswordAccounts` accounts.go:113-136): `SELECT "id","loginId","displayName","createdAt" FROM "PasswordAccount" ORDER BY "createdAt" ASC, "id" ASC` — **password accounts only** (no FFPF ID members), the demo account included. 200 `{"accounts":[{"id","ownerId":"password:"+id,"loginId","displayName","createdAt":"…Z"}]}`.

`POST /v1/admin/accounts` (:96-134), body `{loginId, displayName, password}` (all optional strings):

1. `validateAccountInput` (:33-50), first failure wins, each **400** `invalid_request`:
   - `NormalizeLoginID` (auth/validate.go:20-26): JS `trim()` (jsstr.go:8-20: ECMAScript WhiteSpace + LineTerminator incl. U+FEFF, U+3000; **not** U+0085), JS `toLowerCase()` (U+212A Kelvin → `k`; U+0130 → `i̇` which then fails), then `^[a-z0-9._-]{3,32}$` → 「ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。」.
   - `ValidDisplayName` (:35-42): trimmed, 1..50 **UTF-16 units** (`jsstr.Len`; emoji = 2), no NUL → 「表示名は1〜50文字にしてください。」. The trimmed name is stored.
   - `resolvePassword` (:21-31): `trim(password) == ""` → **generate** (`GeneratePassword` password.go:197-201: 15 random bytes, unpadded base64url = 20 chars); else 12..128 UTF-16 units, **not trimmed** (`ValidNewPassword` validate.go:28-33) → 「パスワードは12〜128文字にしてください。」.
2. `Hash` (password.go:170-185) — see §6.
3. `CreatePasswordAccount` (accounts.go:138-154): `id = newID()` (store.go:135-148: `"c"` + 24 of `a-z0-9`, crypto random), `INSERT … ("id","loginId","displayName","passwordHash","sessionVersion","createdAt","updatedAt") VALUES (…, 0, now, now)`; unique violation on `PasswordAccount_loginId_key` → **409** `login_id_taken` 「このログインIDはすでに使われています。」.
4. **201** `{"account":{…as list},"password":"<plain>","generated":bool}`. The plain password appears only in this answer and is never logged (`TestAdminAccountsLogsOmitPasswords` :356-395).

- Tests: `TestAdminCreateAccount` :150-196 (missing/empty/whitespace password → generated 20 chars; `"  keep spaces 1 "` kept; 12×「あ」; 6×😀 = 12 units; `"  Alice.W "` → `alice.w`, `"  Alice  "` → `Alice`), `TestAdminCreateAccountValidation` :198-256 (2-char / 33-char / space / non-ASCII / missing loginId; blank / missing / 51×あ / 26×😀 name; 11 chars / 11×あ / 129 / 65×😀 password; U+0130; order loginId → name → password; boundaries `a.-`, 32×z + 50×あ + 128×a, 25×😀 name + 64×😀 password pass), `TestAdminCreateAccountKelvinSign` :258-273, `TestAdminCreateAccountDuplicate` :275-284 (`ALICE` vs taken `alice` → 409).

`POST /v1/admin/accounts/{id}/password` (:136-176), body `{password}`:

1. body decode (400) → `resolvePassword` (400 「パスワードは12〜128文字にしてください。」) — **checked before the id**;
2. `{id}` `validID` (validate.go:18-22: non-empty, ≤128 bytes, valid UTF-8, no NUL) else **404** `not_found` 「アカウントが見つかりません。」;
3. `FindPasswordAccountByID` → missing → **404** 「アカウントが見つかりません。」;
4. `Hash`; 5. `SetPassword` (accounts.go:72-89):

   ```sql
   UPDATE "PasswordAccount" SET "passwordHash" = $2, "sessionVersion" = "sessionVersion" + 1,
     "updatedAt" = CAST($3 AS TIMESTAMP(3)) WHERE "id" = $1
   ```

   0 rows → 404;

5. **200** `{"loginId","password","generated"}`.

- Nothing refuses resetting the **demo** account's password (it then has a real hash; it stays the demo only while `DEMO_LOGIN_ID` names it, auth/demo.go:73-75) or the password of the member the admin is acting as.
- Throttle keys are not reset by an admin reset.
- Tests: `TestAdminResetPassword` :286-328, `TestAdminResetPasswordErrors` :330-354, `TestAdminRoutesRequireAdmin` :90-111, `TestAdminHashFailureIs500` :397-405.

## 5. `POST /v1/account/password` (own password)

Body `{currentPassword, newPassword, confirmPassword}`. Order (router.go:266-271, account_handlers.go:15-39, `ChangePassword` auth/password_change.go:43-100):

1. **Per-client rate limit** `route:auth:<client>`: 10 per 1 minute, shared with every `/v1/auth/*` route except refresh (router.go:99-101,168,174,269-270), counted in `SignInThrottle` when `Deps.Throttle` is set (production: main.go:169) — **before authentication**, so failed tokens count. Over → **429** `rate_limited` 「しばらくしてから再度お試しください。」; throttle table error → **503** `unavailable` 「サービスを利用できません。」 (middleware.go:315-331). `<client>` = `X-Zhuelog-Client-IP` when `X-Zhuelog-Proxy-Secret` matches, else the peer (middleware.go:260-281). The web sends `clientIp: clientAddress(await headers())` (normalised: IPv4 as is, IPv6 as its `/64`, src/infrastructure/auth/client-address.ts) — `TestChangePasswordSharesAuthRateLimit` account_handlers_test.go:128-172.
2. `requireAuth` (401/403 guest) → act-as → `?user=` 400 → `notDemo` 403 「デモでは使えません。」 → body 400.
3. `p.Role != member` or owner `ffpf:` → `ErrForbidden` → **403** 「この操作は会員だけが利用できます。」 (`msgMembersOnly` respond.go:22). No attempt counted, no hash.
4. `ValidNewPassword(next)` (12..128 UTF-16 units, not trimmed) else **400** `invalid_request` 「パスワードは12〜128文字にしてください。」.
5. `next != confirm` → **400** `password_mismatch` 「確認用のパスワードが一致しません。」.
   (Steps 3–5 count nothing and hash nothing — `TestChangePasswordOrder` password_change_test.go:30-64.)
6. Account id from `OwnerID` (`password:<id>`, non-empty) — missing/malformed or `FindPasswordAccountByID` not found → `reject` = **one `Simulate`** (a full scrypt on a dummy hash, service.go:135-142) → **400** `invalid_current_password` 「現在のパスワードが違うか、一時的にロックされています。」.
7. `ConsumeThrottle("password-change:<accountId>", 5, 15 min)` (service.go:24-28: `maxFailuresPerLogin = 5`, `throttleWindow = 15*time.Minute`); over the limit, `current == ""` or more than **128 runes** (`maxPasswordRunes`, code points) → `reject` (one `Simulate` on `current` truncated to 128 runes) → same 400. A throttle store error → 500.
8. `Verify(current, account.PasswordHash)` false → same 400 (the verify was the one hash).
9. `Hash(next)`, `SetPassword` (bumps `sessionVersion`; 0 rows → same 400), `ResetThrottle("password-change:<accountId>")` → **204**.

- Every current-password failure costs exactly one hash and gives the same answer (`TestChangePasswordUniformFailures` :107-158); the key is reachable only by the signed-in member and never blocks sign-in (sign-in keys are `client:<ip>` and `login:<ip>:<loginId>`).
- Success order pinned in `TestChangePasswordSuccess` :160-182: `Find → ConsumeThrottle → Verify → Hash → SetPassword → ResetThrottle`, new `sessionVersion` = old + 1.
- After a 204 the web calls `signOutViaGo("/signin?notice=password-changed")` (password-account-actions.ts:122-124).

## 6. Password hashes (scrypt)

- Format written: `scrypt:32768:8:1:<salt>:<key>` — salt 16 random bytes, key 64 bytes, both **unpadded base64url** (`formatScryptHash` password.go:187-195; constants :17-30). Password bytes = the UTF-8 of the Go string (JSON-decoded; a lone surrogate became U+FFFD at decode).
- `parseScryptHash` (:98-126) accepts exactly: 6 `:`-parts, `scrypt` first; N, r, p 1–9 ASCII digits (leading zeros allowed); N a power of two ≥ 2 and ≤ 32768; 1 ≤ r ≤ 8; 1 ≤ p ≤ 4; salt canonical unpadded base64url, non-empty; key canonical, exactly 64 bytes. Anything else → `Verify` false, no hash computed. Weaker stored parameters (e.g. N=16384, p=2) still verify.
- `Verify` (:128-145): constant-time compare. `Simulate` (:147-153) verifies against a dummy hash built once (`Warm` :155-168). `Hash` (:170-185) uses a fresh salt.
- Concurrency: at most 4 scrypt computations at once per process (`maxConcurrentHashes` :26-29; each 32 MiB); `Hash` shares the bound.
- Node already writes the same format: `scripts/lib/scrypt-password-hasher.ts` (used by `e2e/fixtures.ts:126-141` `createMember` and `scripts/api-local-seed.ts`), `maxmem` 64 MiB; same `parse` rules (:32-49); `tests/scrypt-password-hasher.test.ts` (4 tests). `TestVerifyNodeHash` auth/password_test.go:24-34 verifies one hash Node wrote. **No test pins that Node and Go write byte-identical hashes for the same salt.**
- Go's **sign-in keeps verifying** these hashes until stage 11 (`LoginPassword` auth/login.go).

## 7. Sessions after a password change or reset

- Only `sessionVersion` changes. Nothing writes `ApiRefreshToken`: Go's `Authenticate` (session.go:121-134) and `Refresh` (:28-93) both run `checkCurrent` (:136-172), which compares the member's token/row `sv` with `PasswordAccount.sessionVersion` (`SessionVersion` accounts.go:91-103); a mismatch on refresh **revokes the whole family** (`revokeFamily`) and answers 401. `TestChangePasswordRevokesSessions` password_change_test.go:184-208 pins: old access token → 401, old refresh → 401, old password fails, new works.
- The web's `TokenCurrentUserProvider.memberUser` (src/infrastructure/identity/token-current-user-provider.ts:99-130) returns `null` when `account.sessionVersion !== claims.sessionVersion`, on every request.
- So a web-side `UPDATE … "sessionVersion" = "sessionVersion" + 1` revokes every session exactly as Go's `SetPassword` did, as long as it is the same statement as the hash change.
- FFPF ID accounts have their own `sessionVersion` (`FfpfSessionVersion`); nothing in stage 9 touches it.

## 8. `SignInThrottle` (store/throttle.go)

- `ConsumeThrottle` (:12-43): first `DELETE FROM "SignInThrottle" WHERE "key" IN (SELECT "key" … WHERE "expiresAt" <= now LIMIT 100 FOR UPDATE SKIP LOCKED)`, then one upsert:

  ```sql
  INSERT INTO "SignInThrottle" ("key","count","expiresAt") VALUES ($1, 1, CAST($3 AS TIMESTAMP(3)))
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST($2 AS TIMESTAMP(3)) THEN 1 ELSE "SignInThrottle"."count" + 1 END,
    "expiresAt" = CASE WHEN "SignInThrottle"."expiresAt" <= CAST($2 AS TIMESTAMP(3)) THEN CAST($3 AS TIMESTAMP(3)) ELSE "SignInThrottle"."expiresAt" END
  RETURNING "count"
  ```

  allowed when `count <= limit`; `$2 = now`, `$3 = now + window` (ms precision).

- `ResetThrottle` (:45-51): `DELETE FROM "SignInThrottle" WHERE "key" = $1`.
- Go's sign-in, refresh limit, LINE link codes and the route limits use the same table with other keys; all stay in Go after stage 9.

## 9. The web today

- `/follow` (`src/app/follow/page.tsx`): `requireNonGuestOwner(undefined, "/signin?callbackUrl=/follow")` (signed out → sign-in; guest → `/`); `owner.kind === "self"` → `Promise.all([socialNetwork.listMembers(), socialNetwork.listTimeline()])` **without `loadOr`** (a Go error fails the page); `reauth` → `ReauthNotice`. Header 「フォロー中 N人・フォロワー N人」, timeline then 「メンバー」. **The demo opening `/follow` gets Go's 403 thrown → the error page** (the menu hides the link, site-navigation.ts:161-165,183-189).
- `socialNetwork` = `createSocialGateway()` (`src/composition/social-container.ts`; `src/infrastructure/go-api/social-gateway.ts`: `GET /v1/members`, `GET /v1/timeline?limit=100`, `PUT`/`DELETE /v1/follows/{encodeURIComponent(ownerId)}`; 404 → `"not-found"`, 400 `self_follow` → `"self"`). `FollowResult` is declared there and imported by `src/presentation/controllers/follow-controller.ts:2`. Types `FollowDirectory`, `FollowTimelineItem`, `SharedLearningEntry` in `src/domain/social/follow.ts`.
- `src/presentation/actions/follow-actions.ts`: `followMemberAction`/`unfollowMemberAction` → `handleFollow`/`handleUnfollow` (follow-controller.ts:28-66): `getCurrentMemberUser` (admin or member) without `githubId` → 「ログインし直してください。」; followee by zod `^(password|ffpf):[a-z0-9]{1,64}$` else 「見つかりませんでした。画面を更新してください。」; `attemptGoAction("FOLLOW_FAILED", …)`; `"self"` → 「自分はフォローできません。」; `"not-found"` → the not-found text; Go 403 (demo) → 「ログインし直してください。」 (`isForbidden` action-state.ts:128-137). `revalidatePath("/follow")` on success.
- `/admin/accounts` (`src/app/admin/accounts/page.tsx`): `getCurrentAdminUser()` (role admin, acting included) else `redirect("/")`; `memberAccounts.listAccounts()` **without `loadOr`**; create form, per-row 「この会員として操作」 and `ResetPasswordForm`.
- `memberAccounts` = `createAccountGateway()` (`src/composition/identity-container.ts:32-34`; `src/infrastructure/go-api/account-gateway.ts`): `listAccounts`, `createAccount`, `resetPassword` (404 → `null`), `changeOwnPassword(input, clientIp)` — **and the four LINE link methods (stage 10) in the same gateway** (:101-155), used by `src/app/account/line/page.tsx:30` and `src/presentation/actions/line-link-actions.ts:29,41,60`. Domain-looking types `MemberAccount`, `IssuedPassword` live in the gateway file.
- `src/composition/record-owner-options.ts:13-20` `listRecordOwnerOptions` also calls `memberAccounts.listAccounts()` (the admin's owner switcher on `/`, `/logs`, the day and the note pages, through `loadOr("RECORD_OWNER_OPTIONS_UNAVAILABLE", …, [])`).
- `src/presentation/actions/password-account-actions.ts`:
  - `createPasswordAccountAction` / `resetPasswordAccountPasswordAction(accountId, …)` (bound id): not admin → 「この操作を行う権限がありません。再度ログインしてください。」 (`accountForbiddenMessage`); `attemptGo` maps Go 400/409 user-facing codes to Go's message, 404 on reset → 「アカウントが見つかりません。」, Go 403 → `accountForbiddenMessage`, anything else → 「処理できませんでした。時間をおいてもう一度お試しください。」 (logging only `PASSWORD_ACCOUNT_CREATE_FAILED`/`…_RESET_FAILED` with status and code); success → `revalidatePath("/admin/accounts")` (failure logged as `PASSWORD_ACCOUNT_REVALIDATE_FAILED` and ignored) and `{status:"success", loginId, password, generated}`.
  - `changeOwnPasswordAction`: `getCurrentMemberUser()` role ≠ member → forbidden text; `clientAddress(await headers())`; `attemptAccountCall("PASSWORD_CHANGE_FAILED", …)` (Go's 400 messages shown as is; 429 and 5xx → the generic text; the demo's Go 403 → `accountForbiddenMessage`); success → `signOutViaGo("/signin?notice=password-changed")`.
- `/account/password` (`src/app/account/password/page.tsx`): `getCurrentMemberUser()` role ≠ member → `/`; FFPF ID member → the portal card (`<FFPF_ID_ISSUER>/id`); a password member without `accountId` → `/`; else `ChangePasswordForm`. **The demo sees the form** (it has an `accountId`) and gets the forbidden text on submit.
- Presenters: `src/presentation/presenters/account-action-errors.ts` (`accountNotFoundMessage`, `accountForbiddenMessage`); `userFacingCodes` action-state.ts:30-39 holds `invalid_request`, `password_mismatch`, `invalid_current_password`, `login_id_taken`.
- The form messages the user sees come from Go: 「ログインIDは英小文字・数字・. _ - の3〜32文字にしてください。」「表示名は1〜50文字にしてください。」「パスワードは12〜128文字にしてください。」「このログインIDはすでに使われています。」「確認用のパスワードが一致しません。」「現在のパスワードが違うか、一時的にロックされています。」. Go's comments cite `src/domain/identity/entities/password-account.ts` for the rules; **that file no longer exists** — the rules live only in Go today.
- Unit tests that die with the gateways: `tests/go-api-social-gateway.test.ts` (5), the 7 account tests of `tests/go-api-account-gateway.test.ts` (:31-163; the 8 LINE tests :165-245 stay with the LINE gateway). `tests/follow-controller.test.ts` (13 tests) stays (its Go-flavoured names/assertions on `GoApiError` need the forbidden error of the web instead where the action no longer calls Go).

## 10. E2E and Go tests that cover them; gaps

- E2E: `e2e/follow.spec.ts` (5: share/follow/counts/「フォローされています」/unfollow empties; unshare and trash leave the timeline; guest sent home; admin follows but has no share button; forged share id), `e2e/ffpf-login.spec.ts:39` (FFPF member's `/account/password` shows the portal link), `:98` (FFPF and password members find and follow each other), `e2e/accounts.spec.ts` (6: admin creates a member who signs in with the generated password — **Go's sign-in verifies the hash Go wrote**; member sent home from `/admin/accounts`; wrong password; throttle; **reset revokes existing member sessions** (member page → `/signin`, old password fails, new works); **member changes own password** → `/signin?notice=password-changed`, old fails, new works), `e2e/act-as.spec.ts` (every test starts from `/admin/accounts`' 「この会員として操作」), `e2e/demo.spec.ts:67-83` (menu leaves out フォロー and パスワード変更).
- Go: `httpapi/follow_handlers_test.go` (6), `store/follows_test.go` (11), `httpapi/admin_handlers_test.go` (10), `httpapi/account_handlers_test.go` (5), `auth/password_change_test.go` (8), `auth/password_test.go` (11), `auth/validate_test.go` (3), `httpapi/demo_test.go` (closed routes, `TestDemoIsRefusedTheMemberDirectory` :96-116, `TestDemoCheckErrorIsNotAPass` :118-123 uses `/v1/members`), `httpapi/act_as_test.go:34-58` (follow as the member), `main_test.go:392-445` (follow round trip in `TestRun…` end to end), `store/demo_test.go:164-169` (`s.Follow` to build rows the reset deletes), `store/demo_test.go:230` (`CreatePasswordAccount` in `TestResetDemoKeepsAnExistingAccount`).
- **Gaps:** member order by `ja-x-icu`; the 100-note limit and newest-first order with ties; hints on the timeline in position order; a deleted followee's notes left out; an acting admin following as the member; the demo on `/follow` (error page today); the follower count including admins; every admin form error (invalid loginId, name, password, taken loginId, missing account); change-password errors (wrong current, mismatch, short new, the 5-try lock); the demo and an acting admin on `/account/password`; that **Go's refresh refuses a refresh token after a web-side bump**; a hash written by Node verifying in Go for unusual passwords (spaces, Japanese, emoji, 128 chars).

## 11. Docs that mention these routes

- `docs-site/reference/follows.md` (whole page; nav `docs-site/.vuepress/config.ts:31`), `docs-site/reference/admin.md` (whole page; nav `:33`), `docs-site/reference/auth.md:3` (rate-limit sentence naming `POST /v1/account/password`) and `:187-…` (its section), `docs-site/reference/README.md:18-22,30-32` (rows) and `:91` (timeline paging), `docs-site/errors.md:38,47` (rows), `docs-site/guide/auth.md:52,164-165,178,203`, `docs-site/README.md:15` (「ログインとフォローなど」), `:24` and `:27` (Go's list), `:41` (store comment 「フォロー・アカウント」), `:51` (example path `PUT /v1/follows/{ownerId}`), `:63` (「ログインやフォローなど」), `docs-site/operations/local.md:59,64`, `docs-site/operations/deploy.md:87` (`ja-x-icu` check, now for the web).
- `docs/api-local.md:57,62`, `docs/api-deployment.md:94` (`ja-x-icu`), `:451` (FFPF member and `POST /v1/account/password`), `:470` (what the demo cannot use and where it is refused), `:493` (rate limit shared by `POST /v1/account/password`), a new section after 「段階8（学習ログ・AI の利用量）のマージの前と後」 (:332-355).
- `README.md:33` (Go's list: フォローとタイムライン、管理), `:34` (DB row: Go writes accounts for 管理), `:42` (what the web touches), `docs/architecture.md:20` (mermaid `DATA[フォロー・LINE の復習のお知らせ]`), `:33` (web → DB edge), `:43` (bullet), `:109` (password change → sessionVersion), `:209` (「入力の検証が 2 か所にある」 — after 9b only the web validates admin input; Go still normalises loginId at sign-in), `:210` (owner integrity in Go), `docs/features.md:14` (Go refuses follows and password for the demo), `:67-72` (follow rules), `docs/roadmap.md:28`, `scripts/api-smoke.sh:39-47` (members/follow/timeline/unfollow calls).

## 12. Go code these routes use, and who else uses it

| Go code                                                                                                                                                                                                                                                                                                                                         | Other users after the stage                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| httpapi/follow_handlers.go (all)                                                                                                                                                                                                                                                                                                                | none                                                                                                            |
| httpapi/entry_handlers.go `toEntryJSON`, `entryJSON`, `hintJSON`, `readListQuery`, `decimalUpTo`, `paginate`, `defaultListLimit`, `maxListLimit`                                                                                                                                                                                                | only follow_handlers.go and entry_handlers_test.go                                                              |
| httpapi/entry_handlers.go `formatTime`, `timeLayout`                                                                                                                                                                                                                                                                                            | **admin_handlers.go (9b) and line_handlers.go (stage 10)** — keep (move to respond.go in 9a)                    |
| httpapi/validate.go `encodeCursor`, `decodeCursor`, `errCursor`                                                                                                                                                                                                                                                                                 | only `readListQuery` and validate_test.go                                                                       |
| httpapi/validate.go `validID`, `maxIDBytes`                                                                                                                                                                                                                                                                                                     | only admin_handlers.go (9b) (auth/login.go has its own local `validID` variable)                                |
| router.go `Follows` interface :41-49, `_ Follows` :15, `Deps.Follows`, `memberRoutes` :256-264                                                                                                                                                                                                                                                  | none                                                                                                            |
| store/follows.go `Member`, `MemberDirectory`, `TimelineItem`, `memberAccounts`, `ListMembers`, `Follow`, `Unfollow`, `ListTimeline`                                                                                                                                                                                                             | `s.Follow` in store/demo_test.go:164-169 (test setup only)                                                      |
| store/follows.go `MemberExists` :79-96                                                                                                                                                                                                                                                                                                          | **main.go:58-75 `ownerValid` (LINE, stage 10)** — keep                                                          |
| store/entries.go `Cursor`, `cursorArgs`, `entryColumnsAs`                                                                                                                                                                                                                                                                                       | only follows.go                                                                                                 |
| store/entries.go `Entry`, `Hint`, `entryColumns`, `entryDest`, `scanEntries`, `attachHints`, `entryPtrs`, `dbtx`                                                                                                                                                                                                                                | linebot (`store.Entry`), testhelpers `readNotes` (demo, entries, line tests), refresh_tokens.go (`dbtx`) — keep |
| store/testhelpers_test.go `shareNote` :132-137                                                                                                                                                                                                                                                                                                  | only follows_test.go                                                                                            |
| respond.go `msgSelfFollow`, `codeSelfFollow`                                                                                                                                                                                                                                                                                                    | none                                                                                                            |
| httpapi/demo.go `notDemo`, router `notForDemo`                                                                                                                                                                                                                                                                                                  | **LINE link routes (stage 10)** — keep                                                                          |
| router.go `notForDemoWrapped`                                                                                                                                                                                                                                                                                                                   | only `notForDemo` and `accountRoutes` (9b): fold into `notForDemo` in 9b                                        |
| httpapi/admin_handlers.go (all), account_handlers.go (all)                                                                                                                                                                                                                                                                                      | none                                                                                                            |
| router.go `Accounts` :51-58, `_ Accounts`, `_ PasswordHasher` :20-21, `Deps.Accounts`/`Hasher` :76-78, `adminOnly` :197-198, `accountRoutes`, `adminRoutes`                                                                                                                                                                                     | none                                                                                                            |
| `Auth.ChangePassword` router.go:32, testutil `fakeAuth.changePass`                                                                                                                                                                                                                                                                              | none                                                                                                            |
| respond.go `msgAdminOnly`, `msgMembersOnly`, `msgInvalidNewPassword`, `msgPasswordMismatch`, `msgInvalidCurrentPassword`, `msgInvalidLoginID`, `msgInvalidName`, `msgLoginIDTaken`, `msgAccountNotFound`, `codePasswordMismatch`, `codeInvalidCurrentPassword`, `codeLoginIDTaken`; the three `writeServiceError` cases for the password errors | none                                                                                                            |
| `pathValue` respond.go:158-162                                                                                                                                                                                                                                                                                                                  | only follow_handlers.go — dies in 9a (`pathValueMsg` stays for 9b)                                              |
| `pathValueMsg` respond.go:164-172                                                                                                                                                                                                                                                                                                               | only admin_handlers.go — dies in 9b                                                                             |
| auth/password_change.go (all); service.go `Store.SetPassword` :51                                                                                                                                                                                                                                                                               | none                                                                                                            |
| auth/password.go `Hash` :170-185, `GeneratePassword` :197-201                                                                                                                                                                                                                                                                                   | none (`formatScryptHash`, `generatedBytes` stay: `Warm` uses them)                                              |
| auth/password.go `Verify`, `Simulate`, `Warm`, `parseScryptHash`, constants                                                                                                                                                                                                                                                                     | **sign-in (stage 11)** — keep                                                                                   |
| auth/service.go `Hasher.Hash` :84                                                                                                                                                                                                                                                                                                               | none                                                                                                            |
| auth/validate.go `ValidNewPassword`, `ValidDisplayName`, `minNewPasswordUnits`, `maxNewPasswordUnits`, `maxDisplayNameUnits`                                                                                                                                                                                                                    | none                                                                                                            |
| auth/validate.go `NormalizeLoginID`, `loginIDPattern`                                                                                                                                                                                                                                                                                           | **auth/login.go:90, config.go:173** — keep                                                                      |
| jsstr `Len`                                                                                                                                                                                                                                                                                                                                     | only `ValidNewPassword`/`ValidDisplayName` (dies in 9b); `Trim`, `ToLower`, `IsSpace` stay                      |
| store/accounts.go `SetPassword`, `AccountSummary`, `ListPasswordAccounts`, `CreatePasswordAccount`, `ErrLoginIDTaken`, `pgconn` import                                                                                                                                                                                                          | `CreatePasswordAccount` in store/demo_test.go:230 (test setup only)                                             |
| store/accounts.go `PasswordAccount`, `FindPasswordAccountBy*`, `SessionVersion`, `MemberOwnerPrefix`/`MemberOwnerID`, `FfpfOwnerPrefix`                                                                                                                                                                                                         | **sign-in, demo, LINE** — keep                                                                                  |
| store/throttle.go                                                                                                                                                                                                                                                                                                                               | sign-in, LINE codes, route limits — keep                                                                        |
| main.go:162-164 `Follows: db`, `Accounts: db`, `Hasher: passwords`                                                                                                                                                                                                                                                                              | `passwords` stays (`Service.Passwords`)                                                                         |

## 13. Becomes dead

- **After 9a** — Go: httpapi/follow_handlers.go, follow_handlers_test.go, entry_handlers.go and entry_handlers_test.go (after moving `formatTime`/`timeLayout` to respond.go), validate.go cursor functions and validate_test.go (its only tests are `TestCursorRoundTrip`, `TestDecodeCursorRejects`), `pathValue`, router `Follows`/`_ Follows`/`Deps.Follows`/`memberRoutes`, store/follows.go everything but `MemberExists` (rename the file to store/members.go), entries.go `Cursor`/`cursorArgs`/`entryColumnsAs`, testhelpers `shareNote`, `msgSelfFollow`/`codeSelfFollow`, main.go `Follows: db`. Web: `src/infrastructure/go-api/social-gateway.ts`, `tests/go-api-social-gateway.test.ts`. Docs: §11 social items. `scripts/api-smoke.sh` lines 39-47.
- **After 9b** — Go: httpapi/admin_handlers.go(+test), account_handlers.go(+test), validate.go (whole file: `validID` is its last function), `pathValueMsg`, router `Accounts`/`PasswordHasher`/`Deps.Accounts`/`Deps.Hasher`/`adminOnly`/`accountRoutes`/`adminRoutes`/`notForDemoWrapped`, `Auth.ChangePassword`, respond.go messages/codes/cases of §12, auth/password_change.go(+test), `Store.SetPassword`, `Hasher.Hash`, `PasswordVerifier.Hash`, `GeneratePassword` (+ their tests in password_test.go: `TestHashVerifiesAndMatchesFormat`, `TestHashSharesTheBoundAndRespectsContext`, `TestHashScryptFailure`, `TestGeneratePassword`), `ValidNewPassword`/`ValidDisplayName` (+ tests), `jsstr.Len` (+ `TestLen`), store/accounts.go `SetPassword`/`AccountSummary`/`ListPasswordAccounts`/`CreatePasswordAccount`/`ErrLoginIDTaken` (+ `TestSetPassword`, `TestCreateAndListPasswordAccounts`, `TestCreatePasswordAccountDuplicateLoginID`), helpers_test `fakeStore.SetPassword`/`setPasswordAt` and `fakeHasher.Hash`, main.go `Accounts: db`, `Hasher: passwords`. Web: the account methods of `account-gateway.ts` (the LINE methods move to their own gateway), `tests/go-api-account-gateway.test.ts` account tests, `scripts/lib/scrypt-password-hasher.ts` (moved into `src/`). Docs: §11 account items.

## 14. Go tests to rewrite (not just delete)

- `httpapi/demo_test.go`: `allRoutesDeps` drops `Follows`; `TestDemoIsRefusedExactlyTheClosedRoutes` `want` loses the four social routes (9a) and `POST /v1/account/password` (9b) — after 9b only the five LINE link routes are closed to the demo; `TestDemoIsRefusedTheMemberDirectory` dies (9a); `TestDemoCheckErrorIsNotAPass` moves to `GET /v1/line/link` with `Deps{Auth: a, Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret}`.
- `httpapi/act_as_test.go`: `TestActAsWritesGoToTheMember` (follow) → after 9a no Go route writes as the member; it becomes `TestActAsIsLogged`: `GET /v1/me` with the act-as header (`a.me` returns a `Me`), 200 and the `acting as member` log line with `actor` and `owner` (TestMeWhileActing already pins the principal). The "member is refused on every authed route" case drops `Follows`.
- `httpapi/router_test.go`: the three `Deps{… Follows: &fakeFollows{} …}` lose `Follows` (9a); nothing else changes (the remaining authed routes are `/v1/me` and LINE).
- `main_test.go:392-445`: the follow round trip (`shareEntry`, members, self-follow 400, follow 204, timeline) → `GET /v1/me` with `second.AccessToken` → 200 and `ownerId == owner` (proves the refreshed token works); remove `memberB` and whatever else becomes unused (`go vet`).
- `store/demo_test.go:164-169`: `s.Follow(…)` → `execOne`-style direct `INSERT INTO "Follow" ("followerId","followeeId","createdAt") VALUES ($1,$2,$3)` (both directions) (9a); `:230` `s.CreatePasswordAccount(…)` → direct `INSERT INTO "PasswordAccount" (…) VALUES (…)` returning the id (9b).
- `store/follows_test.go` → `store/members_test.go` with `TestMemberExists`, `TestMemberExistsFfpf` and the helpers they need (`newMember`, `newFfpfMember`); the rest dies (9a).

## 15. Production state

- No migration: `Follow`, `PasswordAccount`, `FfpfAccount`, `SignInThrottle`, `LearningEntry`, `Hint` all exist.
- No new environment variable: the web reads the database since stage 0 (`DATABASE_URL`), decides admins itself (`AUTH_ALLOWED_GITHUB_IDS`) and the demo (`DEMO_LOGIN_ID`). The `ja-x-icu` collation was already checked for Go on the same database.
- 9b runs scrypt in the web's functions: 32 MiB per computation, about 0.1 s; Node runs it on the libuv thread pool (4 threads by default), so at most 4 at once per instance, like Go's semaphore.
- Until Go is redeployed from the merged main, the production Go keeps answering the moved routes; nothing calls them once the web is promoted. Go's sign-in keeps verifying the hashes the web writes, and keeps refusing tokens whose `sv` the web bumped.
