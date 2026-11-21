# Go 廃止 段階 9a（フォロー・タイムライン・会員の一覧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フォロー（`PUT`/`DELETE /v1/follows/{ownerId}`）、タイムライン（`GET /v1/timeline`）、会員の一覧（`GET /v1/members`）を、Go API から Next.js に移す。Web が Prisma で DB を直接読み書きし、Go の 4 つのルートと、それだけが使うコードを同じ PR で消す（LINE が使う `MemberExists` と `notDemo` は残す）。

**Architecture:** 段階 4〜8 と同じ形にする。

- 会員の ID の形・タイムラインの件数・`FollowResult` は、`src/domain/social/follow.ts` に置く（I/O なし）。
- DB を読み書きするのは `src/infrastructure/prisma/social-store.ts`（新規）。一覧とタイムラインは Go と同じ SQL を `$queryRaw` で流し、フォローは「会員がいるか」と「行を足す」を 1 つの文にする。
- だれのフォローか・デモを断るかの判断は `src/application/social/social-network.ts`（新規）。
- `src/composition/social-container.ts` の `socialNetwork`（`listMembers`・`listTimeline`・`follow`・`unfollow`）は名前も形も変えない。中身だけを Go のゲートウェイから差し替える。
- 画面と文言は変えない（判断 5 のデモの扱いを除く）。

**Tech Stack:** Next.js 16.4（Server Component、Server Actions、`redirect`、`revalidatePath`、`unstable_rethrow`）、TypeScript、Prisma 7（`$queryRaw`、`Prisma.sql`）、`node:test` + `tsx`、Playwright。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 9、決めたこと 7〜9。「途中で PR が大きくなりすぎた段階は、さらに分けてよい」）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage9-go-reference.md`（以下「参照」）。段階 9a と 9b の両方の参照。この計画で使うのは §0〜§3、§9〜§14 の 9a の部分。

**続く計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage9b-accounts.md`（会員の管理・パスワード変更）。9a の PR の上に重ねた、別の PR にする。

## 設計者の判断（コントローラーが確かめること）

1. **段階 9 を 9a と 9b の 2 つの PR に分ける。** 1 つにすると 9 つのタスク（フォローの store・差し替え・Go の削除・ドキュメントに、パスワードの golden・規則と store・差し替え・Go の削除・ドキュメント）になり、設計書の「1 つの PR が大きすぎて、利用者が中身を追えないこと」に当たる。分け目は、DB に書くものの性質で決めた。9a は他人に見えるつながり（`Follow` の行と共有ノートの読み取り）だけで、パスワードもセッションも触らない。9b はパスワードのハッシュ・`sessionVersion`・試行回数の表で、Go のログイン（段階 11 まで残る）と互いに合わせる必要がある。9a を先にするのは、依存が少なく、9b のゲートウェイの分割（LINE の分を外に出す）と競合しないため。
2. **一覧とタイムラインは、Go と同じ SQL を `$queryRaw`（タグ付きテンプレート）で流す。**
   - 一覧は、2 つのアカウントの表を `UNION ALL` し、`EXISTS` でフォローの向きを 2 つ出し、`"displayName" COLLATE "ja-x-icu"`・`"createdAt"`・`"ownerId"` で並べる。照合順序と `UNION ALL` は Prisma のクエリでは書けず、JS で並べると日本語の順が DB とずれるため（参照 §1）。
   - タイムラインは、`Follow` と会員のアカウント（同じ `UNION ALL`）に `JOIN` し、共有中でゴミ箱にないノートを `"createdAt" DESC, "id" DESC` で並べる。ヒントは段階 2 の `hintsByEntry`（`src/infrastructure/prisma/learning-note-reads.ts`）を export して使う。
   - SQL を作る部分は純粋な関数（`memberDirectorySql`・`followerCountSql`・`timelineSql`・`followSql`）にして、`tests/review-store.test.ts` と同じく `sql.sql` と `sql.values` を確かめる。
3. **フォローは 1 つの文で、会員がいるときだけ行を足す。** Go は `MemberExists` と `INSERT` の 2 つの文で、そのあいだに消えた会員にも行ができた（参照 §2）。Web は、データを変える CTE で「相手の表に行があるか」と「`INSERT … ON CONFLICT DO NOTHING`」を 1 つの文にし、`SELECT EXISTS (…) AS "member"` を返す。2 回目のフォローは何もしない（Go と同じ）。`false` なら「見つかりません」。フォローを外すのは `deleteMany({ where: { followerId, followeeId } })` で、持ち主（フォローする人）で絞る。消えた行が 0 でも成功（Go の 204 と同じ）。
4. **だれのフォローか、だれが使えるかは Go と同じ。**
   - 使えるのは admin と会員（`isMemberRole` で `githubId` がある）。フォローする人・見る人は、いつも `githubId`（admin が会員として操作しているときは会員。Go の `ActAs` が持ち主を会員にしていたのと同じ。参照 §0）。admin 本人なら GitHub の ID（どの会員にも当たらないので、全員が一覧に出る）。
   - デモ（`user.demo === true`）・ゲスト・未ログイン・`revoked`・`githubId` なしは `SocialForbiddenError`。admin がデモとして操作しているときは、デモではない（`demo` が付かない。Go の `IsDemo` と同じ）。
   - 確かめる順は Go と同じ：だれか → ID の形（`^(password|ffpf):[a-z0-9]{1,64}$`、合わなければ「見つかりません」）→ 自分か（「自分はフォローできません。」）→ 会員がいるか。
