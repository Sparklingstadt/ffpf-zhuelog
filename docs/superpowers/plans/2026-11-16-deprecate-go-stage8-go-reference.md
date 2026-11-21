# 段階 8 の参照：Go の学習ログと AI の利用量の今の動き（2026-11-17 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage8-study-log.md. Stages 1–7 are merged into this branch: the web already writes every `AiUsage` row except LINE's (`recordAiUsage` in `src/infrastructure/prisma/ai-usage-store.ts`) and reads Japan dates of review answers with the same `+ interval '9 hours'` SQL (`reviewedDates` in `src/infrastructure/prisma/review-store.ts:270-281`). Both routes of this stage are **reads only**.

## 0. Routes, roles, act-as, demo

| Route                    | Registered                                         | Wrapper                                    | Handler                                    |
| ------------------------ | -------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `GET /v1/study-log`      | only when `Deps.StudyLog != nil` router.go:291-296 | `private`                                  | `listStudyLog` study_log_handlers.go:49-84 |
| `GET /v1/admin/ai-usage` | only when `Deps.AIUsage != nil` router.go:286-288  | `adminOnly` (= `private` + `requireAdmin`) | `aiUsageMonth` ai_usage_handlers.go:42-77  |

- `Deps.StudyLog` and `Deps.AIUsage` are `db` **always** in production (main.go:168-169); comments router.go:94-98. `newMux` calls `r.studyLogRoutes()` at router.go:153; `adminRoutes` (router.go:279-289, comment "and, when recorded, the AI usage summary").
- `private` (router.go:193-201): `requireAuth` (middleware.go:143-166) then `rejectUserParam` (owner.go:11-22).
  - no/invalid token → **401** `unauthorized` 「認証が必要です。」;
  - **guest → 403** `forbidden` 「このアカウントは利用できません。」 (`TestStudyLogRejectsGuests` study_log_handlers_test.go:24-27);
  - `?user=` → **400** `invalid_request` 「リクエストが不正です。」.
- `requireAdmin` (admin_handlers.go:53-61): role ≠ admin → **403** `forbidden` 「管理者だけが利用できます。」 (`msgAdminOnly` respond.go:19; `TestAIUsageSummaryIsAdminOnly` ai_usage_handlers_test.go:26-31 for member and guest — the guest is already refused by `requireAuth`).
- **Act-as.** Both honour `X-Zhuelog-Act-As` (no `notActing`). `ActAs` keeps **`Role: RoleAdmin`** and sets `OwnerID` = the member, `ActorID` = the admin (auth/me.go:32-40; middleware.go:170-194). So:
  - the study log is the **member's** (`principalFrom(ctx).OwnerID` study_log_handlers.go:70);
  - an admin acting as a member still reads the AI usage summary (still admin). The summary is not owner-scoped at all.
- **Demo.** Neither route is `notForDemo`. The demo account is a member: it **reads its own study log**; it gets the admin-only 403 on the summary. Closed-route list demo_test.go:56-67 has neither route. `TestDemoKeepsItsOwnRecords` demo_test.go:96-122 uses `GET /v1/study-log` since stage 7 (decision 14 of stage 7) — it must be rewritten again (§7).
- Error envelope `{"error":{"code","message"}}` and `Cache-Control: no-store` on every answer (respond.go:82-104). A store error → `writeServiceError` (respond.go:113-…) → **500** `internal` 「サーバーでエラーが発生しました。」.

## 1. `GET /v1/study-log` (study_log_handlers.go)

