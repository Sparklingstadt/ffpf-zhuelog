# 段階 4 の参照：Go の復習の今の動き（2026-11-16 時点）

All Go paths relative to `services/api/`. `fsrs/` means the library `github.com/open-spaced-repetition/go-fsrs/v4@v4.0.0` (go.mod:8; read it under `$(go env GOMODCACHE)/github.com/open-spaced-repetition/go-fsrs/v4@v4.0.0/`). Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage4-review.md.

## 0. Routes, roles, act-as, demo

Registered in `reviewRoutes` router.go:333-345, only when `Deps.Reviews != nil` (main.go:171 `Reviews: db`):

| Route                            | Handler (review_handlers.go)   | Store                                                                           |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `GET /v1/reviews/due?limit=`     | `listDueReviews` :125-184      | `CountDueReviewItemsByKind`, `ListDueReviewItems`, `ReviewStreak`, `ReviewDays` |
| `GET /v1/reviews/count`          | `countDueReviews` :188-200     | `CountDueReviewItems`                                                           |
| `GET /v1/reviews/entries`        | `listEntriesInReview` :204-216 | `EntryIDsInReview`                                                              |
| `POST /v1/reviews/{itemId}`      | `answerReview` :220-247        | `RecordReview`                                                                  |
| `GET /v1/entries/{id}/review`    | `entryReviewStatus` :250-266   | `EntryInReview`                                                                 |
| `PUT /v1/entries/{id}/review`    | `addEntryReview` :270-282      | `AddEntryReview`                                                                |
| `DELETE /v1/entries/{id}/review` | `removeEntryReview` :286-298   | `RemoveEntryReview`                                                             |

- All are `private` (router.go:216-223): `requireAuth` (no/invalid token 401; guest 403 forbidden 「このアカウントは利用できません。」, middleware.go:155-158) + `rejectUserParam` (`?user=` → 400).
- **Act-as honoured** on every route (no `notActing`): an admin acting as a member reads, answers and toggles the **member's** queue (`Principal.OwnerID` = member; TestActAsWritesGoToTheMember act_as_test.go:33 uses `DELETE /v1/entries/e1/review`).
- **Demo allowed** (none is `notForDemo`; demo_test.go:102-112 checks the demo reads `/v1/reviews/due`). The demo answers and toggles its own (shared) queue; the nightly demo reset rebuilds it (§7).
- No AI, no rate limit, no AiUsage.

## 1. FSRS (review/review.go + the library)

`review.Next(c, r, now)` (review.go:61-70) = `fsrs.NewFSRS(fsrs.DefaultParam()).Next(toFSRS(c), now, r)` → `fromFSRS(info.Card)`. `NextDues(c, now)` (:75-85) = `Next` for ratings 1..4, returning only `.Due`. `NewCard(now)` (:52-54) = `{Due: now, State: New}`, all else 0, LastReview zero. `toFSRS` clamps negative ScheduledDays/Reps/Lapses to 0 (:87-99).

**Parameters** (fsrs/parameters.go:40-53, weights.go:12-36): `RequestRetention 0.9`, `MaximumInterval 36500`, `EnableShortTerm true` (→ the _basic_ scheduler, scheduler.go:97-103; the long-term scheduler is never used), **`EnableFuzz false`**, `LearningSteps [1, 10]` minutes, `RelearningSteps [10]` minutes, weights W[0..20] =
`0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542`.
`NewFSRS` clips W to ranges (parameters.go:99-143) — every default is already inside its range (w17/w18 ceiling 2.0 with one relearning step; w19 min 0.01), so clipping changes nothing. `decay = -W[20] = -0.1542`, `factor = 0.9^(1/decay) - 1` (arithmetic.go:33-46).

**Randomness: none.** Fuzz is off, so `nextInterval` returns before `applyFuzz` (arithmetic.go:60-69). `Scheduler.initSeed` (scheduler.go:53-58) still builds a seed string (`"<now ms>_<reps>_<D*S %f>"`) but nothing reads it. Results depend only on the card and `now` → a port can match Go exactly; tests pin `now`.