5. **デモが `/follow` を開いたら `/` に戻す。** 今は Go の 403 が投げられてエラーの画面になる（参照 §9。メニューにはリンクが無い）。ゲストと同じく `/` に戻すほうが、壊れて見えない。画面の動きを変えるのはこの 1 つだけ。
6. **タイムラインは最新の 100 件だけを読む。** Web はこれまでも `?limit=100` の 1 ページしか使っていない（参照 §3）。Go のカーソルによるページ送りは移さない（使う人がいない）。件数は `FOLLOW_TIMELINE_LIMIT = 100` として domain に置く。
7. **人数の数え方は Go と同じ。** 「フォロー中」は一覧に出ている（アカウントがある）会員のうちフォローしている人の数。「フォロワー」は自分に向いたフォローの行のすべて（admin のフォローも数える。参照 §1）。一覧と人数は 2 つの文で、トランザクションにしない（Go と同じ。読むだけで、少しずれても次の表示で直る）。
8. **Go は、この 4 つのルートのためだけのコードをすべて消す。** 参照 §12・§13 の 9a の部分。`MemberExists`（LINE の `ownerValid` が使う）、`notDemo`・`notForDemo`（LINE の連携のルート）、`formatTime`（管理と LINE が使う。`respond.go` に移す）、`store.Entry` と `attachHints` などノートの読み取りの道具（LINE とテストが使う）は残す。
9. **消えるルートを通っていた Go のテストは、残るものだけを確かめる形に直す**（参照 §14 の 9a の部分）。
   - `TestActAsWritesGoToTheMember` は、9a のあと Go に会員として書くルートが無いので、`GET /v1/me` で「acting as member」のログが出ることを確かめる `TestActAsIsLogged` にする。
   - `TestDemoIsRefusedTheMemberDirectory` は消す。`TestDemoCheckErrorIsNotAPass` は LINE の `GET /v1/line/link` で確かめる。
   - `main_test.go` のフォローの往復は、`GET /v1/me` で更新したトークンが使えることを確かめる形にする。
   - `store/demo_test.go` の `s.Follow` は、SQL で行を入れる形にする。
10. **DB を使う確かめは e2e で行う**（Web の unit テストは DB を使わない。段階 4〜8 と同じ）。日本語の並び順、100 件の上限と並び、ヒントの順、消えた会員、操作中の admin、デモ、偽のフォロー先は、e2e で行を直接入れて、画面と DB で確かめる。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API（`01-app/01-getting-started/07-mutating-data.md` の Server Actions、`01-app/03-api-reference/04-functions/` の `redirect.md`・`revalidatePath.md`・`unstable_rethrow.md`）を確かめる（`AGENTS.md`）。
- コメントは英語。画面の文言は変えない（判断 5 を除く）。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は domain のほかを import しない。
- SQL はタグ付きテンプレート（`$queryRaw\`…\``・`Prisma.sql\`…\``）だけ。`$queryRawUnsafe`と文字列の連結は使わない。表の名前を選ぶときも、固定の`Prisma.sql` の断片から選ぶ。
- 会員の一覧（参照 §1）：
  - 見る人（`viewerId`）以外の、`PasswordAccount`（`'password:' || "id"`）と `FfpfAccount`（`'ffpf:' || "id"`）のすべて。loginId は返さない。
  - 並びは `"displayName" COLLATE "ja-x-icu"`、`"createdAt"`、`"ownerId"`。
  - `following` は見る人がその人をフォローしているか、`followsMe` はその人が見る人をフォローしているか。
  - `followingCount` は一覧のうち `following` の数。`followerCount` は `"followeeId" = viewerId` の行の数。
- フォロー（参照 §2）：ID は `^(password|ffpf):[a-z0-9]{1,64}$`。自分は不可。相手のアカウントがあるときだけ行を足す（1 つの文）。2 回目は何もしない。`createdAt` は `now`（1 回の処理で 1 度だけ読む）。フォローを外すのは、フォローする人とされる人の両方で絞った削除で、0 件でも成功。
- タイムライン（参照 §3）：見る人がフォローしていて、アカウントがある人の、`"sharedAt" IS NOT NULL AND "deletedAt" IS NULL` のノート。`"createdAt" DESC, "id" DESC`、最大 100 件。ヒントは `position` の順。
- ログは `FOLLOW_FAILED` などの決まったコードとエラーの名前だけ。持ち主の ID・表示名・ノートの中身は記録しない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は `cd services/api && go vet ./... && go test ./...`（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **一覧の人・並び・人数が Go と同じか。** `ja-x-icu` の順、同じ名前は登録の古い順、自分は出ない、消えた会員へのフォローは「フォロー中」に数えない、admin のフォローは「フォロワー」に数える。→ Task 1 のテスト `memberDirectorySql lists the members as Go did` と `directoryFromRows counts as Go did`、Task 3 の e2e `members are listed in Japanese order, then by when they joined`。
2. **タイムラインが Go と同じか。** フォロー中で、アカウントがあり、共有中でゴミ箱にないノートだけ、新しい順に 100 件、ヒントは順番どおり。→ Task 1 の `timelineSql reads the shared notes as Go did`、Task 3 の e2e `the timeline shows the newest 100 shared notes of followed members`。
3. **だれのフォローか。** 会員として操作している admin は会員として、admin 本人は GitHub の ID で。デモ・ゲストは断る。→ Task 2 のテスト `the follows are the signed-in user's` と `the demo, guests and the signed out have no follows`、Task 3 の e2e `an admin acting as a member follows as the member`。
4. **フォローの書き込みが安全か。** 1 つの文、2 回目は何もしない、自分・形の違う ID・いない会員は行を作らない、外すのは自分の行だけ。→ Task 1 の `followSql adds a row only for an existing member`、Task 2 の `follow checks the id, then self, then the member`、Task 3 の e2e `forged follow targets are refused`。
5. **Go に残すものを消していないか。** `MemberExists`・`notDemo`・`formatTime`・`store.Entry`・`attachHints`。→ Task 3 Step 1 の `go test ./...` と grep。