Query `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both **JST** calendar dates, both included.

1. `parseLogDate` (:23-31): `time.Parse("2006-01-02", s)` **and** `t.Format(...) == s` (so zero-padded only: `2026-11-1` fails; `2026-11-31` fails as not a date) **and** year `2000..9999` (`minLogYear`/`maxLogYear` :18-21). Missing → `""` → fails.
2. Either fails → **400** `invalid_request` 「学習ログの期間が不正です。YYYY-MM-DD で、93日以内にしてください。」 (`msgStudyLogInvalid` respond.go:50).
3. Same 400 when `to < from`, or `to - from >= 93 days` (`maxStudyLogDays = 93` :37-39, :64-69): **93 days inclusive is the most** (`2026-01-01..2026-04-03` ok, `..04-04` no).
4. `StudyLog(ctx, OwnerID, from, to)`; 200 `{"days":[{"date":"YYYY-MM-DD","reviews","practiceQuestions","notes","words"}]}` (`studyDayJSON` :41-47, `formatLogDate` :33-35). `[]` when nothing (`make` :75).

- Tests `TestStudyLog` study_log_handlers_test.go:29-64: member, `from=2026-10-27&to=2026-12-06` → owner `testOwner`, dates passed through, one day `{2026-11-02, 5, 25, 1, 2}`; 93 days ok; `94 days`, `backwards`, `no from`, `not a date` (`2026-11-31`), `not padded` (`2026-11-1`) → 400.

### Store (store/study_log.go:20-61, store/daily.go)

- `LogDate.dayRange` (daily.go:21-26): `[start, end)` of a JST date = `time.Date(y, m, d, 0,0,0,0, jst.Location)` and the next day's midnight, as UTC DB times (`dbTime`). The query uses `start` of `from` and `end` of `to`.
- `jstDay(col)` (daily.go:9-14) = `(col + interval '9 hours')::date` — the columns are `TIMESTAMP(3)` **without** time zone holding UTC, so 9 hours are added rather than `AT TIME ZONE` (same as the web's `reviewedDates`).
- One statement (study_log.go:25-40):

  ```sql
  SELECT "day", sum("reviews"), sum("practice"), sum("notes"), sum("words") FROM (
    SELECT (…"reviewedAt"…)::date AS "day", 1 AS "reviews", 0 AS "practice", 0 AS "notes", 0 AS "words"
    FROM "ReviewLog" WHERE "ownerId" = $1 AND "reviewedAt" >= $2 AND "reviewedAt" < $3
    UNION ALL
    SELECT (…"createdAt"…)::date, 0, "questionCount", 0, 0
    FROM "PrepositionPracticeRecord" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
    UNION ALL
    SELECT (…"createdAt"…)::date, 0, "questionCount", 0, 0
    FROM "ComplementPracticeRecord" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
    UNION ALL
    SELECT (…"createdAt"…)::date, 0, 0, 1, 0
    FROM "LearningEntry" WHERE "ownerId" = $1 AND "deletedAt" IS NULL AND "createdAt" >= $2 AND "createdAt" < $3
    UNION ALL
    SELECT (…"createdAt"…)::date, 0, 0, 0, 1
    FROM "VocabularyEntry" WHERE "ownerId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
  ) AS "activity" GROUP BY "day" ORDER BY "day"
  ```

  - `reviews` = answers in `ReviewLog` (one per answer, any kind, any rating);
  - `practiceQuestions` = **sum of `questionCount`** of preposition and complement rounds (not the number of rounds);
  - `notes` = learning notes **not in the trash now** (`deletedAt IS NULL`), by `createdAt` — a note trashed later disappears from its day; restoring brings it back;
  - `words` = vocabulary entries by `createdAt` (a deleted word is gone, no soft delete);
  - quick questions, conversations, AI usage, imports as batches and LINE messages are **not** counted;
  - only days with at least one row; oldest first; sums scanned as `int64` (`bigint` in Postgres).

- Indexes that serve it: `ReviewLog @@index([ownerId, reviewedAt])`, the two practice tables, `LearningEntry` and `VocabularyEntry` `@@index([ownerId, createdAt])` (prisma/schema.prisma:207,239,291,34,312).
- `TestStudyLogCountsEachKindByJapanDay` store/study_log_test.go:11-58: Nov 1 10:00 JST and Nov 2 00:30 JST (= Nov 1 15:30 UTC); 2 notes Nov 1, 2 notes Nov 2 of which one trashed; a preposition round of 3 questions Nov 1; a complement round of 2 Nov 2; a word Nov 2; an answer Nov 2; another owner's 3 notes Nov 1 → `[{11-01, practice 3, notes 2}, {11-02, reviews 1, practice 2, notes 1, words 1}]`; `11-02..11-02` → only Nov 2; `11-03..11-30` → `[]`.

## 2. `GET /v1/admin/ai-usage` (ai_usage_handlers.go)

1. `parseMonth(r.URL.Query().Get("month"), now())` (:22-40): `""` → the **JST month of now** (`now.In(jst.Location)`); else `^(\d{4})-(\d{2})$`, year ≥ **2000**, month **1..12** (upper year 9999 by the 4 digits).
2. Fails → **400** `invalid_request` 「月は YYYY-MM の形で指定してください。」 (`msgInvalidMonth` respond.go:22). `TestAIUsageSummaryRejectsABadMonth` :71-76: `2026-13`, `2026-00`, `2026-1`, `202611`, `1999-12`, `x`.
3. `AIUsageMonth(year, month)`; 200 `{"month":"YYYY-MM","totals":[{"ownerId","displayName","feature","model","requests","inputTokens","outputTokens"}]}` (:44-56, `twoDigits` :79-84). `[]` when none.

- Tests: `TestAIUsageSummaryOfAMonth` :38-57 (exact JSON for one `line` row of `password:a`/花子); `TestAIUsageSummaryDefaultsToTheJSTMonth` :59-69 (`2026-10-31T15:00Z` → `2026-11`, `"totals":[]`); `TestAIUsageSummaryRouteNeedsTheStore` :33-36 (no store → 404).

### Store (store/ai_usage.go:45-80)

- Range: `[time.Date(y, m, 1, JST), time.Date(y, m+1, 1, JST))` as UTC (`m+1` = 13 rolls into January). `"createdAt" >= $1 AND < $2`.
- One statement:

  ```sql
  SELECT u."ownerId", coalesce(m."displayName", ''), u."feature", u."model",
         count(*), sum(u."inputTokens"), sum(u."outputTokens"),
         sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") AS "ownerTokens"
  FROM "AiUsage" u
  LEFT JOIN (SELECT $3 || p."id" AS "ownerId", p."displayName", p."createdAt" FROM "PasswordAccount" p
             UNION ALL
             SELECT $4 || f."id", f."displayName", f."createdAt" FROM "FfpfAccount" f) m
         ON m."ownerId" = u."ownerId"
  WHERE u."createdAt" >= $1 AND u."createdAt" < $2
  GROUP BY u."ownerId", m."displayName", u."feature", u."model"
  ORDER BY "ownerTokens" DESC, u."ownerId", u."feature", u."model"
  ```

  with `$3 = "password:"`, `$4 = "ffpf:"` (`memberAccounts` store/follows.go:32-40, also used by `ListMembers`; `MemberOwnerPrefix`/`FfpfOwnerPrefix` store/accounts.go:18,25).
  - `displayName` = the member's name, `""` for an admin (GitHub id owners have no account row) or a deleted account;
  - rows grouped by owner, feature and model; **owners with the most tokens (input + output, whole month) first**, ties by `ownerId`, then each owner's rows by `feature`, `model` (the database's default collation);
  - all features and owners, nothing scoped to the caller. `ownerTokens` is read and dropped (:68-70).

- `TestAIUsageMonthAddsUpByOwnerFeatureAndModel` store/ai_usage_test.go:32-80: Nov 2026 JST = `2026-10-31T15:00Z` .. `2026-11-30T15:00Z`; member `line` 100/50 at the first instant + 200/60 at the last millisecond, `chat` 10/5, `line` 9999/9999 one ms before and at the next month (left out); admin `github:<id>` `chat` 5000/1000 → `[admin chat 1 req 5000 (""), member chat gpt-5 1 req (name ≠ ""), member line 2 req 300/110]`; September → none of them.

### What writes the rows

- Web (stages 1, 6, 7): `vocabulary_draft`, `quick_question`, `chat` via `recordAiUsage` (`newId()` id, `now`), owner `actorId ?? githubId`.
- Go: `line` only — linebot/service.go:264-272 calls `Usage.RecordAIUsage` (store/ai_usage.go:33-43, type `AIUsage` :11-19) inside `aiusage.WithRecorder`; `fakeUsage.RecordAIUsage` linebot/fakes_test.go:354.

## 3. The web today

- `/study-log` (`src/app/study-log/page.tsx`):
  - `getCurrentViewerUser()`; none → `redirect("/signin?callbackUrl=/study-log")`; not admin/member (guest) → `redirect("/")`. Demo and acting admins pass.
  - `parseMonth(?month)` (`src/domain/study-log/study-log.ts:27-37`, year 2000..9999) else this JST month; `monthGrid` (Monday-first weeks, 4–6 weeks); asks for **the grid's first to last date** (≤ 42 days) — e.g. November 2026 → `2026-10-26..2026-12-06`.
  - `loadOr("STUDY_LOG_UNAVAILABLE", () => studyLog.list(from, to), null)`; `null` → `Alert` with `genericErrorMessage` 「処理できませんでした。時間をおいてもう一度お試しください。」 instead of the totals and calendar.
  - Totals count only the month's own days; the calendar shades every cell (`data-date`, `data-total`, `aria-label` `YYYY-MM-DD：復習N回・練習N問・ノートN件・単語N語` or `学習なし`, `study-calendar.tsx:23-33,74-82`).
  - Quirk: `?month=2000-01` asks from `1999-12-27` and `?month=9999-12` up to `10000-01-…`; Go answers 400 for both, so those two months show the alert.
- `studyLog` = `createStudyLogGateway()` (`src/composition/study-log-container.ts`; `src/infrastructure/go-api/study-log-gateway.ts`: `GET /v1/study-log?from&to` through `goApiAuthed` — act-as header while acting, a Go 401 redirects to sign-in). Type `StudyDay` `src/domain/study-log/study-log.ts:1-9` (comment "as the Go API counts it").
- `/admin/ai-usage` (`src/app/admin/ai-usage/page.tsx`):
  - `getCurrentAdminUser()` (role `admin`, acting included) else `redirect("/")`.
  - `?month` kept only if `isAiUsageMonth` (`src/domain/ai-usage/monthly-usage.ts:42-47`: `^(\d{4})-(0[1-9]|1[0-2])$`, year ≥ 2000 — the same set Go accepts), else `undefined` (Go's JST month). So Go's 400 is never reached from the page.
  - `aiUsage.month(month)` (`src/composition/identity-container.ts:37-38` → `src/infrastructure/go-api/ai-usage-gateway.ts`): Go 404 → `null`; other Go errors **throw** (no `loadOr`: the page fails).
  - `null` → 「利用量を読めませんでした。Go API が最新かを確認してください。」 (the Go part is wrong once the web reads the table itself). Else `summarizeAiUsage` (keeps the order it is given; `displayName ""` → 「管理者」), month links `shiftAiUsageMonth`, label `aiUsageFeatureLabel`, description 「この月は、まだ使われていません。」 or `N人が M 回使いました。` (`Intl.NumberFormat("ja-JP")`), table head 人・機能／回数／入力／出力, footer 合計.
- Navigation: 「学習ログ（カレンダー）」 `/study-log` and 「AI 利用量」 `/admin/ai-usage` (admin only) in `src/presentation/presenters/site-navigation.ts:174,220`; 「学習ログ」 link in `review-due-card.tsx:135`.
- Unit tests: `tests/go-api-study-log-gateway.test.ts` (1 test, dies); `tests/ai-usage.test.ts` (4 tests; the last, `the gateway asks Go for the month and treats 404 as no summary` :86-111, dies); `tests/study-log.test.ts` (3 domain tests, stay).
- E2E: `e2e/study-log.spec.ts:8` (a member adds a word today → 「学習した日1日」「単語1語」, the cell, month links), `:49` (guest → `/`). **No e2e opens `/admin/ai-usage`.** `e2e/act-as.spec.ts:64,100` and `chat.spec.ts:221`, `quick-question.spec.ts:217`, `vocabulary.spec.ts:113` read `AiUsage` rows by SQL only.
- **Gaps:** the JST day boundary; reviews, practice question counts and notes on the log; trashed notes left out; another owner's activity left out; the study log while acting; the demo's study log; anything on the AI usage page (order, sums, names, month boundary, member refused).

## 4. Docs that mention the two routes

- `docs-site/reference/study-log.md` (whole page), its nav entry `docs-site/.vuepress/config.ts:33`, `docs-site/reference/README.md:30` and `:34` (rows), `docs-site/reference/admin.md:3` (intro: 「と、AI の利用量を月ごとに見るルート」) and `:128-…` (section `GET /v1/admin/ai-usage` to the end of its error table).
- `docs-site/README.md:24` (「学習の記録」 in Go's list) and `:27` (「学習の記録などを扱えます」; the web's list lacks the study log and the AI usage summary).
- `docs-site/operations/local.md:58` and `docs/api-local.md:56` (`curl …/v1/study-log` example; the example signs in as the demo, so `/v1/members` on the next line answers 403 too).
- `docs/features.md:7` (who records; the summary is read from `/admin/ai-usage`), `docs/architecture.md:43` (what the web reads with Prisma), `docs/api-deployment.md` (new section after 「段階7（チャット）のマージの前と後」 :306-330), `README.md:33` (Go's list has 学習ログ).
- `docs/architecture.md:185` and `docs/job-hunting-roadmap.md` only name `/admin/ai-usage` (the web page; unchanged).

## 5. Go code the two routes use, and who else uses it

| Go code                                                                                                   | Other users                                               |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| httpapi/study_log_handlers.go (all)                                                                       | none                                                      |
| httpapi/ai_usage_handlers.go (all; imports `jst`)                                                         | none                                                      |
| store/study_log.go (all)                                                                                  | demo/demo_db_test.go:66-72 (checks the seed through it)   |
| store/daily.go (`jstDay`, `LogDate`, `dayRange`)                                                          | only study_log.go, study_log_handlers.go, demo_db_test.go |
| store/ai_usage.go `AIUsageTotal` :21-31, `AIUsageMonth` :45-80, `jst` import                              | ai_usage_test.go only                                     |
| store/ai_usage.go `AIUsage` :11-19, `RecordAIUsage` :33-43                                                | **linebot (LINE, stage 10)** — keep                       |
| store/follows.go `memberAccounts` :32-40                                                                  | `ListMembers` (stage 9) — keep                            |
| respond.go `msgInvalidMonth` :22, `msgStudyLogInvalid` :50                                                | none                                                      |
| router.go `Deps.StudyLog`/`AIUsage` :94-98, :153, :286-288, :291-296                                      | none                                                      |
| main.go:168-169                                                                                           | none                                                      |
| store/testhelpers_test.go `prepositionRecord` :281-293, `complementRecord` :295-308, `saveRound` :310-330 | only study_log_test.go                                    |

`jst` stays (demo/demo.go:224-225, store/line_review_notify.go:50, httpapi tests). `aiusage` stays (LINE).

## 6. Becomes dead when the web owns both

- Go: httpapi/study_log_handlers.go, httpapi/study_log_handlers_test.go, httpapi/ai_usage_handlers.go, httpapi/ai_usage_handlers_test.go, store/study_log.go, store/study_log_test.go, store/daily.go; store/ai_usage.go `AIUsageTotal` + `AIUsageMonth` + `jst` import; router.go `StudyLog`/`AIUsage` fields and comments, `r.studyLogRoutes()` and `studyLogRoutes`, the `AIUsage` branch of `adminRoutes` and its comment; respond.go `msgInvalidMonth`, `msgStudyLogInvalid`; main.go `StudyLog: db`, `AIUsage: db`; testhelpers `prepositionRecord`, `complementRecord`, `saveRound`.
- Web: `src/infrastructure/go-api/study-log-gateway.ts`, `src/infrastructure/go-api/ai-usage-gateway.ts`, `tests/go-api-study-log-gateway.test.ts`, the gateway test in `tests/ai-usage.test.ts` and its 3 imports, `aiUsage` in `src/composition/identity-container.ts`, the Go sentence on `/admin/ai-usage`.
- Docs: §4.

## 7. Go tests to rewrite

- `httpapi/demo_test.go`:
  - `allRoutesDeps` :41-48 — drop `StudyLog: &fakeStudyLog{}, AIUsage: &fakeAIUsage{}`.
  - `TestDemoKeepsItsOwnRecords` :96-122 — after stage 8 **no Go route returns the demo's own records** (what is left for a member: `/v1/me`, members, follows, timeline, LINE, password; all but `/v1/me` closed to the demo). Its second half (the member directory is closed to the demo, open to a normal member) still holds.
- `httpapi/router_test.go:24` — drop `AIUsage: &fakeAIUsage{}` (`TestNoRouteAcceptsUserParam`).
- `demo/demo_db_test.go:62-72` — `s.StudyLog(...)` over the last 8 JST days `len(days) >= 5` → count distinct JST days with SQL (`countRows` :76-90); the `jst` import then goes.
- `store/ai_usage_test.go` — `TestAIUsageMonthAddsUpByOwnerFeatureAndModel` reads through `AIUsageMonth`; what remains for Go is `RecordAIUsage` (LINE). Keep `aiUsageOwner` :9-16; `onlyOwners` :18-30 dies.

## 8. Production state

- No migration: `AiUsage` (migration `20261109090000_add_ai_usage`), the practice, review, note and vocabulary tables all exist.
- No new environment variable: the web reads the database since stage 0 (`DATABASE_URL`) and decides the admin itself (`AUTH_ALLOWED_GITHUB_IDS`).
- Until Go is redeployed from the merged main, the production Go keeps answering both routes; nothing calls them once the web is promoted.