**Formulas** (arithmetic.go; `r` = rating 1..4; constrainS = clamp [0.001, 36500], constrainD = clamp [1, 10]):

- `initStability(r) = min(max(W[r-1], 0.1), 36500)` → 0.212 / 1.2931 / 2.3065 / 8.2956
- `initDifficulty(r) = W[4] - exp(W[5]·(r-1)) + 1` (constrainD applied by callers)
- `nextDifficulty(d, r) = constrainD(W[7]·initDifficulty(4) + (1-W[7])·(d + (10-d)·(-W[6]·(r-3))/9))`
- `shortTermStability(s, r)`: `s = constrainS(s)`; `sinc = exp(W[17]·(r-3+W[18])) · s^(-W[19])`; if `r >= 2 && sinc < 1` then `sinc = 1`; `constrainS(s·sinc)`
- `forgettingCurve(t, s) = (1 + factor·t/constrainS(s))^decay`
- `nextRecallStability(d, s, R, r) = constrainS(s·(1 + e^W[8]·(11-d)·s^(-W[9])·(e^((1-R)·W[10]) - 1)·(r==2 ? W[15] : 1)·(r==4 ? W[16] : 1)))`
- `nextForgetStability(d, s, R) = constrainS(min(W[11]·d^(-W[12])·((s+1)^W[13] - 1)·e^((1-R)·W[14]), s / e^(W[17]·W[18])))`
- `nextInterval(s) = max(min(round(constrainS(s)/factor·(0.9^(1/decay) - 1)), 36500), 1)` days (`math.Round`, half away from zero; all values positive so JS `Math.round` agrees)

**Elapsed days** (scheduler.go:119-124, steps.go:8-18): 0 if the card is New or has no LastReview; else the difference of the **UTC calendar dates** of LastReview and now (not JST, not 24 h blocks), floored, never negative.

**Every answer** (scheduler.go:77-95): `next = card` with `Reps + 1`, `LastReview = now`. Then by the card's **current state** (scheduler_basic.go):

- **New** (:42-86): `D = constrainD(initDifficulty(r))`, `S = initStability(r)`.
  Again → RemainingSteps 2, due now+1 min, Learning. Hard → RemainingSteps 2, due now+round((1+10)/2)=6 min, Learning. Good → RemainingSteps 1, due now+10 min (`goodDelayMinutes` steps.go:52-58: index `len - remaining + 1`), Learning. Easy → graduate.
- **Learning / Relearning** (:98-156): `D = nextDifficulty(last D, r)`; `S` = elapsed 0 ? `shortTermStability(last S, r)` : (r==1 ? `nextForgetStability` : `nextRecallStability`) with `R = forgettingCurve(elapsed, last S)`. Steps = Learning [1,10] or, for Relearning, [10]; `remaining = card.RemainingSteps`.
  Again → if no steps or remaining ≤ 0 graduate, else RemainingSteps = len(steps), due +steps[0] min. Hard → if no steps or remaining ≤ 0 graduate, else due + hardDelay (two+ steps: round((s0+s1)/2) = 6; one step: round(s0·1.5) = 15), RemainingSteps unchanged. Good → if `len - remaining + 1` is a valid index: RemainingSteps − 1, due + that step; else graduate. Easy → graduate. State stays Learning/Relearning.
- **Review** (:158-232): elapsed 0 → each rating's `D = nextDifficulty`, `S = shortTermStability`; else `R = forgettingCurve(elapsed, S)` and `nextDs` (scheduler.go:105-117). Again → RemainingSteps 1, due +10 min, **Relearning**, `Lapses + 1`. Others: `hard = min(nextInterval(S_hard), nextInterval(S_good))`; `good = max(nextInterval(S_good), hard + 1)`; `easy = max(nextInterval(S_easy), good + 1)`; due = now + days, ScheduledDays = days, Review, RemainingSteps 0.
- **graduate** (:34-40): `ScheduledDays = nextInterval(S)`, due = now + that many days (×24 h, capped 36500), Review, RemainingSteps 0.
- `applyStep` (:23-32): due = now + minutes; ScheduledDays 0 and the given state (a step ≥ 1440 min would make it Review — never with these steps).

