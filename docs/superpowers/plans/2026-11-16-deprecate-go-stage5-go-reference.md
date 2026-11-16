# 段階 5 の参照：Go の練習の記録の今の動き（2026-11-16 時点）

All Go paths relative to `services/api/`. Web paths relative to repo root. Written as the reference for docs/superpowers/plans/2026-11-16-deprecate-go-stage5-practice.md. Stage 4 (reviews) is already merged into this branch: the web reads and answers `ReviewItem`; only the practice → queue step is still Go.

## 0. Routes, roles, act-as, demo

Registered in `practiceRecordRoutes` router.go:317-330 (always, no nil check; the stores come from main.go:169-171 `PrepositionRecords: db, ComplementRecords: db, Reviews: db`):

| Route                              | Handler (practice_handlers.go)  | Store                                             |
| ---------------------------------- | ------------------------------- | ------------------------------------------------- |
| `GET /v1/preposition-records`      | `listPracticeRecords` :157-173  | `ListPrepositionRecords(owner, 100)`              |
| `GET /v1/preposition-records/{id}` | `getPracticeRecord` :175-188    | `GetPrepositionRecord`                            |
| `PUT /v1/preposition-records/{id}` | `putPracticeRecord` :193-240    | `AddPrepositionRecord`, then `EnqueueReviewItems` |
| `GET /v1/complement-records`       | same, `complementPractice` spec | `ListComplementRecords(owner, 100)`               |
| `GET /v1/complement-records/{id}`  | same                            | `GetComplementRecord`                             |
| `PUT /v1/complement-records/{id}`  | same                            | `AddComplementRecord`, then `EnqueueReviewItems`  |

- All six are `private` (router.go:216-223): `requireAuth` (no/invalid token 401; **guest 403** 「このアカウントは利用できません。」, middleware.go:155-158) + `rejectUserParam` (`?user=` → 400).
- **Act-as honoured** (no `notActing`): an admin acting as a member lists, reads and saves the **member's** rounds and the member's queue gets the misses (`Principal.OwnerID` = member). `TestActAsWritesGoToTheMember` act_as_test.go:33-55 uses `PUT /v1/preposition-records/{id}` and checks the store owner and the `"acting as member"` log line.
- **Demo allowed** (none is `notForDemo`; the closed list in demo_test.go:60-71 does not name them; `TestDemoKeepsItsOwnRecords` demo_test.go:101-113 lists the demo's own rounds).
- No AI, no rate limit, no AiUsage, no OpenAI. Body limit 1 MiB (middleware.go:18,131 → 413 `too_large`).
- The web calls them only from `src/infrastructure/go-api/{preposition,complement}-record-gateway.ts` (§5).

## 1. The two specs (practice_handlers.go:33-120)

`practiceSpec[R]` (:51-61) holds what differs; both kinds share the handlers.

|                                              | preposition (`prepositionPractice` :66-86)                             | complement (`complementPractice` :88-109) |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `maxAnswer` (answer and each miss, in runes) | **10**                                                                 | **40**                                    |
| `modes`                                      | nil: no mode; a `"mode"` key in the body is an **unknown field → 400** | `complementModes` :111-120                |
| review kind / targetId                       | `preposition` / `"<q.id>:<q.noun>"`                                    | `complement` / `q.id`                     |

`complementModes` = `result`, `potential`, `degree`, `direction-simple`, `direction-compound`, `direction-simple-extended`, `direction-compound-extended`, `verb` (動詞から選ぶ), `measure` (量詞の練習), `aspect` (了・过・着の練習). The DB enforces the same set: CHECK constraint `ComplementPracticeRecord_mode_check` (migrations 20261030090000 → 20261101090000 → 20261108090000 → 20261110100000 → 20261110110000_add_complement_aspect_mode). The web's list is `COMPLEMENT_ROUND_MODES` (`src/domain/practice/complement-record.ts:19-23`), the same 10.

Shared limits (:33-44): list `practiceRecordListLimit = 100`; `maxPracticeQuestions = 50`; `maxPracticeMisses = 3`; `maxPracticeID = 40`; `maxPracticeNoun = 40`; `maxPracticePrompt = 100`; `maxPracticeElapsed = 24h` (= 86 400 000 ms).

## 2. Validation, responses, messages

Messages (respond.go:55-56): `msgPracticeRecordInvalid` 「練習の記録の形式が不正です。」, `msgPracticeRecordNotFound` 「練習の記録が見つかりません。」. Generic body error `msgBadRequest` 「リクエストが不正です。」 (respond.go:26).

**PUT** (`putPracticeRecord` :193-240), in this order:

1. Path `id` must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`validUUID` respond.go:171-175; lower-case only, any version) else **404 not_found 「練習の記録が見つかりません。」**.
2. `decodeBody` (respond.go:196-215): exactly one JSON object, nothing after it, **unknown fields rejected at every level** (`DisallowUnknownFields`, so also inside a question), wrong JSON types (e.g. `elapsedMs: 1.5`) → **400 invalid_request 「リクエストが不正です。」** (the generic one, not the practice one). Body: `{"startedAt": string, "elapsedMs": int, "questions": [{"id"?, "answer", "noun", "prompt", "misses"}]}` plus `"mode"` for complements. `misses` may be absent/null (→ treated as `[]`). Go's JSON keys match case-insensitively.
3. **400 invalid_request 「練習の記録の形式が不正です。」** when any of:
   - `startedAt` does not parse as RFC 3339 (`time.Parse(time.RFC3339Nano)`; offsets allowed; **no range check**, future dates pass);
   - complement: `mode` not in `complementModes` (missing mode = `""` → invalid);
   - `validRound` (:245-266) fails:
     - `elapsedMs` < 0 or > 86 400 000;
     - 0 questions or more than 50;
     - per question: `id` longer than 40 runes (empty is fine: "no id"); `answer` empty or > `maxAnswer` runes; `noun` empty or > 40; `prompt` empty or > 100; more than 3 misses;
     - per miss: empty or > `maxAnswer` runes; **equal to the answer**; **repeated**.
   - Lengths are `utf8.RuneCountInString` (code points), `boundedText` :269-272 = `0 < n <= max`. No trimming: `" "` is a valid answer.