---

### Task 1: フォロー・タイムライン・一覧を Prisma で読み書きする

**Files:**

- Modify: `src/domain/social/follow.ts`（足す）、`src/infrastructure/prisma/learning-note-reads.ts`（`hintsByEntry` と `toKind` を export するだけ）
- Create: `src/infrastructure/prisma/social-store.ts`
- Test: `tests/social-store.test.ts`（新規。純粋な部分だけ）、`tests/follow.test.ts`（新規。domain）

**Interfaces:**

- Produces:

  ```ts
  // src/domain/social/follow.ts (the existing types stay)
  // What following someone came to. Go: 204, 400 self_follow, 404.
  export type FollowResult = "followed" | "self" | "not-found";
  // The follow page shows one page of shared notes: the newest 100. Go served
  // ?limit=100 and the web never asked for a second page.
  export const FOLLOW_TIMELINE_LIMIT = 100;
  // A member's owner id, password or FFPF ID. Go: memberOwnerIDPattern.
  export function isMemberOwnerId(value: string): boolean;

  // src/infrastructure/prisma/social-store.ts
  export type MemberRow = {
    ownerId: string;
    displayName: string;
    following: boolean;
    followsMe: boolean;
  };
  // Pure: Go's ListMembers statement (store/follows.go:46-52).
  export function memberDirectorySql(viewerId: string): Prisma.Sql;
  // Pure: every follow row pointing at the viewer, admins' included.
  export function followerCountSql(viewerId: string): Prisma.Sql;
  // Pure: the rows and the follower count as the domain's directory.
  export function directoryFromRows(
    rows: MemberRow[],
    followerCount: bigint,
  ): FollowDirectory;
  export type TimelineRow = {
    id: string;
    kind: string;
    originalText: string;
    correctedText: string;
    pinyin: string;
    createdAt: Date;
    sharedAt: Date | null;
    ownerId: string;
    ownerName: string;
  };
  // Pure: Go's ListTimeline statement without the cursor (store/follows.go:123-132).
  export function timelineSql(viewerId: string, limit: number): Prisma.Sql;
  // Pure: one statement that adds the follow only when followeeId is an
  // existing member, and reads whether it is. RangeError for an id that is
  // not isMemberOwnerId.
  export function followSql(
    followerId: string,
    followeeId: string,
    now: Date,
  ): Prisma.Sql;
  export function createSocialStore(db: () => PrismaClient): {
    // Every member but the viewer, in Go's order, with the counts.
    members(viewerId: string): Promise<FollowDirectory>;
    // The newest shared notes of the members the viewer follows.
    timeline(viewerId: string, limit: number): Promise<FollowTimelineItem[]>;
    // false: followeeId is no member. Following twice changes nothing.
    follow(followerId: string, followeeId: string, now: Date): Promise<boolean>;
    // Removes the follower's follow, if any.
    unfollow(followerId: string, followeeId: string): Promise<void>;
  };
  ```

- 一覧の SQL（`viewerId` は 3 回差し込む。出てくる順に `$1`〜`$3`）：

  ```sql
  SELECT a."ownerId" AS "ownerId", a."displayName" AS "displayName",
         EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = ${viewerId} AND f."followeeId" = a."ownerId") AS "following",
         EXISTS (SELECT 1 FROM "Follow" f WHERE f."followerId" = a."ownerId" AND f."followeeId" = ${viewerId}) AS "followsMe"
    FROM (SELECT 'password:' || p."id" AS "ownerId", p."displayName", p."createdAt" FROM "PasswordAccount" p
          UNION ALL
          SELECT 'ffpf:' || f."id", f."displayName", f."createdAt" FROM "FfpfAccount" f) a
   WHERE a."ownerId" <> ${viewerId}
   ORDER BY a."displayName" COLLATE "ja-x-icu", a."createdAt", a."ownerId"
  ```

  人数：`SELECT count(*) AS "count" FROM "Follow" WHERE "followeeId" = ${viewerId}`。

- タイムラインの SQL：

  ```sql
  SELECT e."id", e."kind", e."originalText", e."correctedText", e."pinyin", e."createdAt", e."sharedAt",
         e."ownerId" AS "ownerId", a."displayName" AS "ownerName"
    FROM "LearningEntry" e
    JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = ${viewerId}
    JOIN (SELECT 'password:' || p."id" AS "ownerId", p."displayName" FROM "PasswordAccount" p
          UNION ALL
          SELECT 'ffpf:' || ff."id", ff."displayName" FROM "FfpfAccount" ff) a ON a."ownerId" = e."ownerId"
   WHERE e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL
   ORDER BY e."createdAt" DESC, e."id" DESC
   LIMIT ${limit}
  ```

- フォローの SQL（`"PasswordAccount"` と `"FfpfAccount"` は、接頭辞で 2 つの固定の `Prisma.sql` の断片から選ぶ。`id` は接頭辞を外した部分）：

  ```sql
  WITH "target" AS (SELECT 1 FROM "PasswordAccount" WHERE "id" = ${id}),
       "added" AS (
         INSERT INTO "Follow" ("followerId", "followeeId", "createdAt")
         SELECT ${followerId}::text, ${followeeId}::text, CAST(${now} AS TIMESTAMP(3))
          WHERE EXISTS (SELECT 1 FROM "target")
         ON CONFLICT DO NOTHING
         RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM "target") AS "member"
  ```

  （`INSERT … SELECT` の引数は型が決まらないので明示する。データを変える CTE は、外の `SELECT` が参照しなくても必ず実行される。）

