# 段階 2 の参照：Go の学習ノート・ゴミ箱・共有・カレンダー・検索の今の動き（2026-11-16 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage2-learning.md.

## 0. Routing (httpapi/router.go)

- Registration: `entryRoutes` router.go:320-340, `memberRoutes` router.go:345-353.
- `privateReadUser` (router.go:250-252): requireAuth (no guests) and handler honours `?user=` via `readOwner`. Used by exactly 5 routes: GET /v1/entries, GET /v1/entries/{id}, GET /v1/log-dates, GET /v1/log-dates/{date}/entries, GET /v1/log-dates/{date}/entries/{number} (router.go:324-328).
- `private` (router.go:245-247): requireAuth + `rejectUserParam` → any `user` key in the query → 400 invalid_request "リクエストが不正です。" (owner.go:51-62). Used by POST /v1/batches, PATCH/DELETE /v1/entries/{id}, GET/DELETE /v1/trash, POST /v1/trash/{id}/restore, DELETE /v1/trash/{id} (router.go:330-339).
- `notForDemo` (router.go:259-267): authed + `notDemo` → demo account gets 403 forbidden "デモでは使えません。" (msgDemoRestricted respond.go:42). Used by PUT/DELETE /v1/entries/{id}/share (router.go:347-348).
- There is no separate search route: search is query params on GET /v1/entries (see §1).

### readOwner (owner.go:19-47)

- No `user` key → caller's OwnerID. Malformed query string → 400 generic.
- `user` key repeated (len != 1) → 400 generic.
- `user == self.OwnerID` → self (allowed for anyone).
- else must match `^(\d+|password:[a-z0-9]{20,32}|ffpf:[a-z0-9]{1,64})$` (owner.go:13) else 400 generic.
- else non-admin → 403 forbidden "他の人の記録は管理者だけが見られます。" (msgAdminOnlyView respond.go:28).
- admin → that owner (no existence check of the owner).

### Error helpers (respond.go)

- Envelope `{"error":{"code","message"}}` (respond.go:92-99); `Cache-Control: no-store` on all JSON (respond.go:110).
- `writeBadRequest` 400 invalid_request "リクエストが不正です。"; `writeNotFound` 404 not_found "見つかりません。"; `writeStoreError(err, msg)` → 404 with msg on store.ErrNotFound, else writeServiceError → 500 internal "サーバーでエラーが発生しました。" (respond.go:122-174).
- `pathValue`: invalid path param → 404 "見つかりません。" (respond.go:190-202).
- `decodeBody`: exactly one JSON object, unknown fields rejected, trailing data rejected (respond.go:207-225); body too large → 413 too_large "リクエストが大きすぎます。" (respond.go:229-236).
- Middleware-level (any authed route): 401 unauthorized "認証が必要です。", 403 forbidden "このアカウントは利用できません。" (revoked/allowlist).

### Admin acting as member (middleware.go:141-210)

- Header `X-Zhuelog-Act-As: password:<id>` (pattern `^password:[a-z0-9]{1,64}$`, middleware.go:175). Non-admin → 403 "他の人として操作できるのは管理者だけです。"; bad/multiple → 400 generic; unknown member → 404 "会員が見つかりません。". Principal then = the member (OwnerID = member, ActorID = admin). All stage-2 routes honour it (none wrap `notActing`). Guests → 403 "このアカウントは利用できません。" on every stage-2 route (middleware.go:160-163).
- Body limit 1 MiB for every stage-2 route (middleware.go:18,128-139) → 413.

## 1. Shared building blocks

### Entry JSON (httpapi/entry_handlers.go:19-56)

```
{ id, kind, originalText, correctedText, pinyin,
  hints: [{id, content, position}],   // ordered by position, always an array
  createdAt: "YYYY-MM-DDTHH:MM:SS.sssZ",  // UTC, ms (timeLayout :16, formatTime :36)
  sharedAt: string | null }
```

- Batch JSON `{id, importedAt}` (entry_handlers.go:58-66).

### List query (entry_handlers.go:96-140)

- `limit`: default 50, 1..100, digits only (leading zeros OK, e.g. "007"), repeated → 400 generic; >100 or 0 or non-digit → 400 generic "リクエストが不正です。".
- `cursor`: repeated → 400; empty string = no cursor; else base64url (no padding) of `"<unixMillis>|<id>"` (validate.go:166-190); invalid (bad b64, no "|", extra "|", invalid id, negative ms, year > 9999) → 400 generic.
- Fetch `limit+1` rows; if more than limit, trim and `nextCursor` = cursor of last kept row; else `nextCursor: null` (paginate :133-140).
- Count runs BEFORE list (comment :162-163) — no transaction, total may lag.

### validID (validate.go:160-164)

- Path id: non-empty, ≤128 bytes, valid UTF-8, no NUL; else 404 "見つかりません。" (no cuid format check).

### Entry validation (validate.go:17-158)