4. `add(owner, {ID: path id, Mode, ElapsedMs, StartedAt}, questions, now())` — see §3. ErrNotFound (the id is another owner's) → **404 「練習の記録が見つかりません。」**; other errors → 500 「サーバーでエラーが発生しました。」.
5. `queueReviews(owner, reviewTargets(saved questions), now())` (practice_reviews.go:53-59; §4). Uses the **saved** round's questions, so a retry queues what the first save did. **Error → 500** (the round stays saved; a retry re-queues). `now()` is called again here (a second clock read).
6. **200** = the saved record JSON (below).

**GET one** (:175-188): same path check → 404; ErrNotFound (none, or another owner's) → 404 「練習の記録が見つかりません。」; 200 record JSON.
**GET list** (:157-173): 200 `{"records": [summary…]}`; `[]` when none (store returns non-nil).

JSON (:122-155):

- summary: `{"id", "mode"?, "questionCount", "firstTryCount", "missCount", "elapsedMs", "startedAt", "createdAt"}`. `mode` only for complements (`omitempty` on a pointer, so a complement round always has it). Times `YYYY-MM-DDTHH:MM:SS.sssZ` UTC (`formatTime` entry_handlers.go:34).
- record: summary + `"questions": [{"id"?, "answer", "noun", "prompt", "misses": [...]}]` — `id` omitted when empty (`json:"id,omitempty"`, store/practice_records.go:20-26). The list never has `questions`.

## 3. The store (store/practice_records.go)

Tables (prisma/schema.prisma:195-208, 226-240): `PrepositionPracticeRecord` / `ComplementPracticeRecord` — `id` (TEXT **PK**, the browser's UUID), `ownerId`, `mode` (complement only, CHECK above), `questionCount`, `firstTryCount`, `missCount`, `elapsedMs` (INT), `questions` (JSONB), `startedAt`, `createdAt` (`TIMESTAMP(3)`, default now). `@@unique([id, ownerId])`, `@@index([ownerId, createdAt])`. No FK. No `updatedAt`.

- **One row per round, keyed by the client's id** (the browser makes `crypto.randomUUID()` once per finished round and reuses it on retry — `src/presentation/components/practice/use-practice-round.ts:38-44,137`).
- `addPracticeRecord` (:209-238):
  - counts **from the questions**, ignoring any counts passed in: `questionCount = len`, `firstTryCount` = questions with 0 misses, `missCount` = total misses;
  - `nil` misses become `[]` in a copy (the caller's slice is untouched);
  - `questions` = `json.Marshal` of the copy (id omitted when empty);
  - `createdAt = dbTime(now)` (UTC, ms), `startedAt = dbTime(startedAt)`;
  - one statement: `INSERT … ON CONFLICT ("id") DO UPDATE SET "id" = <table>."id" WHERE <table>."ownerId" = EXCLUDED."ownerId" RETURNING <summary cols>, "questions"` (:229-233). The no-op update returns the row **already saved** for the same owner (first save wins: mode, questions, counts, createdAt all kept — `TestAdd*RecordTwiceKeepsTheFirst`); **another owner's id → no row → ErrNotFound**, nothing changed.
- `listPracticeRecords` (:176-197): summary columns, `WHERE "ownerId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2`.
- `getPracticeRecord` (:199-207): `WHERE "id" = $1 AND "ownerId" = $2`; none → ErrNotFound. `scan` (:242-256) unmarshals `questions` (a stored question without `misses` would come back `null`; every writer stores `[]`).
- `practiceKind` (:69-80) + `summaryColumns`/`dest`/`insert` (:84-119) build the SQL for both tables; **`insert` is also used by the demo reset** (store/demo.go:160-169).

## 4. Practice mistakes → `ReviewItem`

- Targets (httpapi/practice_reviews.go:25-48): for each **saved** question with `id != ""` **and** ≥ 1 miss, in question order:
  - preposition → `{Language "zh", Kind "preposition", TargetID q.ID + ":" + q.Noun}` (e.g. `P001:学校`);
  - complement (all 10 modes, measure and aspect included) → `{"zh", "complement", q.ID}` (e.g. `result-01`, `verb:C005:看`, `measure-07`, `aspect-12`). The web's `reviewQuestion` (`src/domain/practice/review-question.ts:27-54`) parses exactly these.
  - Not deduplicated (a round with two questions naming the same target sends it twice; the second is a no-op by the rule below).
- `queueReviews` (:53-59): nil `Reviews` or no targets → nothing.
- `EnqueueReviewItems(owner, targets, now)` (store/review_items.go:27-50): `now = dbTime(now)`; **one transaction, one statement per target**:

  ```sql
  INSERT INTO "ReviewItem" ("id","ownerId","language","kind","targetId","due","state","createdAt","updatedAt")
  VALUES (newID(), owner, 'zh', kind, targetId, now, 0, now, now)
  ON CONFLICT ("ownerId","language","kind","targetId") DO UPDATE
  SET "due" = EXCLUDED."due", "updatedAt" = EXCLUDED."updatedAt"
  WHERE "ReviewItem"."due" > EXCLUDED."due"
  ```

  - new target → a New card (state 0, due now, all FSRS columns at their defaults 0, `lastReview` NULL, createdAt = updatedAt = now);
  - already queued and **due later than now** → `due = now`, `updatedAt = now`; **stability, difficulty, scheduledDays, reps, lapses, state, remainingSteps, lastReview kept**;
  - already due (due ≤ now) → untouched (not even `updatedAt`).
  - Returns rows affected (unused by the handler).

- Why one statement matters: answering (web, `src/infrastructure/prisma/review-store.ts` `answer`) takes `SELECT … FOR UPDATE` on the item and then rewrites every FSRS column. `INSERT … ON CONFLICT DO UPDATE` waits on that row lock and then re-checks its `WHERE` against the **committed** new row, so neither write is lost. A read-then-write port could read the old `due` and overwrite the answer.
- Tests: store/review_items_test.go `TestEnqueueReviewItemsAddsEachTargetOnce` :25 (2 added; re-enqueue 1 h later adds only the new one and keeps the known one at its first `due`; another owner's same target is separate; New, reps 0, no lastReview), `TestEnqueueBringsAMissedItemForward` :62 (answered Easy → due > +24 h; enqueued 1 h later → same id, due = then, reps/stability/state kept, n = 1; enqueued again while due → n = 0). Handler: practice_reviews_test.go `TestSavingARoundQueuesItsMissedQuestions` :32 (only the missed question with an id: `P001:学校`; owner and clock; complement `result-01`), `TestSavingARoundFailsWhenTheQueueFails` :63 (500).

## 5. The web today

- Domain: `src/domain/practice/practice-record.ts` (`ChoiceAnswer`, `RoundScore`, `PracticeRecordSummary`, `PracticeRecord`, `answerOf`, `scoreRound` "as Go counts them", `accuracyPercent`, `formatElapsed`); `complement-record.ts` (`ComplementRoundMode`, `COMPLEMENT_ROUND_MODES`, `roundModeLabel`, `ComplementRecord*`).
- Gateways: `src/infrastructure/go-api/preposition-record-gateway.ts` / `complement-record-gateway.ts` (`list()`, `get(id)` → null on 404, `save(round)` → the record); container `src/composition/practice-container.ts` exports `prepositionRecords`, `complementRecords`.
- Save action `src/presentation/actions/practice-record-actions.ts`: `getCurrentViewerUser()`; not admin/member → `accountForbiddenMessage` 「この操作を行う権限がありません。再度ログインしてください。」; zod shape (`id: z.uuid()`, `startedAt: z.iso.datetime()`, `elapsedMs: int`, `questions: practiceAnswerInput[]` (`practice-round-input.ts`: `id?`, `answer`, `noun`, `prompt`, `misses: string[]`), complements `mode: z.enum(COMPLEMENT_ROUND_MODES)`) fail → 「練習の記録の形式が不正です。」; `attemptGoResult("PREPOSITION_RECORD_SAVE_FAILED" | "COMPLEMENT_RECORD_SAVE_FAILED")` with **no notFound** → Go's 400 messages pass through, Go's 404 (another owner's id) → generic 「処理できませんでした。時間をおいてもう一度お試しください。」 + log; no revalidate. Callers: `preposition-practice.tsx:24`, `complement-practice.tsx:30` (`mode`), `measure-word-practice.tsx:27` (`"measure"`), `aspect-particle-practice.tsx:30` (`"aspect"`). Client (`use-practice-round.ts:103-117`) shows 「記録に保存しました。」 or the message; a thrown call → 「記録を保存できませんでした。もう一度お試しください。」; 再試行 resends the same id.
- Reads: `/practice` (`src/app/practice/page.tsx:96-108`, members/admins only, both lists via `loadOr("PRACTICE_RECORDS_UNAVAILABLE", …, [])` → `mergeRounds`/`latestByKind` in `practice-overview-presenter.ts`); `/practice/prepositions/records` and `/practice/complements/records` (`list()`, no loadOr → error page on failure); `…/records/[id]` (local `UUID` regex → 404, `get` null → 404). Guard `src/presentation/guards/practice-guard.ts`: signed out → sign-in, guest → 404.
- Web unit tests: `tests/go-api-preposition-record-gateway.test.ts`, `tests/go-api-complement-record-gateway.test.ts` (die), `tests/practice-record.test.ts`, `tests/practice-round-input.test.ts`, `tests/practice-overview-presenter.test.ts`, `tests/review-question.test.ts` (stay).
- E2E: `e2e/prepositions.spec.ts:36` (member's round of 25: DB row, owner, counts, ids `P\d+`, result, record list and page), `:85` (admin's own empty list; guest practises unsaved, records 404, 0 rows); `e2e/complements.spec.ts:39` (each mode saves its mode and lists), `:83` (guest, invalid modes 404); `e2e/aspect-particles.spec.ts:38` (mode `aspect`, listed with complements, misses → review); `e2e/review.spec.ts:42` (preposition misses → `ReviewItem` `preposition`/`<id>:<noun>`/zh/state 0, answered), `:126` (verb-mode complements); `e2e/study-log.spec.ts:8`, `e2e/hsk-levels.spec.ts`, `e2e/practice-fit.spec.ts` (pages only).
- **Gaps:** a retried save (same id) keeps one row and queues once; a card answered for later brought forward to now with its FSRS state kept, an already-due card untouched; another owner's id not overwritten / another owner's record page 404; act-as saving a round; the demo saving a round.

## 6. What other Go code still uses after stage 5 (keep)

- **Demo reset (stage 10):** store/demo.go:26-27 (`DemoSeed.PrepositionRecords/ComplementRecords`), :160-181 (`queueRound` → `practiceKind.insert`, `prepositionPractice`, `complementPractice`), :184-196 `demoScore`, :68 (tables in the delete list); demo/demo.go:173-195 builds `store.PrepositionRecord`/`ComplementRecord`/`PrepositionQuestion`/`ComplementQuestion`. So keep in store/practice_records.go: `PracticeQuestion`, `PracticeRecordSummary`, the 4 aliases, `PrepositionRecord`, `ComplementRecord`, `practiceKind` (`name` may go), `prepositionPractice`, `complementPractice`, `insert`. The demo seeds **no** practice `ReviewItem`s (only `entry` and `vocabulary`, store/demo.go:136,148).
- **Study log (stage 8):** store/study_log.go:29-33 sums `questionCount` of both tables per JST day (`createdAt`). Tables only — no Go practice code.
- **LINE review notify (stage 10):** counts every due item, practice ones included (store/line_review_notify.go). Tables only.
- **validUUID / uuidPattern** (chat, questions), `formatTime`, `decodeBody`, `codeInvalidRequest`: still used elsewhere. `boundedText` and `maxPractice*`: practice only.
- `review` package: still used by the demo (`NewCard`, `Next`); after stage 5 `review.New` is no longer used by the store's enqueue (file deleted). review/golden_test.go:129 has a comment naming `EnqueueReviewItems`.
- Follows/timeline, chat, questions, admin, AI usage: no use of practice code.
- Go **tests** that call the dying methods: store/study_log_test.go:30,33 (`AddPrepositionRecord`/`AddComplementRecord` with `prepositionRecord()`/`complementRecord()` helpers defined in the dying `*_records_test.go`), store/demo_test.go:131-138 (`ListPrepositionRecords`/`ListComplementRecords`), store/line_review_notify_test.go:124 and store/vocabulary_test.go:15 (`reviewOwner`, defined in the dying review_items_test.go:12-19), httpapi/act_as_test.go:33-55, httpapi/demo_test.go:46-47,101-113, httpapi/router_test.go:26-27,61-62,134-135 (`fakePrepositionRecords`, `fakeComplementRecords`, `fakeReviews`).

## 7. Becomes dead when the web owns practice records

- Go: router.go:106-111 (`Deps.PrepositionRecords`, `ComplementRecords`, `Reviews`), :171 and :317-330 (`practiceRecordRoutes`); main.go:169-171; httpapi/practice_handlers.go (whole), httpapi/practice_reviews.go (whole), respond.go:55-56; store/practice_records.go `ListPrepositionRecords`, `ListComplementRecords`, `GetPrepositionRecord`, `GetComplementRecord`, `AddPrepositionRecord`, `AddComplementRecord`, `listPracticeRecords`, `getPracticeRecord`, `addPracticeRecord`, `scan`, `summaryColumns`, `dest`; store/review_items.go (whole: `ReviewTarget`, `EnqueueReviewItems`). Tests: httpapi/preposition_handlers_test.go (`TestPrepositionRecordRoutesRejectGuests` :79, `…SaveListAndGet` :90, `…PutRejectsInvalidRounds` :134, `…PutKeepsTheQuestionID` :171, `…QuestionsWithoutAnIDStayWithoutOne` :193), httpapi/complement_handlers_test.go (same five at :77/:88/:132/:186/:208 + `TestComplementRecordPutAcceptsEveryMode` :170), httpapi/practice_reviews_test.go, store/preposition_records_test.go (`…CountsFromTheQuestions` :34, `…TwiceKeepsTheFirst` :67, `List…IsNewestFirstAndOwnersOnly` :94, `…KeepsTheQuestionID` :129, `Get…ReadsAQuestionWithoutAnID` :157), store/complement_records_test.go (same five at :35/:68/:96/:131/:159 + `…AcceptsTheVerbMode` :184, `…MeasureMode` :203, `…AspectMode` :223), store/review_items_test.go.
- Web: both gateways and their tests; Go comments in `practice-record.ts`, `practice-round-input.ts`, `practice-record-actions.ts`, `practice-container.ts`, `src/app/practice/page.tsx:96-97`.
- Docs: `docs-site/reference/practice.md`, its nav entry `docs-site/.vuepress/config.ts:35`, rows `docs-site/reference/README.md:35-40`, the link in `docs-site/reference/study-log.md:33`, `docs-site/README.md:27,41` (store line: "練習の間違いを復習の列に入れる処理"), `docs/features.md:110,148`, `docs/architecture.md` §5 (the "練習の間違いの登録" remark) and §6.