- [ ] **Step 1: 失敗するテストを書く。**（`tests/review-store.test.ts:60` と同じく、空白をつぶした `sql.sql` と `sql.values` を見る）
  - `tests/follow.test.ts`：`member owner ids are Go's`：`isMemberOwnerId` が `"password:abc"`・`"ffpf:cabc"`・`"password:" + "a".repeat(64)` で `true`。`"password:" + "a".repeat(65)`・`"password:"`・`"ffpf:"`・`"github:1"`・`"10001"`・`"password:ABC"`・`"password:a-b"`・`"guest"` で `false`。`FOLLOW_TIMELINE_LIMIT === 100`。
  - `tests/social-store.test.ts`：
    - `memberDirectorySql lists the members as Go did`：`memberDirectorySql("password:me")` の文が `'password:' || p."id"`、`'ffpf:' || f."id"`、`UNION ALL`、`f."followerId" = $1 AND f."followeeId" = a."ownerId"`、`f."followerId" = a."ownerId" AND f."followeeId" = $2`、`WHERE a."ownerId" <> $3`、`ORDER BY a."displayName" COLLATE "ja-x-icu", a."createdAt", a."ownerId"` を含み、`"loginId"` を含まない。`sql.values` は `["password:me", "password:me", "password:me"]`。`followerCountSql("password:me")` の文が `FROM "Follow" WHERE "followeeId" = $1`、値は `["password:me"]`。
    - `directoryFromRows counts as Go did`：行 `[{ownerId:"password:a", displayName:"A", following:true, followsMe:true}, {ownerId:"password:b", displayName:"B", following:true, followsMe:false}, {ownerId:"ffpf:c", displayName:"C", following:false, followsMe:true}]` と `3n` → `{ members: <同じ 3 人を同じ順で>, followingCount: 2, followerCount: 3 }`。`[]` と `0n` → `{ members: [], followingCount: 0, followerCount: 0 }`。
    - `timelineSql reads the shared notes as Go did`：`timelineSql("password:me", 100)` の文が `JOIN "Follow" f ON f."followeeId" = e."ownerId" AND f."followerId" = $1`、`ON a."ownerId" = e."ownerId"`、`e."sharedAt" IS NOT NULL AND e."deletedAt" IS NULL`、`ORDER BY e."createdAt" DESC, e."id" DESC`、`LIMIT $2`、`AS "ownerName"` を含む。値は `["password:me", 100]`。
    - `followSql adds a row only for an existing member`：`now = new Date("2026-11-17T03:00:00.000Z")`。
      - `followSql("10001", "password:abc", now)` の文が `FROM "PasswordAccount" WHERE "id" = $1`、`INSERT INTO "Follow" ("followerId", "followeeId", "createdAt")`、`WHERE EXISTS (SELECT 1 FROM "target")`、`ON CONFLICT DO NOTHING`、`SELECT EXISTS (SELECT 1 FROM "target") AS "member"` を含み、`"FfpfAccount"` を含まない。値は `["abc", "10001", "password:abc", now]`。
      - `followSql("password:me", "ffpf:cabc", now)` の文が `FROM "FfpfAccount" WHERE "id" = $1` を含む。値は `["cabc", "password:me", "ffpf:cabc", now]`。
      - `followSql("password:me", "github:1", now)` と `followSql("password:me", "password:", now)` は `RangeError` を投げる。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/follow.test.ts tests/social-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `members`：`$queryRaw<MemberRow[]>(memberDirectorySql(…))` と `$queryRaw<{ count: bigint }[]>(followerCountSql(…))` を順に流し、`directoryFromRows`。
  - `timeline`：`$queryRaw<TimelineRow[]>(timelineSql(…))`、`hintsByEntry(client, ids)`、`toKind(row.kind)` で `{ entry: { id, kind, originalText, correctedText, pinyin, createdAt, sharedAt, hints, ownerId }, ownerName }`。
  - `follow`：`(await db().$queryRaw<{ member: boolean }[]>(followSql(…)))[0]?.member === true`。
  - `unfollow`：`db().follow.deleteMany({ where: { followerId, followeeId } })`（数は使わない）。
  - 先頭のコメントに、Prisma のクエリで書かないわけ（判断 2）、フォローを 1 つの文にしたわけ（判断 3）、Go のどこと同じ結果か（参照 §1〜§3）を書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンドと `pnpm typecheck`・`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): フォロー・タイムライン・会員の一覧を Prisma で読み書きする`

### Task 2: application・container・ページを差し替える

**Files:**

- Create: `src/application/social/social-network.ts`
- Modify: `src/composition/social-container.ts`、`src/app/follow/page.tsx`、`src/presentation/controllers/follow-controller.ts`（`FollowResult` を domain から import）、`src/presentation/actions/follow-actions.ts`（コメント）、`src/presentation/controllers/action-state.ts`（`isForbidden` に `SocialForbiddenError`）、`src/presentation/presenters/site-navigation.ts`（コメントの「Go refuses them」）、`tests/follow-controller.test.ts`（足す）
- Delete: `src/infrastructure/go-api/social-gateway.ts`、`tests/go-api-social-gateway.test.ts`
- Test: `tests/social-network.test.ts`（新規）

**Interfaces:**