**Errors** (fsrs/fsrs.go:50-62, validate.go): rating outside 1..4; state outside 0..3; a non-New card with S < 0.001, D < 1 or non-finite; LastReview after now; a result with S < 0.001 or D < 1. `review.Next` wraps them (`review: …`).

Go tests (review/review_test.go, all relational, no golden values): `TestNewCardIsDueAtOnce`, `TestFirstAnswerSchedulesByRating` (Again < Good, Hard ≤ Good < Easy, Reps 1, LastReview set), `TestGoodAnswersSpreadTheReviews` (after graduating, 4 more Good answers at due grow the gap each time, last ≥ 7 days), `TestAgainOnAReviewCardIsALapse` (Lapses + 1, Relearning, due < 24 h, before Good's), `TestNextRejectsInvalidInput` (ratings 0, 5, −1; now before LastReview), `TestNextDuesMatchesEachAnswer` (monotone).

## 2. The DB rows

`ReviewItem` (prisma/schema.prisma:250-271): `id` ("c"+24 a-z0-9), `ownerId`, `language` ("zh"), `kind`, `targetId`, `due`, `stability`, `difficulty` (Float, default 0), `scheduledDays`, `reps`, `lapses`, `state`, `remainingSteps` (Int, default 0), `lastReview?`, `createdAt`, `updatedAt` (`@updatedAt` — Go always sets it itself). Unique `(ownerId, language, kind, targetId)`; index `(ownerId, due)`. **No FK to the note or word.**
`ReviewLog` (:277-292): `id` (the client's UUID), `ownerId`, `itemId` (FK, **onDelete Cascade**), `rating`, `state`, `due`, `stability`, `difficulty`, `scheduledDays`, `reviewedAt`. All timestamps are `TIMESTAMP(3)` holding UTC; Go writes `dbTime` (UTC, truncated to ms, store/entries.go:63-66).

Kinds (`targetId`): `entry` (note id; store/entry_reviews.go:19), `vocabulary` (word id; store/vocabulary.go:12), `preposition` (`"<use id>:<noun>"`, review_handlers.go:48-56), `complement` (question id, e.g. `result-01`, `verb:C005:看`; :60-68). Who creates them:

- `entry`: `PUT /v1/entries/{id}/review` (§4).
- `vocabulary`: **the web** since stage 1 (`src/infrastructure/prisma/vocabulary-store.ts:132-147`, `createMany` + `skipDuplicates`, state 0, due = createdAt = updatedAt = save time); deleting a word deletes its item (:200-210).
- `preposition`/`complement`: **Go**, `PUT /v1/preposition-records/{id}` and `PUT /v1/complement-records/{id}` (router.go:325,330) → `queueReviews` (review_handlers.go:73-79) → `EnqueueReviewItems` (store/review_items.go:61-84) for each question with an id and ≥1 miss. One tx; per target `INSERT … ON CONFLICT (ownerId, language, kind, targetId) DO UPDATE SET due = now, updatedAt = now WHERE "ReviewItem"."due" > now` (new → state 0 due now; already queued for later → brought forward to now, FSRS state kept; already due → untouched). A queue failure fails the save (practice_handlers.go:229-238). **Stays in Go until stage 5.**
- Demo reset writes items and logs for the demo (store/demo.go:136,148,200-225; history built with `review.Next`, demo/demo.go:151,242-256). **Stays in Go until stage 10.**
- Purging notes (web, stage 2): `learning-note-writes.ts:43-75` deletes the `entry` items of the purged ids in the same transaction (`reviewItemsToDelete`, kind `entry` only).

## 3. Reading the queue

`notTrashedEntry(kindParam)` (store/entry_reviews.go:28-32), used by every due read and by LINE (§7):
`NOT EXISTS (SELECT 1 FROM "LearningEntry" e WHERE "ReviewItem"."kind" = 'entry' AND e."id" = "ReviewItem"."targetId" AND e."ownerId" = "ReviewItem"."ownerId" AND e."deletedAt" IS NOT NULL)`
→ an `entry` item is hidden while its note is in the trash and comes back on restore (card unchanged). An item whose note/word **no longer exists** is still counted and listed (orphan).

- **Due** = `"ownerId" = owner AND "due" <= now AND notTrashedEntry` (`now` = request time, ms).
- `CountDueReviewItems` (review_items.go:201-210) → `count(*)`.
- `CountDueReviewItemsByKind` (:215-233) → `GROUP BY "kind"`; kinds with 0 absent.
- `ListDueReviewItems(owner, now, limit)` (:90-143): one **REPEATABLE READ, READ ONLY** transaction. `ORDER BY "due", "id" LIMIT limit` (id by DB collation). Then, in the same snapshot, `vocabularyByID` (vocabulary.go:41-59: owner's `VocabularyEntry` rows by id) and `entriesByID` (entry_reviews.go:142-163: owner's notes **with `deletedAt IS NULL`**, with hints by position). Missing target → the item has no `vocabulary`/`entry` (TestAnEntryItemWithoutItsNoteIsListedBare entry_reviews_test.go:186).
- `ReviewStreak(owner, now)` (:149-197): `today` = JST date of now. `SELECT DISTINCT ("reviewedAt" + interval '9 hours')::date` (`jstDay`, store/daily.go:12-14) `FROM "ReviewLog" WHERE ownerId AND "reviewedAt" > <JST midnight of today − 400 days, as UTC> ORDER BY day DESC`. `streakFrom` (:174-197): 0 if none; the newest day must be today or yesterday (else 0); then count consecutive days back. Tests: `TestReviewStreakCountsDaysInJapanTime` (:153: answers 2026-10-18 03:00Z, 18 15:10Z (= Oct 19 00:10 JST), 20 01:00Z; at 2026-10-20 14:30Z (23:30 JST) → 3; +2 h (Oct 21 JST) → 3; +26 h (Oct 22) → 0), `TestStreakFrom` (:191, table).
- `ReviewDays(owner, now, 7)` (:237-259): `first` = JST midnight of (today − 6); distinct JST days of `"reviewedAt" >= first`; `out[i]` true for day `first + i`, i in 0..6 (later days ignored); oldest first, last = today. Test `TestReviewDaysSaysWhichOfTheLastDaysHadAReview` (:235).
- `EntryIDsInReview` (entry_reviews.go:54-69): `targetId`s of `entry` items JOINed to the owner's **live** notes, `ORDER BY targetId`.
- `EntryInReview` (:37-50): one query; note must be the owner's and live, else ErrNotFound (→ 404); else whether an `entry` item exists.

## 4. Writing

- `RecordReview(owner, itemId, logId, rating, now)` (review_items.go:266-321), one tx, `now = dbTime(now)`:
  1. `SELECT <item> WHERE id AND ownerId FOR UPDATE` (concurrent answers and retries take turns); none → ErrNotFound.
  2. `SELECT "itemId","ownerId" FROM "ReviewLog" WHERE id = logId`: found for **this** item and owner → return the item as it stands (**retry applied once**); found for another item/owner → ErrNotFound.
  3. `review.Next(card, rating, now)` (error → 500).
  4. `INSERT "ReviewLog"` (id logId, ownerId, itemId, rating, and the card **before** the answer: `state`, `due`, `stability`, `difficulty`, `scheduledDays`; `reviewedAt` now).
  5. `UPDATE "ReviewItem"` due, stability, difficulty, scheduledDays, reps, lapses, state, remainingSteps, lastReview (= now), `updatedAt = now` `WHERE id AND ownerId RETURNING …`.
     Test `TestRecordReviewReschedulesLogsAndIsRetryable` (review_items_test.go:64: retry 1 min later changes nothing, 1 log with rating 3 / state 0; other owner → NotFound; unknown id → NotFound; rating 5 → error not NotFound; deleting the item cascades its log).
- `AddEntryReview(owner, id, now)` (entry_reviews.go:74-94): tx; `lockOwnEntry` (:119-127: `SELECT 1 FROM "LearningEntry" WHERE id AND ownerId AND "deletedAt" IS NULL FOR SHARE`, none → NotFound) — the note cannot be trashed/purged until commit, so no item is left behind; `INSERT ReviewItem (id newID, owner, 'zh', 'entry', id, due now, state 0, createdAt = updatedAt = now) ON CONFLICT DO NOTHING` (already in → card kept).
- `RemoveEntryReview(owner, id)` (:99-113): tx; `lockOwnEntry`; `DELETE FROM "ReviewItem" WHERE ownerId AND kind 'entry' AND targetId = ANY(ids)` (logs cascade). Not in review → still success.
- Store tests: entry_reviews_test.go `TestAddEntryReviewAddsOnceAndRemoveTakesTheCard` :27, `TestEntryReviewIsOnlyForTheOwnersNotesOutOfTheTrash` :98, `TestATrashedNoteLeavesTheReviewUntilRestored` :133, `TestAnEntryItemWithoutItsNoteIsListedBare` :186, `TestEntryIDsInReviewLeavesOutTheTrash` :204; review_items_test.go `TestEnqueueReviewItemsAddsEachTargetOnce` :27, `TestEnqueueBringsAMissedItemForward` :122, `TestCountDueReviewItemsByKind` :212; review_orphans_test.go `TestRemoveEntryReviewLeavesNoOrphanLog` :80.

## 5. Validation, responses, messages

- `GET /v1/reviews/due`: `limit` default 20, must parse as int in 1..100 (`reviewDueDefaultLimit`/`reviewDueMaxLimit` :37-38), else 400 invalid_request 「復習の回答の形式が不正です。」 (`msgReviewInvalid` respond.go:58). Order of calls: byKind → list → streak → days (separate statements; `count` = **sum of byKind**, not the list's snapshot). 200 `{"count","byKind":{kind:n},"streakDays","recentDays":[7 bools],"items":[item]}`; each item gets `nextDue` = `NextDues(card, now)` formatted, **omitted** if FSRS errors (:171-180).
- item JSON (`toReviewItemJSON` :81-118): `id, language, kind, targetId, due, state, reps, lapses, lastReview` (null if never), `vocabulary` (vocabulary_json.go: id, language, word, pinyin, meaning, sourceEntryId, createdAt, updatedAt) or `entry` (entryJSON incl. hints) only when found, `nextDue` only in the due list. Times `YYYY-MM-DDTHH:MM:SS.sssZ` (truncated, entry_handlers.go:34).
- `GET /v1/reviews/count` → `{"count":n}`; `GET /v1/reviews/entries` → `{"entryIds":[…]}`.
- `POST /v1/reviews/{itemId}`: itemId must be `c` + 24 `[a-z0-9]` (`validReviewItemID` :301-311) else 404 not_found 「復習する問題が見つかりません。」 (`msgReviewNotFound` respond.go:59); body `{"logId","rating"}` strict JSON (unknown fields, trailing data → 400 generic body errors); `logId` must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (respond.go:173) and rating 1..4, else 400 「復習の回答の形式が不正です。」; ErrNotFound → 404 「復習する問題が見つかりません。」; other errors 500. 200 = the item JSON (no nextDue).
- `/v1/entries/{id}/review`: id `validID` (non-empty, ≤128 bytes, UTF-8, no NUL; validate.go:20) else 404; NotFound → 404 「見つかりません。」 (generic); GET 200 `{"inReview"}`, PUT/DELETE 204.
- Handler tests (httpapi/review_handlers_test.go): `TestSavingARoundQueuesItsMissedQuestions` :129, `TestSavingARoundFailsWhenTheQueueFails` :160 (practice — stay), `TestReviewRoutesRejectGuests` :170, `TestListDueReviews` :180, `TestAnswerReview` :222, `TestReviewRoutesNeedTheQueue` :253, `TestEntryReviewRoutes` :260, `TestEntryReviewRoutesNeedTheQueue` :305, `TestDueEntryItemsCarryTheirNote` :312, `TestListDueReviewsSaysByKindTheRecentDaysAndWhenEachAnswerBringsItBack` :346, `TestCountDueReviewsAndEntriesInReview` :383.

## 6. The web today

- Domain `src/domain/review/review-item.ts`: `ReviewItem` (`nextDue` tuple or null), `DueReviews`, `REVIEW_RATINGS` (1 もう一度, 2 難しい, 3 できた, 4 簡単), `isReviewRating`.
- Gateway `src/infrastructure/go-api/review-gateway.ts` (`listDue(limit)`, `countDue`, `entriesInReview` → Set, `answer`); container `src/composition/review-container.ts` (`reviews`). Learning gateway `src/infrastructure/go-api/learning-gateway.ts` (`isInReview` → null on 404; `setInReview` → false on 404) wired in `src/composition/learning-container.ts:26-36` — the last Go use there.
- `/review` (`src/app/review/page.tsx`): signed out → `/signin?callbackUrl=/review`; not admin/member → `/`; `listDue(20)` via `loadOr("REVIEWS_UNAVAILABLE")` (failure → generic Alert); `toCards` (:43-65) skips vocabulary/entry items without their target and unknown practice ids (`reviewChoice`); `remaining = count − items.length`; button labels from `formatInterval(new Date(), nextDue[i])`.
- Home (`src/app/page.tsx:62-85`, only for the own queue of a member/admin): `listDue(1)` → `ReviewDueCard` (count, streak, byKind, 7 days; `loadOr("REVIEW_COUNT_UNAVAILABLE")` → card hidden); `entriesInReview()` → 復習に入れる／復習から外す per note (`NOTES_IN_REVIEW_UNAVAILABLE` → no buttons).
- Note page `src/app/logs/[year]/[month]/[day]/[number]/page.tsx:50-55,106-109`: `isInReview` for the own note of a member/admin (`NOTE_REVIEW_UNAVAILABLE` → control hidden); 「今日の復習に入っています」.
- Badge `src/app/api/review-count/route.ts`: `{count}` (null for guests/failure), `no-store`; client `review-count-badge.tsx` fetches it.
- Answer action `src/presentation/actions/review-actions.ts`: viewer not admin/member → `accountForbiddenMessage`; zod `{itemId: min 1, logId: z.uuid(), rating 1..4}` fail → 「復習の回答の形式が不正です。」; `attemptGoResult("REVIEW_ANSWER_FAILED", …, {notFound: "この問題は復習の一覧にありません。"})`; no revalidate. Client `use-review-session.ts:47,71-84` keeps one `crypto.randomUUID()` per card until it succeeds (so a retry reuses it) and shows 「回答を保存できませんでした。もう一度お試しください。」 on a thrown call, else the result's message.
- Toggle action `note-review-actions.ts` + controller `note-review-controller.ts`: `getMember` null / not member role → `actionUnauthorized`; bad `id` (`noteIdSchema`) or `inReview` not "true"/"false" → 「見つかりませんでした。画面を更新してください。」; `run` false → same; `attemptGoAction("NOTE_REVIEW_FAILED")`; success → `revalidateNotes()`, `/review`, `/`.
- Presenters: `review-schedule-presenter.ts` (`formatInterval`, `formatNextReview`, recent days, by-kind groups) — no Go.

Web unit tests: `tests/go-api-review-gateway.test.ts` (7), `tests/go-api-learning-gateway.test.ts` (3, all review), `tests/note-review-controller.test.ts` (4), `tests/review-schedule-presenter.test.ts`, `tests/review-question.test.ts`, `tests/learning-note-writes.test.ts` (`reviewItemsToDelete`).

E2E: `e2e/review.spec.ts` (:42 preposition misses → review, answer 簡単 → ReviewLog `{rating 4, state 0, reps 1}`, streak 1; :126 verb complements; :198 add a word mid-session; :252 guests), `e2e/note-review.spec.ts` (:11 put in → card → 4 → take out, DB 0 items; :56 trash hides / restore shows; :82 Space rates できた, log rating 3; :114 purge deletes cards), `e2e/review-schedule.spec.ts:7` (badge 2, by-kind, 7 days, next dates), `e2e/aspect-particles.spec.ts:38`, `e2e/complements.spec.ts:39`, `e2e/vocabulary.spec.ts:38-62`, `e2e/demo.spec.ts:42` (demo has due reviews), `e2e/study-log.spec.ts:8` (ReviewLog days), `e2e/bottom-navigation.spec.ts:68`.
Gaps: act-as reviewing; the demo answering; a retried answer (same logId) applied once; an orphan item (counted, not shown); the badge/count leaving out trashed notes; `limit`.

## 7. What other Go code still uses (keep)

- **Practice → queue (stage 5):** `Deps.Reviews` (router.go:109-111, main.go:171), `queueReviews`, `prepositionReviewTargets`, `complementReviewTargets`, `reviewLanguageChinese`/`reviewKindPreposition`/`reviewKindComplement` (review_handlers.go:31-79), `practice_handlers.go:54,69,92,229-238`; store `ReviewTarget`, `EnqueueReviewItems` and its 2 tests.
- **LINE review notify (stage 10):** `store/line_review_notify.go:58-87` `ListReviewNotifyTargets` counts due items per linked owner with `notTrashedEntry` + `ReviewKindEntry`; `ClaimReviewNotify`; `LineReviewNotify`/`SetLineReviewNotify`; the drain cron pushes 「今日の復習が N 問あります。…」 (line/format.go:86). Its count must keep matching the web's count.
- **Demo reset (stage 10):** `review` package (`NewCard`, `Next`, `Card`, `Rating`), store/demo.go (`entryReviewLanguage`, `ReviewKindEntry`, `ReviewKindVocabulary`, `queueDemoReview`, deletes ReviewLog/ReviewItem).
- **Study log (stage 8):** store/study_log.go:26-27 counts ReviewLog per `jstDay("reviewedAt")`.
- `dbTime`, `jstDay`, `jst.Location`, `newID`, `validUUID` (chat, questions, practice), `toEntryJSON`/`entryJSON` (timeline), `attachHints`/`scanEntries`/`entryPtrs` (follows).
- Go **test helpers** that call the dying store methods: `demo/demo_db_test.go:56` (ListDueReviewItems), `store/vocabulary_test.go:60-68` (`TestDueVocabularyCarriesItsWord`), `store/review_orphans_test.go:46-66` (ListDue/RecordReview/AddEntryReview in helpers), `store/demo_test.go:103`, `store/study_log_test.go:37-38`; `httpapi/act_as_test.go:33-51` and `demo_test.go:102-112` route through review URLs; `fakeReviews` (review_handlers_test.go:20) is used by router_test.go:27,62,135, demo_test.go:47,102, act_as_test.go:34.

## 8. Becomes dead when the web owns reviews

- Go: the 7 routes (router.go:340-344) and their handlers, `reviewItemJSON`/`toReviewItemJSON`, `validReviewItemID`, `reviewDue*Limit`, `reviewRecentDays`; `httpapi/vocabulary_json.go` (only review items use it); `msgReviewInvalid`/`msgReviewNotFound` (respond.go:58-59); store `ReviewItem`, `reviewItemColumns`, `scanReviewItem`, `ListDueReviewItems`, `ReviewStreak`, `reviewStreakMaxDays`, `dateOnly`, `streakFrom`, `CountDueReviewItems`, `CountDueReviewItemsByKind`, `ReviewDays`, `RecordReview`, `EntryInReview`, `EntryIDsInReview`, `AddEntryReview`, `RemoveEntryReview`, `lockOwnEntry`, `deleteEntryReviews`, `entriesByID`, `vocabularyByID`/`scanVocabulary`/`vocabularyColumns` (check `VocabularyEntry` users in tests), and their tests (§4, §5 except the two practice tests and the Enqueue tests). `review.NextDues` + `TestNextDuesMatchesEachAnswer` (only the due list uses it).
- Web: `src/infrastructure/go-api/review-gateway.ts` + test, `learning-gateway.ts` (whole file) + test, the Go comments in review-item.ts / review-actions.ts / note-review-*.
- Docs: `docs-site/reference/reviews.md`, its nav entry (`docs-site/.vuepress/config.ts:36`), README rows (`docs-site/reference/README.md:41-47`), links to `reviews.md` in `reference/practice.md:10` and `reference/study-log.md:32`, the `/v1/reviews/count` example in `operations/local.md:58`.