- Limits: text fields 2000 runes (maxTextRunes), hint 500 runes, max 20 hints, batch 1..500 entries (:17-22).
- `cleanText`: TrimSpace, must be non-empty, no NUL, ≤ max runes (code points, utf8.RuneCountInString) (:60-71). Stored value is the trimmed one.
- `kind`: absent → "correction" on create; must be "correction" | "translation" (:50-56, :90-98). JSON null for any field → decode error → 400 (optString/optStrings reject null, also null array elements) (:192-232).
- PATCH: at least one of kind/originalText/correctedText/pinyin/hints, else 400; given text fields cleaned the same way; `hints` (even `[]`) replaces all hints (:120-158).
- Unknown JSON fields → 400 (decodeBody DisallowUnknownFields). All validation failures → 400 generic "リクエストが不正です。" (no per-field message).
- DB CHECK on LearningEntry.kind IN ('correction','translation') (prisma/migrations/20261005090000_learning_kind_and_translation/migration.sql:4).

### Search filter = GET /v1/entries ?q= &hint= &kind= (entry_handlers.go:182-222, store/entries.go:162-218)

- Each key at most once; values TrimSpace'd; ≤100 runes (maxFilterRunes :183); kind ∈ {"", correction, translation}. Empty = no filter.
- Any violation (incl. malformed query) → 400 invalid_request "検索の条件が正しくありません。語句とヒントは100文字まで、種類は添削か翻訳です。" (msgInvalidEntryFilter respond.go:24, entry_handlers.go:153-157). Note order: limit/cursor checked first (generic 400), then filter, then `?user=`.
- SQL (all ANDed): `"kind" = $k`; q → `"id" IN (SELECT id FROM LearningEntry WHERE lower(originalText) LIKE lower($p) ESCAPE '\' OR lower(correctedText) ... OR lower(pinyin) ... UNION SELECT learningEntryId FROM Hint WHERE lower(content) LIKE lower($p) ESCAPE '\')`; hint → `EXISTS (SELECT 1 FROM Hint h WHERE h.learningEntryId = LearningEntry.id AND lower(h.content) LIKE lower($h) ESCAPE '\')` (entries.go:174-209).
- Pattern = `%` + term with `\`→`\\`, `%`→`\%`, `_`→`\_` + `%` (entries.go:211-218): literal, case-insensitive substring.
- UNION (not OR EXISTS) is deliberate so the planner can BitmapOr the trigram indexes (comment entries.go:184-189).
- Trigram indexes (prisma/migrations/20261116090000_add_entry_search_trgm/migration.sql:9-21): `CREATE EXTENSION IF NOT EXISTS pg_trgm`; GIN `lower("originalText") gin_trgm_ops`, same for correctedText, pinyin, and `Hint lower("content")`. Not in schema.prisma (raw SQL migration only).

### Shared SQL helpers (store/entries.go)

- Columns `"id","kind","originalText","correctedText","pinyin","createdAt","sharedAt"` (entries.go:79). Hints loaded with one query `WHERE "learningEntryId" = ANY($1) ORDER BY "learningEntryId","position"` (attachHints :133-160); every entry gets `[]` when it has none.
- `dbTime`: UTC, truncated to ms (TIMESTAMP(3) without time zone) (:74-77).
- `newID()`: "c" + 24 chars of [a-z0-9] from crypto/rand (store/store.go:131-148) — cuid-shaped, not real cuid; Prisma `@default(cuid())` would also be fine format-wise.
- All "not found" = row with (`id`, `ownerId`, deletedAt state) missing → `store.ErrNotFound` → 404 not_found "見つかりません。" (no distinction between "not yours", "missing", "wrong trash state").

## 2. Per route

### GET /v1/entries (list + search) — privateReadUser

- Handler entry_handlers.go:142-180; store ListEntries entries.go:222-243, CountEntries :247-257.
- Who: any admin/member (incl. demo, acting admin); `?user=` per readOwner.
- Validation order: limit/cursor (400 generic) → q/hint/kind (400 msgInvalidEntryFilter) → `?user=` (400/403).
- SQL: `WHERE ownerId=$1 AND deletedAt IS NULL AND ($2 IS NULL OR (createdAt,id) < ($2,$3)) AND <filter> ORDER BY createdAt DESC, id DESC LIMIT limit+1`. Count: same WHERE without cursor.
- Tie-break: id DESC (byte/collation order of text ids). Row-value comparison on (createdAt, id).
- Response 200: `{ entries: Entry[], nextCursor: string|null, total: number }`.
- Errors: 400 generic, 400 filter msg, 401, 403 (guest / msgAdminOnlyView), 500.

### GET /v1/entries/{id} — privateReadUser

- entry_handlers.go:224-241; store GetEntry entries.go:261-291.
- id via validID (404 on invalid) → readOwner → `WHERE id=$1 AND ownerId=$2 AND deletedAt IS NULL`.
- 200: Entry JSON. 404 "見つかりません。" for trashed/other owner/missing.
- **No caller in src/** (web never calls it; only the gateway's other routes).

### POST /v1/batches — private (no ?user=)

- entry_handlers.go:243-280; store CreateBatch entries.go:319-367.
- Body `{ "entries": [ {kind?, originalText, correctedText, pinyin, hints?} ] }`, 1..500 entries; each validated by validateDraft (any failure → 400 generic). `hints` absent → [] ; `kind` absent → correction.
- Owner = principal.OwnerID (acting admin → member).
- One tx (pgx.BeginFunc + pipelined batch): INSERT ImportBatch(id, fileName=`"mobile:" + <now UTC ms ISO, e.g. 2026-11-16T01:02:03.004Z>`, rowCount=len, importedAt=now) ; per entry i: INSERT LearningEntry(id=newID, kind, texts, createdAt = now + i ms, ownerId, batchId) ; INSERT Hint(id, content, position=i (0-based), learningEntryId) (entries.go:323-350, queueHints :295-303). sharedAt/deletedAt NULL.
- 201: `{ batch: {id, importedAt}, entries: Entry[] }` (input order).
- Errors: 400 generic, 413, 401/403, 500.
- **No caller in src/** (was for the mobile client).

### PATCH /v1/entries/{id} — private

- entry_handlers.go:282-305; store UpdateEntry entries.go:371-406.
- id → 404 if invalid; body decode/validatePatch → 400 generic.
- Tx: `UPDATE LearningEntry SET kind=COALESCE($3,kind), originalText=COALESCE($4,...), correctedText=..., pinyin=... WHERE id=$1 AND ownerId=$2 AND deletedAt IS NULL`; 0 rows → 404. If hints given: `DELETE FROM Hint WHERE learningEntryId=$1` then insert new hints (new ids, positions 0..n-1). Then re-read with getEntry in the tx.
- Does not touch createdAt/sharedAt/ReviewItem.
- 200: Entry JSON. **No caller in src/.**

### DELETE /v1/entries/{id} (move to trash) — private

- entry_handlers.go:307-319; store TrashEntry entries.go:410-421.
- `UPDATE LearningEntry SET deletedAt=$now WHERE id=$1 AND ownerId=$2 AND deletedAt IS NULL` (no tx). 0 rows → 404.
- 204 no body.
- Side effects (implicit, via queries elsewhere): note disappears from lists/log-dates/search/timeline (follows.go:129 `sharedAt IS NOT NULL AND deletedAt IS NULL`); its ReviewItem (kind "entry") stays but is hidden from due list/count/notify by `notTrashedEntry` (entry_reviews.go:24-31; used in review_items.go:96,204,217 and line_review_notify.go:64); EntryIDsInReview/EntryInReview ignore it. sharedAt is kept.

### GET /v1/trash — private

- trash_handlers.go:16-49; store ListTrashed trash.go:21-44, CountTrashed :47-55.
- readListQuery (limit 1..100 default 50, cursor). Cursor here encodes **deletedAt** (not createdAt) + id (trash_handlers.go:39-41).
- SQL: `WHERE ownerId=$1 AND deletedAt IS NOT NULL AND ($2 IS NULL OR (deletedAt,id) < ($2,$3)) ORDER BY deletedAt DESC, id DESC LIMIT n`. Count first.
- 200: `{ entries: (Entry & {deletedAt: string})[], nextCursor, total }` (flattened: entry fields + deletedAt).
- Always caller's own trash (`?user=` → 400).

### DELETE /v1/trash (empty) — private

- trash_handlers.go:80-89; store EmptyTrash trash.go:124-143.
- Tx: `DELETE FROM LearningEntry WHERE ownerId=$1 AND deletedAt IS NOT NULL RETURNING id`; then `deleteEntryReviews(ids)` = `DELETE FROM ReviewItem WHERE ownerId=$1 AND kind='entry' AND targetId = ANY($3)` (entry_reviews.go:130-137). Hints cascade by FK (Hint→LearningEntry onDelete Cascade, schema.prisma:45); ReviewLog cascade by FK from ReviewItem (schema.prisma:281).
- 200: `{ "deleted": n }` (0 when empty).

### POST /v1/trash/{id}/restore — private

- trash_handlers.go:51-64; store RestoreEntry trash.go:73-95.
- Tx: `UPDATE ... SET deletedAt=NULL WHERE id=$1 AND ownerId=$2 AND deletedAt IS NOT NULL`; 0 → 404; re-read.
- sharedAt left as it was (restored shared note reappears on followers' timeline); createdAt unchanged (returns to same date/number).
- 200: Entry JSON.

### DELETE /v1/trash/{id} (purge) — private

- trash_handlers.go:66-78; store PurgeEntry trash.go:100-120.
- Tx: `DELETE FROM LearningEntry WHERE id=$1 AND ownerId=$2 AND deletedAt IS NOT NULL`; 0 → 404; then deleteEntryReviews([id]).
- Only trashed notes can be purged (live note → 404).
- Not touched by purge/empty: ImportBatch (empty batch rows remain), VocabularyEntry.sourceEntryId (plain ref, schema.prisma:298-307), LineMessage.entryId.
- 204.

### PUT / DELETE /v1/entries/{id}/share — notForDemo

- router.go:347-348; handler trash_handlers.go:91-109; store SetShared trash.go:148-178.
- Order: requireAuth → rejectUserParam (?user → 400) → notDemo (demo → 403 "デモでは使えません。") → role check `p.Role != RoleMember` → 403 forbidden "共有できるのは会員だけです。" (msgShareMembersOnly respond.go:26) — this includes admins AND admins acting as a member (acting principal keeps Role admin, auth/me.go:39) → then id (404 if invalid).
- notDemo: `IsDemo` true only for a non-acting member whose password account is the demo account (auth/demo.go:53-68). Web equivalent: `AuthenticatedUser.demo` (src/domain/identity/entities/authenticated-user.ts:24-26).
- PUT tx: `UPDATE SET sharedAt=$now WHERE id AND ownerId AND deletedAt IS NULL AND sharedAt IS NULL` (no-op keeps first sharedAt), then getEntry → 404 if missing/trashed.
- DELETE tx: `UPDATE SET sharedAt=NULL WHERE id AND ownerId AND deletedAt IS NULL` (unsharing unshared = success), then getEntry.
- 200: Entry JSON (with sharedAt). Trashed note → 404 for both.
- Visibility: Follow/timeline reads `sharedAt IS NOT NULL AND deletedAt IS NULL` (store/follows.go:121-157). No Follow rows touched.

### GET /v1/log-dates — privateReadUser

- daily_handlers.go:38-62; store ListLogDates daily.go:38-61.
- SQL: `SELECT ("createdAt" + interval '9 hours')::date AS d, count(*) FROM LearningEntry WHERE ownerId=$1 AND deletedAt IS NULL GROUP BY d ORDER BY d DESC` (jstDay daily.go:14-16; adds 9h because columns are timestamp without tz holding UTC).
- 200: `{ dates: [{ date: "YYYY-MM-DD", count }] }`, newest first, all dates (no paging).

### GET /v1/log-dates/{date}/entries — privateReadUser

- daily_handlers.go:69-96; store ListDailyEntries daily.go:65-83.
- `date` must be exactly zero-padded `YYYY-MM-DD`, real calendar date, year 2000..9999 (parseLogDate daily_handlers.go:16-24) else **400** generic (checked before readOwner).
- Range = [JST midnight of d, JST midnight of d+1) converted to UTC (dayRange daily.go:29-34; jst.Location = fixed UTC+9, jst/jst.go:9).
- SQL: `WHERE ownerId AND deletedAt IS NULL AND createdAt >= start AND createdAt < end ORDER BY createdAt ASC, id ASC` (no limit).
- 200: `{ date: <raw path value>, entries: (Entry & {number})[] }`, number = 1-based index in that order.

### GET /v1/log-dates/{date}/entries/{number} — privateReadUser

- daily_handlers.go:98-126; store GetDailyEntry daily.go:88-123.
- date as above (400); number: digits only, no leading zero, 1..2147483647 (parseNumber :30-36; decimalUpTo) else 400 generic.
- Count of that JST day (live notes) first; number > total → 404 "見つかりません。"; then `ORDER BY createdAt ASC, id ASC OFFSET number-1 LIMIT 1` (no tx; vanished row → 404).
- "number" is the 1-based position among the owner's non-trashed notes of that JST day, so it shifts when an earlier note of that day is trashed/restored/purged (web redirects with replace after trashing for this reason: note-trash-actions.ts:15-19).
- 200: `{ entry: Entry, number, total }`.

## 3. Error codes / messages per route (beyond the common 401 "認証が必要です。" / 403 "このアカウントは利用できません。" (guest/revoked) / 500 "サーバーでエラーが発生しました。" / act-as errors)

| Route                                                                                                                                                                           | 400                                                                                                                             | 403                                                    | 404                | other                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------ | ----------------------------------------------- |
| GET /v1/entries                                                                                                                                                                 | "リクエストが不正です。" (limit/cursor/user); "検索の条件が正しくありません。語句とヒントは100文字まで、種類は添削か翻訳です。" | "他の人の記録は管理者だけが見られます。"               | –                  |                                                 |
| GET /v1/entries/{id}                                                                                                                                                            | "リクエストが不正です。" (user)                                                                                                 | msgAdminOnlyView                                       | "見つかりません。" |                                                 |
| POST /v1/batches                                                                                                                                                                | "リクエストが不正です。"                                                                                                        | –                                                      | –                  | 413 too_large "リクエストが大きすぎます。"; 201 |
| PATCH /v1/entries/{id}                                                                                                                                                          | "リクエストが不正です。"                                                                                                        | –                                                      | "見つかりません。" | 413                                             |
| DELETE /v1/entries/{id}                                                                                                                                                         | user param                                                                                                                      | –                                                      | "見つかりません。" | 204                                             |
| GET /v1/trash                                                                                                                                                                   | limit/cursor/user                                                                                                               | –                                                      | –                  |                                                 |
| DELETE /v1/trash                                                                                                                                                                | user param                                                                                                                      | –                                                      | –                  |                                                 |
| POST /v1/trash/{id}/restore                                                                                                                                                     | user param                                                                                                                      | –                                                      | "見つかりません。" |                                                 |
| DELETE /v1/trash/{id}                                                                                                                                                           | user param                                                                                                                      | –                                                      | "見つかりません。" | 204                                             |
| PUT/DELETE /v1/entries/{id}/share                                                                                                                                               | user param                                                                                                                      | "デモでは使えません。"; "共有できるのは会員だけです。" | "見つかりません。" |                                                 |
| GET /v1/log-dates                                                                                                                                                               | user                                                                                                                            | msgAdminOnlyView                                       | –                  |                                                 |
| GET /v1/log-dates/{date}/entries                                                                                                                                                | bad date / user                                                                                                                 | msgAdminOnlyView                                       | –                  |                                                 |
| GET /v1/log-dates/{date}/entries/{number}                                                                                                                                       | bad date/number/user                                                                                                            | msgAdminOnlyView                                       | "見つかりません。" |                                                 |
| All 400 use code `invalid_request`; 403 `forbidden`; 404 `not_found`. Unknown method on a known path → 405 method_not_allowed "このメソッドは使用できません。" (jsonMuxErrors). |

## 4. Web side today

### Owner decision (web)

- `resolveRecordOwner(user, requested)` src/application/identity/use-cases/resolve-record-owner.ts:22-36: no user/revoked → denied unauthenticated; guest → denied guest; no githubId → denied reauth; `requested` absent or == own → self; non-admin or `!isOwnerId(requested)` → `redirect-self` (Go would 400/403 instead); admin + valid → `other`. `isOwnerId` (src/domain/identity/owner-id.ts:5-18) = same regex as Go ownerIDPattern.
- `getRecordOwner` src/composition/identity-container.ts:55-61; guards `requireSignedInOwner` / `requireNonGuestOwner` in src/presentation/guards/record-owner-guard.ts.
- Acting admin: `AuthenticatedUser.githubId` = member's ownerId, role stays "admin", `actorId` = admin (src/domain/identity/entities/authenticated-user.ts:3-27); `demo` flag for the demo account. Gateways send `X-Zhuelog-Act-As` via `confirmedActAs` (src/infrastructure/go-api/authed.ts:18-65). Stage-1 pattern for owner/actor/demo: src/application/vocabulary/vocabulary-book.ts:50-110 (`ownerId: user.githubId`, `actorId: user.actorId ?? user.githubId`, `demo: user.demo === true`, members-or-admins only).
- `ViewedOwner = {kind:"self"|"other"; ownerId}` src/domain/learning/viewed-owner.ts:3. Gateway adds `?user=` only for "other" (learning-gateway.ts:57-61, `withUserParam` authed.ts:45-49).

### Gateway: src/infrastructure/go-api/learning-gateway.ts

| Method                                   | Go route                                   | Notes                                                                         |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| listRecent(owner, limit, search?) :66-77 | GET /v1/entries?limit=…&q&kind&hint[&user] | returns {entries,total}; nextCursor ignored                                   |
| listAll(maxPages=100) :81-95             | GET /v1/entries?limit=100&cursor=…         | own notes only, ≤10,000 (EXPORT_PAGE_SIZE 100 × EXPORT_MAX_PAGES 100, :49-51) |
| listLogDates(owner) :98-104              | GET /v1/log-dates                          | parseGoDate :244-252                                                          |
| listDailyEntries(owner, date) :106-115   | GET /v1/log-dates/{YYYY-MM-DD}/entries     | ignores `number` and `date` fields                                            |
| getDailyEntry(owner, date, n) :118-133   | GET …/entries/{n}                          | 404 → null                                                                    |
| trash(id) :138-140                       | DELETE /v1/entries/{id}                    | 404 → false (`found` :226-234)                                                |
| restore(id) :142-146                     | POST /v1/trash/{id}/restore                | 404 → false                                                                   |
| purge(id) :148-150                       | DELETE /v1/trash/{id}                      | 404 → false                                                                   |
| emptyTrash() :153-158                    | DELETE /v1/trash                           | returns deleted                                                               |
| listTrashed() :161-173                   | GET /v1/trash?limit=100                    | one page only (TRASH_LIST_LIMIT 100 :47), {entries+deletedAt,total}           |
| setShared(id, shared) :176-183           | PUT/DELETE /v1/entries/{id}/share          | 404 → false                                                                   |
| isInReview / setInReview :187-209        | /v1/entries/{id}/review                    | **stage 4 — stays**                                                           |
| importCsv(file) :213-218                 | POST /v1/imports/csv                       | **stage 3 — stays**                                                           |

- Types exported: RecentLearningEntries, LogDateSummary, DailyLearningEntry, TrashedLearningEntry(+deletedAt), TrashedLearningEntries (:23-34).
- learning-json.ts: `GoEntryJson`, `toLearningEntry` (zod-checks kind, sorts hints by position) :9-36, `toDate` :38-42. Also used by src/infrastructure/go-api/social-gateway.ts:10 (timeline, stage 9), review-gateway.ts:8 (stage 4), account-gateway.ts:3 (`toDate`) → learning-json.ts must stay until those move.
- Composition: src/composition/learning-container.ts:5 `learningNotes = createLearningGateway()` (single instance also used for review & CSV).
- Not called anywhere in src/: GET /v1/entries/{id}, PATCH /v1/entries/{id}, POST /v1/batches.

### Callers

- src/app/page.tsx:41-57,111,147-153 — home: `listRecent(owner, 100, search)` via `loadOr("LEARNING_ENTRIES_UNAVAILABLE")` (Go failure → alert, empty); search from `parseEntrySearch(params)`; also review cards (stage 4).
- src/app/logs/page.tsx:48-54 — `listLogDates(owner)` (calendar; newest date first used as default month :56).
- src/app/logs/[year]/[month]/[day]/page.tsx:60-66 — `listDailyEntries(owner,date)` + `listLogDates(owner)`.
- src/app/logs/[year]/[month]/[day]/[number]/page.tsx:98-111 — `getDailyEntry(owner,date,n)` (null → notFound()); `isInReview` (stage 4); `canShare = owner.kind==="self" && user.role==="member"` :111; share/trash forms :186-208.
- src/app/logs/trash/page.tsx:28-35 — own trash only (`?user=` not read), `listTrashed()`.
- src/app/export/page.tsx:18-23 — own notes only, `listAll()`.
- src/presentation/actions/note-trash-actions.ts:24-64 — trash (then `redirect(trashedRedirectPath("/logs", formData), replace)`), restore, purge, emptyTrash; `revalidateNotes()` (src/presentation/actions/revalidate-notes.ts:4-7: `/` and `/logs` layout).
- src/presentation/controllers/note-trash-controller.ts:18-50 — owner = `getCurrentMemberUser().githubId` (admins & members; never from form); id `noteIdSchema` = `/^[a-z0-9]{1,64}$/` (src/presentation/controllers/action-state.ts:21); false → "このノートは見つかりませんでした。画面を更新してください。"; errors via `attemptGoAction("NOTE_TRASH_FAILED")` (Go 403 → actionUnauthorized, action-state.ts:52-63).
- src/presentation/actions/follow-actions.ts:41-55 — `shareLearningEntryAction`; revalidates notes + `/follow`.
- src/presentation/controllers/follow-controller.ts:69-87 — `handleShare`: requires `user.role === "member"` (admins incl. acting refused → actionUnauthorized); `shared` ∈ "true"/"false"; `attemptGoAction("SHARE_FAILED")`. Demo is NOT checked on web today (relies on Go's 403 → actionUnauthorized).
- Presenters/components touching these: src/presentation/presenters/log-date-presenter.ts (getLogDateHref, formatLogDate, formatTokyoDateTime), note-calendar-presenter.ts, recent-entry-number.ts, record-owner-href.ts, note-trash-href.ts; components learning/entry-search-form, learning/learning-entry-card, records/note-calendar, records/trash-list, records/trash-notice, records/note-action-form, records/record-owner-controls.

### Domain types

- src/domain/learning/entities/learning-entry.ts:1-20 — LearningHint, LEARNING_KINDS ["correction","translation"], LearningEntry {id, kind, originalText, correctedText, pinyin, createdAt, sharedAt, hints}.
- src/domain/learning/entry-search.ts:6-60 — EntrySearch {query, kind|null, hint}; ENTRY_SEARCH_MAX_LENGTH 100; `parseEntrySearch` trims and CUTS to 100 code points (so web never triggers Go's filter 400); unknown kind ignored; `entrySearchQuery` builds q/kind/hint.
- src/domain/calendar/value-objects/log-date.ts:1-54 — LogDate {year,month,day}; `parseLogDate` (URL form: no leading zeros on month/day, year 2000..9999, real date); `parseLogNumber` (/^[1-9]\d*$/, ≤ 2147483647); `getTokyoDateParts` (UTC+9).
- src/domain/learning/viewed-owner.ts; src/domain/identity/owner-id.ts.

### Unit tests (tests/, node:test)

- tests/go-api-learning-gateway.test.ts (listRecent, listAll paging/limit, ?user=, log dates, daily, 404→null/false, trash/restore/purge/share paths, emptyTrash, listTrashed, importCsv, review queue, search before ?user=) — stage-2 parts to replace.
- tests/go-api-learning-json.test.ts, tests/learning-kind.test.ts:20-36 (toLearningEntry).
- tests/note-trash-controller.test.ts, tests/follow-controller.test.ts:258-360 (share), tests/entry-search.test.ts, tests/log-date.test.ts, tests/resolve-record-owner.test.ts, tests/log-date-presenter.test.ts, tests/note-calendar-presenter.test.ts, tests/recent-entry-number.test.ts, tests/record-owner-href.test.ts, tests/learning-csv-export.test.ts.
- Go tests covering stage-2 code: services/api/store/{entries,trash,daily,entry_filter}_test.go, review_orphans_test.go (purge cascade), httpapi/{entry_handlers,trash_handlers,daily_handlers,entry_filter,validate,owner}_test.go, router_test.go (route table / allowUser).

### E2E (e2e/)

- trash.spec.ts:27 (trash→restore→purge), :124 (admin viewing other cannot trash/see trash), :163 (narrow screen), :186 (back after trash doesn't reopen number).
- records.spec.ts:30 (members see own notes numbered from 1), :111 (admin views member read-only, keeps ?user=), :240 (malformed ?user=).
- learning.spec.ts:30 (guest no notes), :106 (export reads all notes), :186 (stale admin form after switching to guest), :237 (date/detail/adjacent navigation, JST grouping).
- follow.spec.ts:41 (follower sees only shared), :105 (unshare or trash removes from timeline), :170 (admin has no share button), :201 (cannot share another's note by forged id).
- home-search.spec.ts:5 (search UI); security.spec.ts:63 (huge log ordinals → 404); note-review.spec.ts:56 (trash hides note from review until restored); demo.spec.ts:22 (demo pages, closed features); theme.spec.ts:126; accounts.spec.ts:30; ffpf-login.spec.ts:39; act-as.spec.ts (acting).

## 5. Go code the remaining Go features still use from stage-2 code (must be kept)

store/entries.go:

- Types `Entry`, `Hint`, `EntryDraft`, `Batch`, `Cursor`, `dbtx`, `dbTime`, `isoMillisLayout` — used by follows.go (timeline, stage 9), line.go:220-240 (`CompleteLineMessage`, LINE stage 10), linebot/service.go:32,242, demo.go:132 (demo reset, stage 10), csvimport/parse.go:45 (stage 3), review_items.go/entry_reviews.go (stage 4), and dbTime/newID across many stores.
- `entryColumns`, `entryColumnsAs` (follows.go:124), `entryDest` (follows.go:140), `cursorArgs` (follows.go:122), `scanEntries` + `entryPtrs` + `attachHints` (entry_reviews.go:146-155 `entriesByID` → review_items.go:118; follows.go:153).
- `queueImportBatch`, `queueHints`, `execBatch` (line.go:227-229, demo.go:132,181), `CreateImportBatch` (httpapi/import_handlers.go:95, stage 3).
- Becomes dead after stage 2: `ListEntries`, `CountEntries`, `GetEntry`/`getEntry`, `entryFilterSQL`, `likeEscaper`/`likeContains`, `CreateBatch`, `UpdateEntry`, `TrashEntry`; all of trash.go (`TrashedEntry`, ListTrashed, CountTrashed, RestoreEntry, PurgeEntry, EmptyTrash, SetShared); `ListLogDates`, `ListDailyEntries`, `GetDailyEntry`, `LogDateCount`.
  store/daily.go: keep `jstDay` (study_log.go:26-38, review_items.go:151,240), `LogDate` + `dayRange` (study_log.go:23-24; httpapi/study_log_handlers.go:13).
  store/entry_reviews.go (stage 4, keep): `deleteEntryReviews` (only other user was trash.go), `notTrashedEntry` (review_items.go:96,204,217; line_review_notify.go:64), `lockOwnEntry`, `entriesByID`, `ReviewKindEntry`.
  httpapi:
- entry_handlers.go: `hintJSON`, `entryJSON`, `toEntryJSON` (follow_handlers.go:91,117; review_handlers.go:94,114), `formatTime`/`timeLayout` (line/question/chat/practice/vocabulary_json/review/admin handlers), `batchJSON`/`toBatchJSON` (import_handlers.go:48,101), `readListQuery`, `paginate`, `defaultListLimit`, `maxListLimit`, `decimalUpTo` (follow_handlers.go:102,111 timeline).
- validate.go: `encodeCursor`/`decodeCursor`/`errCursor` (via readListQuery/paginate → timeline), `validID`/`maxIDBytes` (admin_handlers.go:156, review_handlers.go:255,272,288). Dead after stage 2: `entryInput`, `patchInput`, `validateDraft`, `validatePatch`, `cleanText`, `cleanHints`, `validateKind`, `optString`, `optStrings`, `entryBody`, `maxBatchEntries` (csvimport does its own validation in csvimport/parse.go).
- daily_handlers.go: keep `parseLogDate`, `formatLogDate`, `minLogYear`/`maxLogYear` (study_log_handlers.go:39-40,59); `parseNumber`/`maxNumber` dead.
- owner.go: `readOwner`/`ownerIDPattern`/`msgAdminOnlyView` used only by the 5 stage-2 read routes → dead; `rejectUserParam` stays (all private routes). `privateReadUser` and `route.allowUser` (router.go:157,249-252) become unused.
- router.go: `Entries` interface (router.go:43-61) shrinks to `CreateImportBatch` (stage 3); `entryRoutes` keeps only `POST /v1/imports/csv`; `memberRoutes` keeps members/follows/timeline.
- respond.go: `msgInvalidEntryFilter`, `msgShareMembersOnly` dead; `msgAdminOnlyView` dead with readOwner.
  Other Go that reads/writes the same tables (stays): study_log.go:36 (counts live notes per JST day), follows.go:121-157 (timeline: sharedAt/deletedAt), line.go:220-240 (creates notes in batch "LINE"), demo.go:104-115 (deletes ImportBatch+LearningEntry of demo owner) and :132 (inserts batches "demo:<iso>"), review_items.go (entry cards), line_review_notify.go:64.

## 6. Surprises / risks for the TypeScript/Prisma port

1. Search needs `$queryRaw`: trigram GIN indexes are on `lower(col)` expressions (migration 20261116090000), so the predicate must be `lower(col) LIKE lower($p) ESCAPE '\'`; Prisma `contains`/`mode: insensitive` emits ILIKE on the bare column and would not use them. Keep the UNION (not OR EXISTS) shape (entries.go:184-199). Escape `\`, `%`, `_` exactly as likeEscaper (entries.go:212). `lower()` uses the DB's ctype for non-ASCII (pinyin tone marks) — do the lowering in SQL, not JS.
2. JST grouping for log dates needs raw SQL (`("createdAt" + interval '9 hours')::date`, GROUP BY expression); Prisma groupBy cannot group by an expression. `count(*)` comes back as bigint from `$queryRaw` → convert. Columns are `timestamp(3) without time zone` holding UTC; adding 9h (not AT TIME ZONE) is intentional (daily.go:11-16). Day ranges: JST midnight → UTC (= previous day 15:00Z).
3. Ordering / cursors: lists `createdAt DESC, id DESC`; trash `deletedAt DESC, id DESC`; daily `createdAt ASC, id ASC`; Go uses row-value `(a, id) < ($t, $id)`. Prisma needs `OR [{a: {lt}}, {a: t, id: {lt}}]`. id comparisons use DB collation — keep sorting in SQL. Cursor is opaque base64url(`ms|id`); only listAll uses it (web-internal), so its format can change freely.
4. Count and list are two queries with no tx (count first) — `total` can disagree with the page under concurrent writes; same for GetDailyEntry (count then OFFSET).
5. Validation parity: Go counts runes (code points) and uses `strings.TrimSpace` (Unicode White_Space; e.g. trims U+0085, not U+FEFF) — JS `trim()` differs (trims U+FEFF, not U+0085) and `.length` counts UTF-16 units. NUL rejected (PostgreSQL text cannot hold it). Limits 2000/500/20/500/100.
6. ids: Go `newID()` is "c"+24 [a-z0-9] (store.go:131-148); Prisma `@default(cuid())` ok. Web `noteIdSchema` is `/^[a-z0-9]{1,64}$/` (stricter than Go's validID ≤128 bytes).
7. sharedAt: re-sharing keeps the first sharedAt (conditional UPDATE `sharedAt IS NULL`); unsharing an unshared note succeeds; trashed note → not found for share/unshare; restore keeps sharedAt (note returns to timeline); trash keeps sharedAt but timeline filters `deletedAt IS NULL`. Only role "member" may share — admins and admins acting as a member (role stays admin) get 403; demo account 403 "デモでは使えません。" — the web currently does not check `user.demo` for share (Go did), so the port must add it. FFPF members are role member and may share.
8. Purge/empty must delete ReviewItem rows `kind='entry' AND targetId IN ids AND ownerId` in the same tx (no FK from ReviewItem to LearningEntry; ReviewLog cascades via FK). Hints cascade via FK. ImportBatch rows are never deleted on purge (empty batches remain; batch→entries cascade is only used by demo reset).
9. Trash does not touch ReviewItem; review due/count queries (still Go until stage 4) hide items of trashed notes via `notTrashedEntry`, so keeping the `deletedAt` semantics identical is what keeps reviews correct.
10. Daily "number" is positional (1-based over live notes of that JST day by createdAt, id) and changes when notes are trashed/restored; Go returns 400 for malformed date/number but the web parses the URL itself first (parseLogDate requires no leading zeros in URL, Go requires zero-padded), so web pages 404 before calling.
11. `?user=` semantics: Go answers member→403 and malformed→400; the web already resolves these to `redirect-self` before calling, so a Prisma port only needs `owner.kind === "other"` → admin-only, ownerId already validated by isOwnerId. Admin may view a nonexistent owner (empty results). Trash/export/writes always use the signed-in (or acted-as) owner.
12. POST /v1/batches, PATCH /v1/entries/{id}, GET /v1/entries/{id} have no web caller; they are documented in docs-site/reference (entries) — porting is optional, deleting them removes them from the API.
13. Batch insert timestamps: entry i gets `now + i ms` so (createdAt,id) order follows input order (entries.go:323-326) — relevant if CSV (stage 3, still Go) and LINE notes must interleave correctly with Prisma-created ones; Prisma `@default(now())` is DB-side `CURRENT_TIMESTAMP` while Go passes app time.
14. Concurrency with Go still running (LINE, CSV import, demo reset write LearningEntry/Hint/ImportBatch): the same tables are written by both until stages 3/10; no locking beyond row-level UPDATE conditions; entry_reviews `lockOwnEntry` (FOR SHARE) in Go protects add/remove-review against a concurrent purge — a Prisma purge running a plain DELETE still conflicts correctly (DELETE waits on FOR SHARE).
15. Error surface on the web changes from Go JSON errors to direct results: the controllers' `attemptGoAction` / `loadOr` / `found` (404→false/null) mapping must be preserved (e.g. home shows the generic alert on DB failure; detail page 404 → notFound()).