- Consumes: Task 1 の `isMemberOwnerId`・`FOLLOW_TIMELINE_LIMIT`・`FollowResult`・`createSocialStore`、`getCachedCurrentUser`、`prisma()`。
- Produces:

  ```ts
  // social-network.ts
  // The signed-in user has no follows: signed out, a guest, revoked, without
  // an owner id, or the demo account (shared by strangers).
  export class SocialForbiddenError extends Error {
    override name = "SocialForbiddenError";
  }
  export type SocialNetworkDeps = {
    currentUser: () => Promise<AuthenticatedUser | null>;
    store: {
      members(viewerId: string): Promise<FollowDirectory>;
      timeline(viewerId: string, limit: number): Promise<FollowTimelineItem[]>;
      follow(
        followerId: string,
        followeeId: string,
        now: Date,
      ): Promise<boolean>;
      unfollow(followerId: string, followeeId: string): Promise<void>;
    };
    now: () => Date;
  };
  export function createSocialNetwork(deps: SocialNetworkDeps): {
    listMembers(): Promise<FollowDirectory>;
    listTimeline(): Promise<FollowTimelineItem[]>;
    follow(followeeId: string): Promise<FollowResult>;
    // A malformed id matches no follow, so nothing is removed (the controller
    // refuses it before calling).
    unfollow(followeeId: string): Promise<void>;
  };
  ```

  決まり（判断 4）：
  - `me()`：`user` が無い・`isMemberRole(user.role)` でない・`githubId` が無い・`user.demo === true` → `SocialForbiddenError`。そうでなければ `user.githubId`。どのメソッドも最初に `me()`。
  - `listTimeline`：`store.timeline(me, FOLLOW_TIMELINE_LIMIT)`。
  - `follow`：`isMemberOwnerId` でない → `"not-found"`（store を呼ばない）→ `followeeId === me` → `"self"`（store を呼ばない）→ `store.follow(me, followeeId, deps.now())` が `false` → `"not-found"`、`true` → `"followed"`。
  - `unfollow`：`isMemberOwnerId` でなければ何もしない。そうでなければ `store.unfollow(me, followeeId)`（自分でも呼ぶ。Go の 204 と同じ）。

- [ ] **Step 1: 失敗するテストを書く。**（利用者は `tests/practice-records.test.ts:23-45` の `member`・`actingAdmin`・`demo`・`guest`・`revoked`・`noGithubId` を写す。admin は `{ githubLogin: "octocat", githubId: "10001", role: "admin" }`。store は呼び出しを記録する偽物）
  - `tests/social-network.test.ts`：
    - `the follows are the signed-in user's`：会員 → `listMembers` で store に `"password:abc"`、`listTimeline` で `("password:abc", 100)`、store の答えがそのまま返る。会員として操作している admin → `"password:abc"`。admin → `"10001"`。
    - `the demo, guests and the signed out have no follows`：デモ・ゲスト・`null`・`revoked`・`githubId` の無い会員で、4 つのメソッドのどれも `SocialForbiddenError`、store は呼ばれない。デモに形の違う ID（`"github:1"`）を渡しても `SocialForbiddenError`（だれかが先）。
    - `follow checks the id, then self, then the member`：`now = new Date("2026-11-17T03:00:00.000Z")`。
      - 会員が `"github:1"` → `"not-found"`、`"password:abc"`（自分）→ `"self"`、どちらも store は呼ばれない。
      - store が `false` → `"not-found"`。`true` → `"followed"` で、store に `("password:abc", "password:def", now)`。
      - 会員として操作している admin が `"password:def"` → store に `("password:abc", "password:def", now)`。admin が `"password:abc"` → `("10001", "password:abc", now)`、`"followed"`。
    - `unfollow removes only the signed-in user's follow`：会員が `"password:def"` → store に `("password:abc", "password:def")`。`"github:1"` → store は呼ばれない。`"password:abc"`（自分）→ store に `("password:abc", "password:abc")`。
  - `tests/follow-controller.test.ts` に `follow and unfollow treat SocialForbiddenError as not allowed`：`run` が `SocialForbiddenError` を投げる → `{ status: "error", message: "ログインし直してください。" }`、`console.error` は呼ばれない。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/social-network.test.ts tests/follow-controller.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。**
  - `social-container.ts`：

    ```ts
    // Follows, the member list and the shared-notes timeline, read and
    // written in the database as the signed-in user.
    export const socialNetwork = createSocialNetwork({
      currentUser: getCachedCurrentUser,
      store: createSocialStore(prisma),
      now: () => new Date(),
    });
    ```

  - `/follow`（判断 5）：`requireNonGuestOwner` のあとに `if (user.demo) redirect("/");`（コメント「The demo account has no follows; like guests it goes home.」）。コメントの「Go reads the follows of the token's owner.」を「socialNetwork reads the signed-in user's follows.」に。ほかは変えない（`loadOr` は使わない。今と同じく失敗はページの失敗）。
  - `follow-controller.ts`：`FollowResult` を `@/domain/social/follow` から import。
  - `follow-actions.ts`：「Go follows as the token's owner; the follower checked here is not sent.」を「socialNetwork follows as the signed-in user; the follower checked here is not sent.」に。
  - `action-state.ts`：`isForbidden` に `error instanceof SocialForbiddenError` を足し、`attemptGoAction` と `attemptGo` のコメントの例の列に `SocialForbiddenError` を足す。
  - `site-navigation.ts:161-165` のコメント：「Go refuses them」を「the app refuses them」に（意味は同じ）。
  - `social-gateway.ts` と `tests/go-api-social-gateway.test.ts` を消す。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS（`tests/architecture.test.ts` を含む）。
  - `grep -rn "social-gateway\|/v1/members\|/v1/follows\|/v1/timeline" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): フォローとタイムラインを Go に頼まずに読み書きする`

### Task 3: Go の 4 つのルートを消し、e2e で確かめる

**Files:**

- Delete / Modify（参照 §12・§13・§14 の 9a の部分に従う）：
  - 消す：`httpapi/follow_handlers.go`、`httpapi/follow_handlers_test.go`、`httpapi/entry_handlers.go`、`httpapi/entry_handlers_test.go`、`httpapi/validate_test.go`。
  - `httpapi/respond.go`：`entry_handlers.go` の `timeLayout` と `formatTime` をここに移す（コメント「formatTime writes a time as ISO 8601 UTC with milliseconds, like the web's Date#toISOString.」）。`msgSelfFollow`・`codeSelfFollow`・`pathValue` を消す（`pathValueMsg` は 9b まで残す）。
  - `httpapi/validate.go`：`encodeCursor`・`decodeCursor`・`errCursor` と、使われなくなる import を消す（`validID`・`maxIDBytes` は 9b まで残す）。
  - `httpapi/router.go`：`Follows` インターフェース（:41-49）、`_ Follows`（:15）、`Deps.Follows`、`r.memberRoutes()`（:145）と `memberRoutes`（:256-264）を消す。
  - `store/follows.go` → `store/members.go`（`git mv`）。`MemberExists` だけを残す（コメントはそのまま）。`Member`・`MemberDirectory`・`TimelineItem`・`memberAccounts`・`ListMembers`・`Follow`・`Unfollow`・`ListTimeline` と、使われなくなる import を消す。
  - `store/entries.go`：`Cursor`・`cursorArgs`・`entryColumnsAs` と、使われなくなる import（`strings`）を消す。
  - `store/follows_test.go` → `store/members_test.go`（`git mv`）。`newMember`・`newFfpfMember`・`TestMemberExists`・`TestMemberExistsFfpf` だけを残す（`mustFollow`・`shareAll`・`newNamedMember` とほかのテストを消す）。
  - `store/testhelpers_test.go`：`shareNote`（:132-137）を消す。
  - `main.go`：`Follows: db,`（:162）を消す。
  - `scripts/api-smoke.sh`：39〜47 行（`members`・`friend`・follow・timeline・unfollow）を消す。
- テストの書き直し（判断 9）：
  - `httpapi/demo_test.go`：
    - `allRoutesDeps` から `Follows: &fakeFollows{}` を消す。
    - `TestDemoIsRefusedExactlyTheClosedRoutes` の `want` から `GET /v1/members`・`PUT /v1/follows/{ownerId}`・`DELETE /v1/follows/{ownerId}`・`GET /v1/timeline` を消す。
    - `TestDemoIsRefusedTheMemberDirectory` を消す。
    - `TestDemoCheckErrorIsNotAPass`：`routerWith(t, auth.RoleMember, Deps{Auth: a, Line: &fakeLine{}, LineChannelSecret: testLineSecret, CronSecret: testCronSecret})` で `GET /v1/line/link` → `500 internal`。
  - `httpapi/act_as_test.go`：`TestActAsWritesGoToTheMember` を `TestActAsIsLogged` にする：`a := actingAuth(auth.RoleAdmin)`、`a.me` は `auth.Me{OwnerID: p.OwnerID, Role: "admin", Login: "alice", ActingAs: auth.ActingAs{OwnerID: p.OwnerID, LoginID: "test01", DisplayName: "テスト"}}` を返す。`routerWith(t, "", Deps{Auth: a})` で `GET /v1/me` に `actAsHeaders(actedMember)` → 200、ログに `"msg":"acting as member"`・`"actor":"<testOwner>"`・`"owner":"password:member2"`。`TestActAsRejections` の「member is refused on every authed route」の `Deps` から `Follows` を消す。
  - `httpapi/router_test.go`：3 つの `Deps` から `Follows: &fakeFollows{}` を消す。
  - `main_test.go:392-445`：フォローの往復（`shareEntry` から timeline の確かめまで）を、`GET /v1/me` を `second.AccessToken` で呼んで 200、`ownerId == owner` を確かめる形にする（`var me struct{ OwnerID string \`json:"ownerId"\` }`）。使われなくなる会員（`memberB` など）と型（`entryResp` がほかで使われていなければ）を消す。`go vet` で確かめる。
  - `store/demo_test.go:164-169`：`s.Follow(ctx, owner, other, now)` と逆向きを、`s.pool.Exec(ctx, \`INSERT INTO "Follow" ("followerId", "followeeId", "createdAt") VALUES ($1, $2, $3), ($2, $1, $3)\`, owner, other, dbTime(now))` にする（後片付けはそのまま）。
- Modify（docs-site。段階 1〜8 と同じ扱い）：
  - `docs-site/reference/follows.md` を消し、`docs-site/.vuepress/config.ts:31` のナビから外す。
  - `docs-site/reference/README.md`：19〜22 行（4 つのルート）と、「一覧の続きの取得」の節（89 行〜。`GET /v1/timeline` だけが使う）を消す。その上の学習ノートの形の表（`id`・`kind`・…・`sharedAt`）も、残るルートのどれも返さないなら、見出しごと消す。
  - `docs-site/operations/local.md`：59 行（`/v1/members` の curl）と 64 行（`GET /v1/members` の説明）を消す。
- Modify：`e2e/follow.spec.ts`、`e2e/demo.spec.ts`、`e2e/act-as.spec.ts`。

- [ ] **Step 1: Go を消す。**
  - `cd services/api && gofmt -l . && go vet ./... && go build ./... && go test ./...` → 成功（`store`・`demo` の DB のテストは開発用 DB（Docker）で）。
  - `grep -rn "ListMembers\|ListTimeline\|MemberDirectory\|TimelineItem\|memberAccounts\|fakeFollows\|Follows\b\|msgSelfFollow\|self_follow\|readListQuery\|paginate\|decodeCursor\|encodeCursor\|toEntryJSON\|cursorArgs\|entryColumnsAs\|/v1/members\|/v1/follows\|/v1/timeline" services/api scripts` → 何も出ない。
  - `grep -rn "MemberExists" services/api` に `main.go`・`store/members.go`・`store/members_test.go`・`main_test.go` が残る。`grep -rn "formatTime" services/api/httpapi` に `respond.go`・`admin_handlers.go`・`line_handlers.go` が残る。
- [ ] **Step 2: 足りない e2e を足す（判断 10）。** 時刻は UTC（fixture は `SET TIME ZONE 'UTC'`）。
  - `e2e/follow.spec.ts`：
    - `members are listed in Japanese order, then by when they joined`：
      - 見る人 `createMember(db, "viewer", "閲覧者", password)`。
      - 次の名前で `createMember`（loginId は `m1`〜`m9`）：「カズ」「サーシャ」「アキラ」「コーヘイ」「イチロー」「ケーキ」「コウヘイ」「ダブル」（`m8`）「ダブル」（`m9`）。`UPDATE "PasswordAccount" SET "createdAt" = $2 WHERE "id" = $1` で、`m1`〜`m7` は `2026-10-01 00:00:0i`（i = 1〜7）、`m8` は `2026-10-01 00:00:20`、`m9` は `2026-10-01 00:00:10`（あとで作ったほうが古い）。
      - 閲覧者で `/follow` を開き、`page.locator('li input[name="followeeId"]').evaluateAll(...)` の値の並びが、`m3, m5, m1, m6, m7, m4, m2, m9, m8` の `memberOwnerId` の順と同じ。「閲覧者」の行は無い。
    - `the timeline shows the newest 100 shared notes of followed members`：
      - 太郎（`taro`）・花子（`hanako`）・次郎（`jiro`）。太郎に `seedNotes` で `共有{nnn}`（`共有001`〜`共有101`。3 桁にそろえるのは、`hasText` が部分一致のため。`createdAt` は `2026-10-01T00:00:00Z` に n 分足した時刻、ヒント「一番目」）を入れ、すべて `"sharedAt" = NOW()`。`共有101` には `INSERT INTO "Hint"` で `position` 1 の「二番目」を足す。
      - 次郎に共有中のノート「次郎の共有」と、太郎にゴミ箱の共有ノート「捨てた共有」（`"deletedAt" = NOW()`、`createdAt` は `2026-12-01T00:00:00Z`）。
      - 消えた会員：`INSERT INTO "Follow"` で花子 → `password:gone00000000000000000000`、その持ち主に `seedNotes` で共有中の「消えた人の共有」（`createdAt` `2026-12-01T00:00:00Z`）。
      - 花子が太郎だけを `INSERT INTO "Follow"` でフォローし、`/follow` を開く：
        - `page.locator("details summary")` の数が 100。
        - 最初の `details summary` に「共有101」、`note(page, "共有002")` は見え、`note(page, "共有001")` は無い（`toHaveCount(0)`）。
        - 「次郎の共有」「捨てた共有」「消えた人の共有」は無い。
        - 「共有101」のカードを開くと、「一番目」が「二番目」より前に出る（カードの `innerText` で `indexOf` を比べる）。
    - `an admin acting as a member follows as the member`：
      - 会員 `test01`（「テスト一郎」）と太郎。admin で `/admin/accounts` から「この会員として操作」→ `/follow` → 太郎の行の「フォローする」→「フォロー解除」が見える。
      - DB：`SELECT "followerId", "createdAt" FROM "Follow" WHERE "followeeId" = $1`（太郎）が 1 行で、`followerId` は `memberOwnerId(test01)`、`createdAt` と `Date.now()` の差が 60 秒以内（日本時間に 9 時間ずれていない）。
      - 「管理者に戻る」→ `/follow`：太郎の行は「フォローする」。押す → `Follow` の行に `adminOwnerId` が増える。
      - 太郎でログインして `/follow` → 「フォロー中 0人・フォロワー 2人」（admin のフォローも数える）。
    - `forged follow targets are refused`：太郎と花子。花子で `/follow`、太郎の行のフォームの `input[name="followeeId"]` を `evaluate` で書き換えて押す：
      - `password:gone00000000000000000000` → 「見つかりませんでした。画面を更新してください。」、`Follow` に行が無い。
      - 花子自身の `memberOwnerId` → 「自分はフォローできません。」、`Follow` に行が無い。
  - `e2e/demo.spec.ts` の `anyone can try the members' pages in the demo, without AI`、「デモを終える」の前：`/follow` を開き、`pathname === "/"`（判断 5）。
  - 既存の `e2e/follow.spec.ts` の 5 本、`ffpf-login.spec.ts` の 2 本、`act-as.spec.ts`・`demo.spec.ts`・`bottom-navigation.spec.ts` は、ほかを変えずに通ること。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。`follow`・`ffpf-login`・`act-as`・`demo`・`accounts`・`line` を含む。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: コミット。** `refactor: Go のフォロー・タイムライン・会員の一覧のルートを消す`

### Task 4: ドキュメント

**Files:** `docs/api-deployment.md`、`docs/architecture.md`、`docs/features.md`、`docs/api-local.md`、`docs/roadmap.md`、`README.md`、`docs-site/README.md`、`docs-site/errors.md`、`docs-site/operations/deploy.md`

段階 7・8 の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、`grep` で探してすべて直す。

- [ ] **Step 1: 直す。**
  - `README.md`：
    - 33 行（技術の表の API の行）：Go の受け持ちから「フォローとタイムライン、」を外し、括弧を「（クイック質問・質問ノート・ChatGPT と話す・会話ノート・学習ログ・AI の利用量の集計・フォローとタイムライン・会員の一覧は Web に移りました）」にする。
    - 34 行（DB の行）：Web が読み書きするものに「フォロー（会員の一覧とタイムラインを含む）」を足す。
    - 42 行（「Web が DB に触るのは…」）：列に「フォローと会員の一覧とタイムライン」を足し、本文にも「フォロー（一覧・タイムライン・フォローする／外す）も Prisma で読み書きします」を足す。
  - `docs/architecture.md`：
    - mermaid（20 行）`DATA[フォロー・LINE の復習のお知らせ]` を `DATA[LINE の復習のお知らせ]` に。33 行の Web → DB の辺に「フォロー・タイムライン」を足す。
    - 43 行の箇条に「フォロー（会員の一覧・タイムライン・フォローする／外す）も Prisma で読み書きします」を足す。
    - 210 行（外部キーがない）：「持ち主の整合性は Go API のコードで守っています」を「持ち主の整合性はコードで守っています（フォローは、相手のアカウントがあるときだけ行を足す 1 つの SQL）」に。
  - `docs/features.md`：
    - 14 行（デモの使えないもの）：「Web（AI）と Go API（LINE 連携・フォローと共有・パスワード変更）が」を「Web（AI・フォローと共有）と Go API（LINE 連携・パスワード変更）が」に。「デモが `/follow` を開くと `/` に戻ります。」を足す。
    - 67〜72 行（フォローの節）：動きは変わらない。72 行の後に「フォローと一覧とタイムラインは、Web が DB を直接読み書きします（フォローは、相手の会員がいるときだけ行を足す 1 つの SQL）。」を足す。
  - `docs/api-local.md`：57 行（`/v1/members` の curl）と 62 行（その説明）を消す。
  - `docs/roadmap.md:28`：「Web と共通の Go API」を「移行中の Go API（ログイン・LINE・会員の管理）」にする（9b のあとは 9b のドキュメントのタスクで「会員の管理」を外す）。
  - `docs-site/README.md`：15 行の「ログインとフォローなど」を「ログインと会員の管理など」に、24 行の Go の機能の列から「フォローとタイムライン、」を外す、27 行の「フォローとタイムライン、」を外して Web が直接扱う列に「フォローとタイムライン、会員の一覧」を足す、41 行の store のコメントから「フォロー・」を外す、51 行の例のパスを `POST /v1/auth/password` の形に、63 行の「ログインやフォローなど」を「ログインや会員の管理など」に。
  - `docs-site/errors.md`：`self_follow` の行があれば消す（`grep -n "self_follow\|フォロー" docs-site/errors.md` で探す）。
  - `docs-site/operations/deploy.md:87` と `docs/api-deployment.md:94`：`ja-x-icu` の確かめは「会員一覧（Web の `/follow`）」のためと書き直す（無いと `/follow` がエラーになる）。
  - `docs/api-deployment.md`：
    - 470 行（デモの使えないもの）：フォロー・メンバー一覧・タイムラインは Web が断る（`/follow` は `/` に戻す）、と直す。Go のルートの判定（`auth.Service.IsDemo`）は、LINE 連携と `POST /v1/account/password` だけに残る、と書く。
    - 「段階8（学習ログ・AI の利用量）のマージの前と後」のあとに、「段階9a（フォロー・タイムライン・会員の一覧）のマージの前と後」を足す（段階 8 と同じ形）：
      - はじめの段落：フォロー（する・外す）、フォロー中の人の共有ノートのタイムライン、会員の一覧を Web に移した変更。Web が Prisma で Go と同じ SQL を流し、フォローは「相手の会員がいるときだけ行を足す」1 つの SQL にした。Go の `/v1/members`・`/v1/follows/{ownerId}`・`/v1/timeline` はなくなった。Go に残るのは、LINE、会員の管理、パスワード変更、ログイン、Cron。
      - マージの前：この段階で必須の環境変数も、マイグレーションもない（表はすべてある。照合順序 `ja-x-icu` は Go のときに確かめた同じ DB）。
      - マージのあと：1. Web の Production のデプロイが Ready。2. `vercel promote`。3. main から Go を再デプロイ（実行の前に、使う人に確かめる）。これで 3 つのルートが本番の Go から消える。4. 本番で `/follow` を開き、一覧と共有ノートが出ること、1 人をフォローして外せることを確かめる。
      - 切り替えのあいだ：古い Go と新しい Web が同じ `Follow` 表を同じ形で読み書きするので、どちらで書いた行も、もう一方に出る。
      - 戻すとき：Go だけを戻しても害はない。Go を再デプロイしたあとで Web だけを戻すと、古い Web が消えたルートを呼んで `404` になり、`/follow` がエラーの画面になり、フォローのボタンは「見つかりませんでした。画面を更新してください。」になる。Web を戻すなら Go も戻す。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "/v1/members\|/v1/follows\|/v1/timeline\|self_follow" README.md docs docs-site --include='*.md' --include='*.ts' | grep -v "docs/superpowers\|docs/releases\|\.vuepress/dist"` → 何も出ない。
  - `grep -rn "フォロー" README.md docs/architecture.md docs/features.md docs/roadmap.md docs/api-deployment.md docs-site --include='*.md' | grep -v "\.vuepress/dist"` の結果を 1 行ずつ読み、「Go が」「API で」フォローを扱うと書いた所が残っていないことを確かめる。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: フォロー・タイムライン・会員の一覧を Web に移したことを書く`
