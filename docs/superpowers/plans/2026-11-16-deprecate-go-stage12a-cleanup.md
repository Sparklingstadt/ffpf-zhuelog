# Go 廃止 段階 12a（後片付け：Go・docs-site・Go のクライアントと設定を消す）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go に関わるものを、リポジトリからすべて消す。消したあとも、アプリの動きは 1 つも変えない。

- `services/api/`（Go の health だけのサーバー）と、Go の CI・フック・スクリプト・Dependabot・`compose.api.yaml` を消す。
- `docs-site/`（Go API の VuePress のサイト）と、そのビルド・依存（`vuepress` ほか 5 つ）を消す。
- Web に残った Go のクライアント（`src/infrastructure/go-api/`）と、それに合わせた `GoApiError` の枝を消す。`attemptGo*` の名前から `Go` を外す。
- `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を、コード・`.env.example`・文書から消す。
- 手元の DB を 1 つ（`compose.yaml`）にし、サンプルの会員の seed をそこへ入れられるようにする。
- README・`docs/development.md`・`.env.example` を Next.js だけの構成に書き直す。`docs/api-deployment.md` は `docs/deployment.md` に改名し、「段階12 のマージの前と後」を足す。

`ApiRefreshToken` の表を消すマイグレーションは、この計画には **入れない**。12b（`docs/superpowers/plans/2026-11-16-deprecate-go-stage12b-drop-refresh-tokens.md`）で、利用者が Go の Vercel プロジェクトを消したあとに出す（判断 1）。

**Architecture:** 新しい部品は無い。消すのが主で、残る変更は次の 4 つ。

- `src/presentation/controllers/action-state.ts`・`load-or.ts`：失敗は「application の forbidden のエラー」か「それ以外（ログは決まったコードとエラーの名前だけ）」の 2 つになる。
- `scripts/test-unit.mjs`：Node のテストだけを走らせる。
- `scripts/sample-members-seed.ts`（`scripts/api-local-seed.ts` を移す）：`.env` の `DATABASE_URL`（手元の DB だけ）にサンプルの会員を入れる。`pnpm run db:seed:sample`。
- `docs/deployment.md`（`docs/api-deployment.md` の改名）：Web の 1 プロジェクトだけの手順になる。段階 1〜12 の「マージの前と後」は、末尾の「移行の記録」にまとめて残す。

**Tech Stack:** Next.js 16.4、TypeScript、Prisma 7、`node:test` + `tsx`、Playwright、pnpm 11、lefthook。依存は減らすだけで、増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 12、「動いている Go の止め方」の最後の項目、決めたこと 8・9）

**Go の参照：** 無い。Go の動きを写す作業は無く、消すものと直すものは、この計画にすべて書いた。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage11b-switch.md`（11b。この計画は 11b の PR の上に重ねた PR）。**後：** 12b（`ApiRefreshToken` を消すマイグレーションだけ）。

**マージの条件：** 11b が本番にあり（`vercel promote` 済み）、Go を 11b の main から出し直してあること（Go は health だけ）。Go の Vercel プロジェクトが Git につながっていないこと（Task 4 の「12a のマージの前と後」）。

## 設計者の判断（コントローラーが確かめること）

1. **段階 12 を 12a（コードの後片付け）と 12b（`ApiRefreshToken` を消すマイグレーションだけ）に分ける。**
   - 本番のビルド（`scripts/vercel-build.sh`）は、main へのマージで `prisma migrate deploy` を自動で当てる。表を消すマイグレーションを 12a に入れると、12a をマージした時点で表が消える。設計の「Go の Vercel プロジェクトを消したあとにだけ本番に出す」を、マージの順番だけで守れる形にするため、別の PR にする。
   - 12a は 11b と Go の出し直しのあと、いつマージしてもよい。12b は、利用者が Go の Vercel プロジェクトを消したあとにだけマージする。12b の PR は下書き（draft）で作り、説明の 1 行目に「Go の Vercel プロジェクトを消してからマージする」と書く（12b の計画）。
   - スキーマの `model ApiRefreshToken` も 12b で消す。12a で先に消すと、`schema.prisma` とマイグレーションが食い違い、次に `prisma migrate dev` を走らせた人が、意図しない DROP を作ってしまうため。`DEMO_KEPT_TABLES` の `ApiRefreshToken` も、スキーマと 1 組で確かめるテスト（`tests/demo-reset-store.test.ts`）があるので、12b で一緒に消す。
   - 技術的なしかけ（ビルドで Go の有無を確かめるなど）は足さない。Go のプロジェクトがあるかを Web のビルドから確かめる方法は無く、確かめるために Vercel のトークンを Web に入れるのは、守るものに比べて重すぎる。
2. **Go のクライアントを消すとき、失敗の扱いは「forbidden か、それ以外か」の 2 つにする。**
   - `GoApiError` はもう投げられない（`goApi` を呼ぶ所が無い）。`action-state.ts` と `load-or.ts` の `GoApiError` の枝は、通らない死んだコードになっている（11b の Task 4 のレビューの指摘）。
   - 消すもの：`goFailureMessage`、`userFacingCodes`（Go の 400・409・413 の文言を見せる仕組み）、`attemptGo` の `notFound` の引数（Go の 404 だけが使った）、使われていない `attemptGoResult`。
   - 入力の誤りの文言は、今はどれも Server Action と controller が返り値で返している（例：単語帳の「すでにあります」は `vocabulary-actions.ts`）。例外から文言を出す仕組みは要らない。
   - ログは今の「決まったコードとエラーの名前」の形にそろう（Go のときの「コード・ステータス・Go のコード」の形はなくなる）。
3. **`attemptGo*` の名前から `Go` を外す。** `attemptGoAction` → `attemptAction`、`attemptGo` → `attemptCall`、`GoAttempt` → `CallAttempt`。
   - 利用者が読んで「Go を呼んでいる」と誤解しないため（廃止の理由が「自分で読めること」なので、名前の嘘も残さない）。
   - 機械的な名前替えで、動きは変えない。どのファイルにも同じ名前は無い（`git grep -n "attemptAction\b\|attemptCall\b\|CallAttempt"` で 0 件を確かめてある）。
   - Go の動きを写したことを表す名前（`goTrimSpace`・`src/domain/line/go-text.ts`・`src/infrastructure/line/go-json.ts`・`line-webhook-controller.ts` の `goError`）は **変えない**。「Go の `strings.TrimSpace` と同じ切り方」「Go の `json.Unmarshal` と同じ読み方」という、今も意味のある約束を表していて、DB の行と LINE への答えの形がそれに頼っているため。
   - GitHub のコールバックの道 `/api/auth/callback/github/go` も **変えない**（決めたこと 6。GitHub に登録した URL を利用者が直さなくて済むように）。
4. **`learning-json.ts` は消す。** `src` からは使われておらず、`tests/learning-kind.test.ts` と `tests/go-api-learning-json.test.ts` だけが使っている。
   - `tests/go-api-learning-json.test.ts` は消す（Go の JSON を読むテスト）。
   - `tests/learning-kind.test.ts` は残す（学習ノートの種類と、カードの見え方のテスト）。種類の確かめは、DB から読むときに実際に使う `toKind`（`src/infrastructure/prisma/learning-note-reads.ts`）で行い、カードには `LearningEntry` を直接渡す。
5. **手元の DB を 1 つにする。**
   - 今は DB が 2 つある。`compose.yaml`（`127.0.0.1:5432`、`.env.example` の既定）と、`compose.api.yaml`（`127.0.0.1:55440`、サンプルの会員が入る。名前のとおり Go を試すためのもの）。`docs/development.md` は、ログインのために `.env` の `DATABASE_URL` を 55440 に替えさせている。
   - `compose.api.yaml`・`scripts/api-local.sh`・`scripts/api-local-env.sh`・`scripts/api-smoke.sh` を消す。サンプルの会員を入れる seed は役に立つので、`scripts/sample-members-seed.ts` に移し、`.env` の `DATABASE_URL` に入れる（`localhost`・`127.0.0.1`・`[::1]` だけ。それ以外は投げる）。`pnpm run db:seed:sample` で走らせる。
   - 手元の起動は `docker compose up -d` → `pnpm run db:deploy` → `pnpm run db:seed:sample` → `pnpm run dev` になる。
   - サンプルの会員の値（`demo`・`demo-password-123`、`friend`・`friend-password-123`）は、今の `scripts/api-local-env.sh` と同じ、手元だけのテストの値。seed のファイルに直接書く（環境変数を介す理由が、Go と seed で値を分け合うことだけだったため）。
6. **`docs-site/` は丸ごと消し、`docs/` へ移すものは無い。**
   - 中身は Go の health の 1 本（`reference/health.md`）、Go のエラーの形（`errors.md`）、Go の手元の動かし方とデプロイ（`operations/`）だけで、どれも Go が無くなれば意味が無い。
   - Web の答えの形（LINE の webhook の `{"error":{"code","message"}}` など）は、コードとテスト（`line-webhook-controller.ts`、`e2e/line.spec.ts`）にある。文書には足さない。
   - VuePress のための依存（`vuepress`・`@vuepress/bundler-vite`・`@vuepress/theme-default`・`vue`・`sass-embedded`）を消す。5 つとも、VuePress を入れたコミット（`72b64de`）で足したもので、ほかに使う所は無い。`pnpm-workspace.yaml` の `@parcel/watcher`（sass のファイル監視）の項目も、`pnpm why @parcel/watcher` が空なら消す。
7. **`docs/api-deployment.md` を `docs/deployment.md` に改名し、中身を組み直す。**
   - API はもう無いので、名前の `api-` は嘘になる。中身は今でも「本番への反映」（README の文書の表の説明と同じ）なので、`deployment.md` にする。
   - Go のプロジェクトの節（今の 1〜5）を消す。そのうち Web にも当てはまる「本番の DB の確認」（マイグレーションの確かめと、`ja-x-icu`）は残す。
   - 段階 1〜11b の「マージの前と後」は、もう誰も手順として使わないが、何をいつ変えたかの記録なので消さない。末尾の「移行の記録（段階 1〜12）」にまとめて移し、12a・12b の節を足す。
   - 生きている文書（README・`docs/*.md`・`.env.example`・`scripts/vercel-build.sh`・コードのコメント）のリンクは、すべて新しい名前に直す。`docs/superpowers/` と `docs/releases/` は、その時点の記録なので直さない。
   - `docs/api-local.md` は消す。中身（サンプルの会員の表、LINE を手元で見るときの `LINE_LINK_PREVIEW_MODE`）は、`docs/development.md` の「起動方法」へ移す。
8. **コメントの `services/api/...` の参照は残し、今の時制の嘘だけを直す。**
   - 移した処理のコメントは「Go ではどこで何をしていたか」を、`services/api/...` の道で示している（決めたこと 9 の対応表と同じ役目）。消すと、利用者が昔の処理をたどれなくなる。
   - そのため道は残し、`docs/architecture.md` に、消した Go のファイルの読み方（`git show "$(git log -1 --format=%H -- <道>)^:<道>"`）を 1 か所だけ書く。
   - 「Go API がする」「Web と Go API が使う」のような、今も Go が動いているように読める文だけを、過去の形（「以前の Go API がしていた」）に直す。直す行は Task 3 に並べた。
9. **Go の古い Cookie（`zl_access`・`zl_refresh`）を消す処理は残す。** ログインとログアウトのたびに消す処理（`LEGACY_SESSION_COOKIES`）は、Go の Cookie を持ったままのブラウザーのためにある。11b の切り替えから 30 日（`zl_refresh` の長さ）たつまでは残る Cookie があるので、ここでは消さない。`docs/architecture.md` の「いまの課題」に「2026 年 12 月の末を過ぎたら消してよい」と書く。
10. **`job-hunting-roadmap.md` の、今の構成についての文も直す。** 「Web と Go API を分けた」は、もう事実ではない。話の筋は「Go に分けたが、自分で読めないので Next.js 1 つに戻した」という判断の話に替える（設計書の「目的と理由」と同じ）。直すのは事実の文だけで、計画の組み立ては変えない。
11. **Go の止め方（利用者が行うこと）**は Task 4 の「12a のマージの前と後」に書き、この計画の最後の「利用者が行うこと（順番）」にもまとめる。プロジェクトの削除・環境変数の削除・Vercel と GitHub の設定は、どれも利用者が行う。

## Global Constraints

- コードを書く前に、変えるところに当てはまる `node_modules/next/dist/docs/` の案内を確かめる（`AGENTS.md`）。この計画では、Next.js の API の使い方は変えない（`unstable_rethrow` はそのまま）。
- コメントは英語。画面の文言は変えない。依存は減らすだけ。
- 層：
  - `src/domain/` は domain のほかを import しない。
  - `src/application/` は domain だけを import し、`console` を使わない。
  - Prisma は `src/infrastructure/prisma/` だけ。
- ログには、トークン・秘密・パスワード・ログイン ID・メールアドレス・owner ID を出さない。決まったコードと、エラーの名前だけ。
- `ApiRefreshToken`（`prisma/schema.prisma` の model、`prisma/migrations/`、`DEMO_KEPT_TABLES`、それを言うコメント）は、この計画では **さわらない**（12b）。
- `docs/superpowers/` と `docs/releases/` は直さない（その時点の記録）。`tests/fixtures/` の golden のファイル（`*.json`、`learning-csv/*`）の中身も変えない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps` で `zhuelog-e2e` が無いことを確かめる）。終わったら `pnpm test:e2e:stop`。
- `pnpm install`・`pnpm remove`・`git commit`・`git push` は、サンドボックスの中で失敗したら、サンドボックスの外で行う。

## Review Focus

1. **アプリの動きが変わっていないか。** 失敗の文言とログの形が、Go のクライアントを消したあとも、今の Prisma の経路では同じか。→ Task 1 の `tests/action-state.test.ts`・`tests/load-or.test.ts`・`tests/note-trash-controller.test.ts`・`tests/follow-controller.test.ts`、Task 2 の `pnpm test:regression`（e2e 320 件）。
2. **Go に関わるものが残っていないか。** コードと設定に、Go・docs-site・3 つの環境変数への参照が無いか。→ Task 2 と Task 4 の grep。
3. **消してはいけないものを消していないか。** `ApiRefreshToken` とそのマイグレーション、`tests/fixtures/` の golden、GitHub のコールバックの道 `/github/go`、`goTrimSpace` などの Go の動きを表す名前、`LEGACY_SESSION_COOKIES`、`.gitignore` の `/src/generated/prisma`（今は vuepress のコメントの下にある）。
4. **手元の起動の手順が、書いたとおりに動くか。** → Task 2 の Step 4（`db:seed:sample` を 2 回）。
5. **文書のリンクが切れていないか。** `api-deployment.md`・`api-local.md` への生きたリンクが無いか。→ Task 4 の grep。

---

### Task 1: Web から Go のクライアントを消す

**Files:**

- Delete: `src/infrastructure/go-api/client.ts`、`src/infrastructure/go-api/learning-json.ts`（フォルダーごと無くなる）、`tests/go-api-client.test.ts`、`tests/go-api-learning-json.test.ts`
- Modify:
  - `src/presentation/controllers/action-state.ts`、`src/presentation/controllers/load-or.ts`
  - `attemptGo*` を使う 11 ファイル：`src/presentation/actions/line-link-actions.ts`、`password-account-actions.ts`、`src/presentation/controllers/conversation-controller.ts`、`follow-controller.ts`、`learning-csv-import-controller.ts`、`note-review-controller.ts`、`note-trash-controller.ts`、`practice-round-controller.ts`、`question-save-controller.ts`、`review-answer-controller.ts`（と `git grep -l "attemptGo\|GoAttempt" -- src tests` に出るほか）
  - `src/infrastructure/config/environment.ts`（`goApiUrl` を消す。`isHttpsOrLoopbackUrl` のコメントを FFPF ID の issuer だけにする）
  - `eslint.config.mjs`（`goApiBoundary` と、それを使う `src/app/**` の項目を消す）
  - `tests/architecture.test.ts`（`pages and UI components never import the Go API gateways` を消す。`the import check catches each forbidden form` の見本から `@/infrastructure/go-api/client` の行を消す）
- Test: `tests/action-state.test.ts`、`tests/load-or.test.ts`、`tests/note-trash-controller.test.ts`、`tests/follow-controller.test.ts`、`tests/learning-kind.test.ts`

**Interfaces:**

```ts
// src/presentation/controllers/action-state.ts (after)
export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
};
export const actionSuccess: ActionState;
export const actionUnauthorized: ActionState;
export const noteIdSchema: z.ZodString;
export type ActionResult = { ok: true } | { ok: false; message: string };
export type CallAttempt<T> =
  { ok: true; value: T } | { ok: false; message: string };

// Runs a form action. Next's own errors (the redirect to /signin, notFound)
// are rethrown; the application's forbidden errors (see isForbidden) mean not
// allowed; anything else is logged as `code` and the error's name and gets
// the generic text.
export async function attemptAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState>;

// Runs an action's call and keeps its value. Next's own errors are rethrown;
// the forbidden errors give accountForbiddenMessage; anything else is logged
// as `code` and the error's name and gets the generic text.
export async function attemptCall<T>(
  code: string,
  run: () => Promise<T>,
): Promise<CallAttempt<T>>;
```

- `isForbidden` は、今の 8 つの application の forbidden のエラーだけになる（`GoApiError` の 403 の行を消す）。
- 消すもの：`goFailureMessage`、`userFacingCodes`、`attemptGoResult`、`attemptGo` の第 3 引数 `{ notFound }`、`GoApiError` の import。

```ts
// src/presentation/controllers/load-or.ts (after)
// Loads part of a page. When the load fails, the page shows `fallback` (an
// empty list, or null to leave a card out) and the failure is logged under
// `code` with the error's name only. Next's own errors (the redirect to
// /signin, notFound) are rethrown.
export async function loadOr<T, F>(
  code: string,
  load: () => Promise<T>,
  fallback: F,
): Promise<T | F>;
// What is logged of a failure: its name, never its message.
export function errorName(error: unknown): string;
```

- [ ] **Step 1: テストを直す（先に、消える関数と枝のテストを消し、新しい名前で書く）。**
  - `tests/action-state.test.ts`：
    - `goFailureMessage …` の 2 つのテストを消す。
    - `attemptGoAction turns Go failures into form states` を `attemptAction turns failures into form states` にする。`ReviewForbiddenError` → `actionUnauthorized`、`new Error("db")` → `{status:"error", message: genericErrorMessage}` で、ログは `[["C","Error"]]`。
    - `attemptGoResult …` のテストを消す。
    - `attemptGo returns the value, or a message …` を `attemptCall returns the value, or a message for each failure` にする。`42` → `{ok:true, value:42}`、`LearningForbiddenError` → `{ok:false, message: accountForbiddenMessage}`、`Object.assign(new Error("secret"), {name:"PrismaClientKnownRequestError"})` → 一般の文言で、ログは `[["ISSUE_FAILED","PrismaClientKnownRequestError"]]`（メッセージの `secret` は出ない）。
    - `redirect()` を投げ直すテスト（今あるもの）は、名前だけ替えて残す。
  - `tests/load-or.test.ts`：`loadOr falls back on a Go failure and logs only its codes` を消す。ほかは `GoApiError` の import を消すだけ。
  - `tests/note-trash-controller.test.ts`：
    - `a note action reports a Go failure without details` を `a note action reports a failure without details` にし、`new Error("停止中です")` で、ログは `[["NOTE_TRASH_FAILED","Error"]]`。
    - `a note action gives every retry-later Go failure the generic text` は消す（Go のステータスごとの確かめ）。
    - `a note action treats Go's 403 as not allowed and shows Go's text only for known codes` を `a note action treats the application's refusal as not allowed` にし、`new LearningForbiddenError()` → `unauthorized` だけを確かめる（Go の 400 の文言の確かめは消す）。
    - 500 の `GoApiError` を投げる所は `new Error("db")`。
  - `tests/follow-controller.test.ts`：
    - `a failing follow logs only FOLLOW_FAILED with Go's status and code` → `a failing follow logs only FOLLOW_FAILED and the error's name`。`new Error("down")` で、ログは `["FOLLOW_FAILED","Error"]`。unfollow と share も同じ形。
    - `follow and unfollow treat Go's 403 as not allowed …` → `follow and unfollow treat SocialForbiddenError as not allowed and let Next's redirect through`（`SocialForbiddenError` は `@/application/social/social-network`）。
    - `share treats Go's 403 and LearningForbiddenError …` → `share treats LearningForbiddenError as not allowed …`（`GoApiError` の行を消す）。
  - `tests/learning-kind.test.ts`：
    - `toLearningEntry` の代わりに、`toKind`（`../src/infrastructure/prisma/learning-note-reads`）で種類を確かめる。`the stored kind is carried onto the learning entry` → `toKind("correction")`・`toKind("translation")`。`an unknown stored kind is rejected` → `assert.throws(() => toKind("summary"))`。
    - カードの描画のテストは、`record` を `LearningEntry` の形（`createdAt: new Date("2026-10-05T00:00:00.000Z")`、`hints` は `{id, content, position}`）で直接作って渡す。期待値は変えない。
- [ ] **Step 2: テストが失敗することを確かめる。** `node --import tsx --test tests/action-state.test.ts tests/follow-controller.test.ts tests/note-trash-controller.test.ts tests/load-or.test.ts tests/learning-kind.test.ts` → `attemptAction`・`attemptCall` が無い、ログの形が違う、で FAIL。
- [ ] **Step 3: 実装する。**
  - `action-state.ts`・`load-or.ts` を上の形にする。先頭のコメントの「Go」を消す。
  - 11 ファイルの名前を替える（`attemptGoAction` → `attemptAction`、`attemptGo(` → `attemptCall(`、`GoAttempt` → `CallAttempt`）。コメントの「Go call」「Go failure」も「call」「failure」に直す。
  - `git rm -r src/infrastructure/go-api tests/go-api-client.test.ts tests/go-api-learning-json.test.ts`。
  - `environment.ts`：`goApiUrl` を消す。`isHttpsOrLoopbackUrl` のコメントを「Secrets travel to these URLs (the FFPF ID issuer), so they must be HTTPS unless they are this machine (local development and e2e).」にする。
  - `eslint.config.mjs`：`goApiBoundary` の定数と、`files: ["src/app/**/*.{ts,tsx,mts}"]` の項目を消す（`src/app` の守りは、`tests/architecture.test.ts` のほかのテストと、`componentBoundary` に残る）。
  - `tests/architecture.test.ts`：上の 2 か所。
- [ ] **Step 4: 確かめる。**
  - Step 2 のテストが PASS。
  - `git grep -n "go-api\|GoApiError\|goApi\|goFailureMessage\|attemptGo\|GoAttempt\|userFacingCodes\|GO_API_URL\|API_WEB_PROXY_SECRET" -- src tests e2e eslint.config.mjs` → 何も出ない。
  - `pnpm typecheck && pnpm lint && pnpm test:unit` → PASS（`test:unit` はまだ Go も走らせる。Go のテストが DB 無しで skip になるのは今と同じ）。
- [ ] **Step 5: コミット。** `refactor(web): Go のクライアントと GoApiError の枝を消し、attemptGo の名前から Go を外す`

### Task 2: Go・docs-site・Go のスクリプトと設定を消し、手元の DB を 1 つにする

**Files:**

- Delete（`git rm -r`）：
  - `services/api/`（追跡している 18 ファイル）。`git rm` のあとに、追跡していない残り（`services/api/auth/.claude/` など）も `rm -rf services` で消す（`services/` は空になる）。
  - `docs-site/`（7 ファイル）
  - `compose.api.yaml`、`scripts/api-local.sh`、`scripts/api-local-env.sh`、`scripts/api-smoke.sh`
- Move（`git mv`）：`scripts/api-local-seed.ts` → `scripts/sample-members-seed.ts`
- Modify：
  - `package.json`：スクリプトの `api:db`・`api:db:stop`・`api:dev`・`api:smoke`・`api-docs:dev`・`api-docs:build` を消し、`"db:seed:sample": "tsx scripts/sample-members-seed.ts"` を `db:seed` の次に足す。devDependencies の `vuepress`・`@vuepress/bundler-vite`・`@vuepress/theme-default`・`vue`・`sass-embedded` を `pnpm remove` で消す（`pnpm-lock.yaml` も変わる）。
  - `pnpm-workspace.yaml`：`pnpm why @parcel/watcher` が何も出さなければ、`allowBuilds` の `@parcel/watcher` の 3 行（コメントを含む）を消す。
  - `scripts/test-unit.mjs`：Go の部分を消す（下）。
  - `lefthook.yml`：pre-commit の `gofmt`、pre-push の `go`（とその上の 2 行のコメント）を消す。pre-push の `e2e` の `priority` を 3 にする。
  - `.github/dependabot.yml`：`gomod` の項目と、その上の `# GitHub Actions were removed …` のコメントを消す（npm の項目だけが残る）。
  - `.gitignore`：`# vuepress (docs-site)` と 3 行を消す。そのブロックの最後にある `/src/generated/prisma` は消さず、`# prisma client (generated)` のコメントを付けて残す。
  - `.prettierignore`：`docs-site/.vuepress/*` の 3 行を消す。
  - `tsconfig.json`：`exclude` の `docs-site/.vuepress/*` の 3 行を消す（`node_modules` だけが残る）。
  - `eslint.config.mjs`：`globalIgnores` の `// VuePress output for docs-site.` と 3 行を消す。
  - `scripts/capture-screenshots.mjs`：先頭のコメントの使い方を、手元の DB とサンプルの会員の手順にする（下）。
- Test: 全体（`pnpm test:regression`）

**`scripts/test-unit.mjs` の後の形：**

- `run` と `testFiles` と、SIGINT・SIGTERM で子を止める仕組みは、そのまま残す。
- 最後を次にする（Go の `goDir` と `Promise.all` を消す）。

```js
const files = await testFiles("tests/");
const passed = await run(process.execPath, [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=4",
  ...files,
]);
process.exitCode = !interrupted && passed ? 0 : 1;
```

**`scripts/sample-members-seed.ts` の後の形：**

- 先頭のコメント：「Puts the sample members and the friend's shared notes into the local database for trying the web (docs/development.md). Run through `pnpm run db:seed:sample`; safe to run again (it skips what exists). Local test values only.」
- `import "dotenv/config"` を足し、接続先は `.env` の `DATABASE_URL`。`localhost`・`127.0.0.1`・`[::1]` のほかは、今と同じく `throw new Error("sample-members-seed only writes to a database on this machine.")`。接続文字列は `securePostgresConnectionString`（`../prisma/postgres-connection`）を通す（`prisma/seed.ts` と同じ）。
- 会員の値は、ファイルに直接書く：`{ loginId: "demo", password: "demo-password-123", displayName: "デモ" }`、`{ loginId: "friend", password: "friend-password-123", displayName: "フレンド" }`。`required("API_LOCAL_*")` と、その上の「Members for Go's sign-in …」のコメントを消す。
- `fileName: "api-local-seed"` を `"sample-members-seed"` にする。
- ほかの中身（会員を作る・あれば残す、フレンドの共有のノート 2 件）は変えない。

**`scripts/capture-screenshots.mjs` の先頭のコメント：**

```js
// Captures the README's screenshots (docs/images/) from a running local app
// with the sample members (docs/development.md). Signs in as "demo".
// Usage: docker compose up -d, pnpm run db:deploy, pnpm run db:seed:sample,
//   pnpm run dev, then
//   BASE_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
```

- [ ] **Step 1: 消す・移す・直す。** 上のとおり。依存は `pnpm remove vuepress @vuepress/bundler-vite @vuepress/theme-default vue sass-embedded`（サンドボックスで失敗したら外で）。消す前に `pnpm why vue sass-embedded` で、5 つのほかに使う所が無いことを確かめる（あれば、その依存は残し、報告に書く）。
- [ ] **Step 2: 残りが無いことを確かめる。**
  - `git ls-files services docs-site compose.api.yaml 'scripts/api-*'` → 何も出ない。`ls services` → `No such file or directory`。
  - `git grep -nI -E "go-api|GoApiError|goApi|GO_API_URL|API_WEB_PROXY_SECRET|API_JWT_SECRET|docs-site|vuepress|api-local|api-smoke|api:db|api:dev|api-docs|gofmt|go vet|go test|gomod|\\.go\\b" -- src tests e2e scripts package.json lefthook.yml .github .gitignore .prettierignore tsconfig.json eslint.config.mjs vercel.json .vercelignore 'compose*.yaml' pnpm-workspace.yaml` → 何も出ない。
    - 例外：`src/` と `tests/` のコメントの `services/api/…/*.go` は、Task 3 の判断 8 で残すもの。上の grep の `\.go\b` に出たら、コメントの中の昔の道だけであることを 1 行ずつ確かめ、報告に件数を書く。
  - `grep -n "vuepress\|@vuepress\|\"vue\"\|sass-embedded" package.json` → 何も出ない。`pnpm install --frozen-lockfile` → 成功（lockfile が package.json と合っている）。
- [ ] **Step 3: 全体を確かめる。**
  - `docker ps` で `zhuelog-e2e` が無いことを確かめる。
  - `pnpm test:regression` → PASS。`test:unit` の出力に `go vet`・`go test` が無く、件数は Task 1 のあとと同じ。e2e は 320 件。
  - 終わったら `pnpm test:e2e:stop`。
- [ ] **Step 4: 手元の DB の手順を確かめる。** e2e の DB とは別の、`compose.yaml` の開発用 DB で行う。
  - `docker compose up -d --wait`（`ffpf-zhuelog-postgres`、`127.0.0.1:5432`）。
  - `.env` が無ければ、`DATABASE_URL="postgresql://zhuelog:zhuelog@localhost:5432/zhuelog?schema=public"` だけを入れた一時の環境で実行する（`DATABASE_URL=… pnpm run db:deploy` と `DATABASE_URL=… pnpm run db:seed:sample`）。`.env` があっても、利用者のものは書き換えない。
  - `pnpm run db:seed:sample` を 2 回 → 1 回目は `created member demo`・`created member friend`・`created 2 shared notes for friend`、2 回目は `kept member demo`・`kept member friend`・`kept friend's notes`。
  - `DATABASE_URL=postgresql://x:y@db.example.com/z pnpm run db:seed:sample` → `sample-members-seed only writes to a database on this machine.` で終わる（DB に触れない）。
  - 開発用 DB は止めない（利用者のものかもしれないため）。この Step で `docker compose up` で新しく起動したときだけ、`docker compose stop` で止める。
- [ ] **Step 5: コミット。** `chore: Go（services/api）・docs-site・Go のスクリプトと CI の設定を消し、手元の DB を 1 つにする`

### Task 3: コメントの「今も Go が動いている」書き方を直す

判断 8 のとおり、`services/api/...` の道は残し、今の時制の嘘だけを直す。動きは変えない。

**Files:**（行は 12a の始まりの時点のもの。Task 1・2 のあとにずれていたら、文で探す）

- `prisma/schema.prisma`：
  - :80 `shared by the web app and the Go API.` → `written by the web's sign-in (the retired Go API wrote the same keys).`
  - :188 `saved whole by the Go API` → `saved whole by the web`（文の残りは読んで合わせる）。
  - :208 の `the Go API` を含む文、:266 `so the Go API can pick the due items with an index` → `so the due items can be picked with an index`、:334 `Written by the Go API and the web;` → `Written by the web (and by the retired Go API before stage 8);`。
  - `model ApiRefreshToken` とその上のコメント（:104〜）は **さわらない**（12b）。
- `src/app/error.tsx:10`：`such as when the Go API is down.` → `such as when the database cannot be reached.`
- `src/domain/vocabulary/vocabulary-entry.ts:1`：`as the Go API keeps it.` → `as the vocabulary book stores it.`
- `src/infrastructure/prisma/ai-usage-store.ts:6`：`as the Go API's RecordAIUsage does.` → `as the retired Go API's RecordAIUsage did.`
- `src/infrastructure/prisma/vocabulary-store.ts:86`、`learning-note-reads.ts:131`、`question-store.ts:43`、`conversation-store.ts:18` と `:83`：`the way the Go API's store does` などを `the way the retired Go API's store did` の形にする。
- `src/infrastructure/config/environment.ts:44-45`：`the value Go has today` → `the value Go had`。
- `src/infrastructure/auth/client-address.ts:12`：`must match the Go API's auth.ClientAddress exactly` → `matches the retired Go API's auth.ClientAddress exactly, so the SignInThrottle keys it wrote still count`。
- `src/infrastructure/prisma/password-account-store.ts:7-8`：`ApiRefreshToken is left alone until stage 12 drops it.` は 12b で直すので、ここでは **さわらない**。
- `e2e/demo.spec.ts:62`：`// Go: TestResetWithTheFixture (services/api/demo/demo_db_test.go).` → `// Was Go's TestResetWithTheFixture (services/api/demo/demo_db_test.go, removed in stage 10b).`（11b の最終レビューの指摘）
- `e2e/fixtures/ffpf-oidc-stub.ts:11`：`what the web and services/api/auth/ffpf.go use:` → `what the web's FFPF ID client uses (as Go's services/api/auth/ffpf.go did):`
- `tests/` のヘッダーの `Mirrors services/api/...`（`tests/sign-in.test.ts`、`own-password.test.ts`、`password-account.test.ts`、`ffpf-account.test.ts`、`ffpf-oidc-client.test.ts`、`github-oauth-client.test.ts`、`oauth-http.test.ts`）：`Mirrors` → `Mirrors the retired`（例：`// Mirrors the retired services/api/auth/login_test.go …`）。

- [ ] **Step 1: 直す。** 上のとおり。ほかに、次の grep に出る文を 1 行ずつ読み、今も Go が動いているように読めるものだけを過去の形に直す（道と関数の名前は残す）。
  - `git grep -nI -E "Go API('s)?|the Go API|by Go\b|Go (has|uses|keeps|sends|reads|writes|does|is)\b" -- src tests e2e scripts prisma/schema.prisma`
- [ ] **Step 2: 確かめる。**
  - `git grep -nI -E "as the Go API keeps|the Go API's store does|Go API is down|shared by the web app and the Go API|Go has today" -- src tests e2e prisma/schema.prisma` → 何も出ない。
  - `git diff --stat` で、変えたのがコメントだけであること（`git diff -U0 | grep -E '^[-+][^-+]' | grep -vE '^\s*[-+]\s*(//|#|\*)'` が何も出さない）。
  - `pnpm typecheck && pnpm lint && pnpm test:unit` → PASS。
- [ ] **Step 3: コミット。** `docs(code): コメントの「今も Go が動いている」書き方を、以前の Go の話に直す`

### Task 4: 文書（README・development・deployment への改名・「段階12 のマージの前と後」）

**Files:**

- Rename（`git mv`）：`docs/api-deployment.md` → `docs/deployment.md`
- Delete：`docs/api-local.md`
- Modify：`README.md`、`docs/development.md`、`docs/deployment.md`、`docs/architecture.md`、`docs/features.md`、`docs/roadmap.md`、`docs/job-hunting-roadmap.md`、`docs/dependency-maintenance.md`、`.env.example`、`scripts/vercel-build.sh`（コメントのリンク）

段階 7〜11 の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、Step 2 の grep で探してすべて直す。

- [ ] **Step 1: 直す。**
  - `README.md`：
    - 技術構成の表：
      - 「API」の行を消す。
      - 「DB」の行を短くする：「PostgreSQL 17（本番は Neon）。スキーマとマイグレーションは Prisma 7。Web がすべてのデータを Prisma で読み書きします。Prisma を import してよいのは `src/infrastructure/prisma/` だけです」。
      - 「認証」の行の「ログインは Web が受け持ち、」を「ログインは」にする（受け持つ相手が Web しかないため）。
      - 「テスト」の行から「Go の testing、」を消す。
      - 「デプロイ」の行を「Vercel（Web の 1 プロジェクト）。本番のマイグレーションはビルドで当てます。毎日の定期実行は Vercel Cron（`vercel.json`）」にする。
    - 「設計の要点」の 1 つめ（「Web が DB に触るのは、…だけ」）は、もう全部なので書き直す。見出しは **「DB は Prisma でだけ触る」**。中身は 3 文にする。
      - 画面・Server Action・Route Handler は、`src/composition/` で組み立てた application のユースケースを呼び、DB は `src/infrastructure/prisma/` の store が Prisma で読み書きする。
      - ログイン中の人は、Cookie `zl_session` のトークンから `Session` の行を引いて決める。
      - Prisma を import してよいのは `src/infrastructure/prisma/` だけで、pg と next-auth は import できない。これをテストで確かめている。
    - 「設計の要点」に 1 つ足す：**「Go をやめて Next.js 1 つにした」**。「以前は Go の API を別に持っていましたが、自分で読んで処理を追えるように、2026 年 11 月に機能ごとに Next.js へ移し、Go を消しました（段階 0〜12）。経緯は docs/architecture.md の 2. にあります」。
    - 「品質」：単体テストの件数を、Task 2 の Step 3 の実際の数にする。「Go のテスト（DB を使うものを含む）、」を消す。E2E の「（Go API は起動しません）」を消す。
    - 「手元で動かす」：
      - 前提から「（Go は、…要ります）」を消す。
      - コマンドを `cp .env.example .env`、`pnpm install --frozen-lockfile`、`docker compose up -d`、`pnpm run db:deploy`、`pnpm run db:seed:sample   # サンプルの会員（docs/development.md）`、`pnpm run dev` にする。
      - 「ログインに Go は要らなくなりました…」の文を、「<http://localhost:3000> を開き、ゲストか、サンプルの会員（docs/development.md の表）でログインします」にする。
    - 「文書」の表：`docs/api-local.md` の行を消す。`docs/api-deployment.md` の行を `[docs/deployment.md](docs/deployment.md)`「本番への反映」にする。
  - `docs/development.md`：
    - 「起動方法」：
      - 前提を「Node.js 24 または 26、Docker Desktop」にする。
      - 2 つめの段落から「（段階 11 で、…移りました）」と「Go API は要りません」を消す。
      - コマンドを README と同じ 6 行にする。
      - `.env` の説明の「値は `scripts/api-local-env.sh` にあります」を消す。`DATABASE_URL` の項目は「`.env.example` の値（`docker compose up -d` の開発用 DB）のまま。サンプルの会員は `pnpm run db:seed:sample` で、この DB に入ります」にする。
      - `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` の段落を消す。
      - 「Prisma のマイグレーションと seed は、同じ `DATABASE_URL` を使います（…）」の括弧の中を消す。
      - `docs/api-local.md` から 2 つを移す。
        - 「サンプルのアカウント」の表（`demo`・`friend`。「手元だけのテストの値で、`scripts/sample-members-seed.ts` が作ります。`docker compose down -v` で DB ごと消えます」を添える）。
        - LINE を手元で見るときの `LINE_LINK_PREVIEW_MODE` の段落と、「LINE 連携は手元では使えない（本物のチャネルが要る。e2e は `e2e/line-stub.ts`）」の 1 文。
    - 「## Go API（`services/api`）」の節を消す。
    - 「Playwright E2E」の「Go は要りません。」「Go API は起動しません」の類いを消す（もう比べる相手が無い）。
    - 「コミット・プッシュ前のチェック（Lefthook）」の表は今のままでよいことを確かめる（Go の段は書かれていない）。
    - `api-deployment.md` へのリンクを `deployment.md` にし、節の番号を下の新しい番号に合わせる（「9. FFPF ID でのログイン」→「5. FFPF ID でのログイン」など）。
  - `docs/deployment.md`（改名したもの）。組み立てを次の順にする。
    - 題：`# 本番への反映（Vercel）`。最初の段落：「Web（Next.js）を Vercel の 1 つのプロジェクトで動かします。main にマージすると本番のビルドが走り、未適用の Prisma のマイグレーションを当ててからビルドします（`scripts/vercel-build.sh`）。Web の本番は、Ready になったあと `vercel promote` で切り替えます」。その次に「以前の名前は `docs/api-deployment.md` です（段階 12 で改名）。Go の API のプロジェクトは段階 12 で消しました」の 1 文。
    - 今の 1〜3・5（Go のプロジェクト・OAuth App・環境変数・デプロイと確認）を消す。
    - `## 1. 本番の DB とマイグレーション`：今の「4. 本番の DB の確認」から、Go の話（「マイグレーションの制約：…Go API は別のプロジェクトで…」と、`ApiRefreshToken` を Go が使うという文）を消したもの。`vercel env pull` からの手順と `ja-x-icu` の確かめは残す。`ApiRefreshToken` については「段階 12b で消す（『段階12 のマージの前と後』）」とだけ書く。
    - `## 2. Web の設定`（今の 6.）：
      - ログインの値の表から `GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` の 3 行を消す。
      - 表の説明の「以前 Go に入れていた値と同じ」は「（段階 11 までは Go に入れていた値）」の形に短くする。
      - `OPENAI_API_KEY` の「Go API と同じ値でよい」を消す。
      - 「Web のプレビュー（Preview）」「戻す手順」「e2e」の小節は残し、Go の話を消す。「段階3のマージの前に行うこと」は、末尾の「移行の記録」へ移す。
    - `## 3. LINE 連携`（今の 7.）、`## 4. ChatGPT と話す（会話ノート）`（今の 8.）、`## 5. FFPF ID でのログイン`（今の 9.）、`## 6. デモアカウント`（今の 10.）：番号を替え、中の「Go から移した」の類いは過去の 1 文にまとめる。今の手順として「Go の…を消す」と書いた所は、移行の記録へ移す。
    - `## 7. 運用上の注意`（今の「運用上の注意」）：Go の話が残っていないことを確かめる。
    - `## 移行の記録（段階 1〜12）`：
      - 最初に 2 文：「Go API を Next.js へ移したときの、各段階の本番への反映の手順です。もう使わない手順ですが、何をいつ変えたかの記録として残します（設計：`docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`）」。
      - 今の「段階1のマージの前と後」〜「11b のマージの前と後」と「段階3のマージの前に行うこと」を、中身を変えずにここへ移す。見出しの深さは、`###`（段階）と `####`（10a・11a などの小節）にそろえる。
      - 最後に、下の「段階12 のマージの前と後」を足す。
    - 文書の中の「6. Web の設定」などへの参照を、新しい番号に直す。
  - `docs/deployment.md` の「段階12 のマージの前と後」（新しく書く）：

    ```markdown
    ### 段階12（後片付け）のマージの前と後

    段階 12 は 2 つの PR です。12a は Go のコード・docs-site・Go のクライアントと設定を消します（アプリの動きは変わりません）。12b は `ApiRefreshToken` の表を消すマイグレーションだけです。本番のビルドはマイグレーションを自動で当てるので、12b は Go の Vercel プロジェクトを消したあとにだけマージします。

    #### 12a のマージの前と後

    **マージの前に、利用者が行うこと：**

    1. 11b が本番にあり（`vercel promote` 済み）、Go を 11b の main から出し直してあること（`/v1/auth/password` が 404、`/health` が 200）。
    2. Go の Vercel プロジェクト（`ffpf-zhuelog-api`）の **Settings → Git** で、リポジトリにつながっていないことを確かめる。つながっていれば **Disconnect** する。12a で `services/api/` が無くなるので、つながったままだと、マージのたびに Go のビルドが Root Directory を見つけられずに失敗します（本番の Go には影響しませんが、失敗の通知が届きます）。
    3. マイグレーションは無い。Web の環境変数も、マージの前に変えるものは無い。

    **マージのあと：**

    1. Web の Production のデプロイが Ready になったら、`vercel promote` する。
    2. 確かめる：パスワード・ゲスト・デモ・FFPF ID・GitHub（管理者）でログインでき、学習ノート・単語帳・復習が開ける。Vercel の Web のログに `GoApiError` や `GO_API_URL` が出ない。
    3. Web の Vercel プロジェクトの **Production と Preview** から、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す（もう読まれていません。消したあとの再デプロイは要りません）。
    4. GitHub の Dependabot が開いた Go（`gomod`）の PR があれば、閉じる（12a で Dependabot の Go の設定を消したので、新しくは開きません）。
    5. 手元：`pnpm run api:db:stop -- -v` を **12a を取り込む前に** 実行して、サンプル用の DB（`127.0.0.1:55440`）を消す。取り込んだあとなら `docker volume rm zhuelog-api-local_zhuelog_api_local_data`。`.env` の `DATABASE_URL` を `.env.example` の値に戻し、`docker compose up -d`・`pnpm run db:deploy`・`pnpm run db:seed:sample` を実行する。

    **戻すとき：** Web を 11b のデプロイに戻す（Vercel の **Instant Rollback**）。11b は 3 つの環境変数を読まないので、手順 3 で消したあとでも動きます。

    #### Go の Vercel プロジェクトを消す（利用者が行う。12a のあと、12b の前）

    1. 消してよいかを決める。Go のプロジェクトを消すと、Web を 11b より前（ログインを Go が行っていたころ）に戻すことは、もうできません。11b のあと、ログインに問題が出ていないことを確かめてから消します。
    2. Go のプロジェクトの **Logs** で、`/health`・`/healthz`・`/ping` のほかに呼ばれていないことを確かめる（Web はもう Go を呼びません）。
    3. **Settings → General → Delete Project** で `ffpf-zhuelog-api` を消す。環境変数（`DATABASE_URL`・`GOFLAGS` と、残っていた値）、デプロイ、`ffpf-zhuelog-api.vercel.app` の URL、Neon の **Storage** の Go への接続も一緒に消えます。**Neon のストア（DB）そのものは消しません**（Web が使っています）。
    4. モバイル用の GitHub OAuth App（`GITHUB_MOBILE_*` に入れていたもの）が残っていれば、GitHub の **Settings → Developer settings → OAuth Apps** で消す。Web 用の OAuth App（`AUTH_GITHUB_ID`）は消しません。

    #### 12b のマージの前と後

    **マージの前に、利用者が行うこと：**

    1. 上の「Go の Vercel プロジェクトを消す」が終わっていること。
    2. 12a が本番にあること。

    **マージのあと：**

    1. 本番のビルドが `prisma migrate deploy` で `ApiRefreshToken` を消し、そのあと Web をビルドします。ビルドのあいだ動いている 12a の Web は、この表を使わないので、止まりません。
    2. Ready になったら `vercel promote` する。
    3. 確かめる：「1. 本番の DB とマイグレーション」の手順で `migrate status` が up to date。Neon の SQL Editor で `SELECT to_regclass('"ApiRefreshToken"');` が `NULL`。ログインと、デモのリセット（`/api/cron/demo-reset` が次の朝に 200）が動く。
    4. Preview の Neon のブランチは、プレビューのビルドがマイグレーションを当てないので、表が残ります。害はありません。合わせたいときは「Web のプレビュー（Preview）」の手順で `prisma migrate deploy` を当てます。

    **戻すとき：** Web は 12a のデプロイに戻せます（12a は表を使いません）。表は戻りません。11b より前の Web には戻せません（Go も表も無いため）。
    ```

  - `docs/architecture.md`：
    - 「1. 全体の図」の mermaid から Go の箱と矢印を消す。本文の「Go（`services/api`）は…」の類いを消す。
    - 「2. Web と Go API を分けた理由」を **「2. Go API をやめて Next.js 1 つにした理由」** に書き直す。
      - 以前、ネイティブアプリのために Go の API を分け、Web もそれを呼ぶ形にしたこと（2026 年 10 月）。
      - それをやめた理由（設計書の「目的と理由」：利用者が Go を読んで理解できない）と、進め方（機能ごとに 1 本ずつ、段階 0〜12）。
      - 捨てた案（ログインを先に移す・まとめて書き直す）と、その理由。
      - この計画の最後の「移行全体のまとめ」の「どこを読めば何が分かるか」の表を、ここにも置く。
      - 消した Go のファイルの読み方：「コメントの `services/api/...` は、消した Go のファイルです。`git show "$(git log -1 --format=%H -- <道>)^:<道>"` で、消す直前の中身を読めます」。
    - 「9. テスト」から Go を消す。「10. デプロイ」を Web の 1 プロジェクトにする。
    - 「11. いまの課題」：
      - 「Go が残っている」の項目を消す。
      - 「`LEGACY_SESSION_COOKIES`（Go の古い Cookie を消す処理）は、11b の切り替えから 30 日たてば要らない。2026 年 12 月の末を過ぎたら消してよい」を足す（判断 9）。
  - `docs/features.md`：:20「（段階 11。以前は Go API でした）」はそのままでよい（過去の事実）。ほかに「Go が…する」の今の時制が無いことを確かめる。
  - `docs/roadmap.md`：:28 の「、移行中の Go API（health だけ。段階 12 で消す）」を消す。
  - `docs/job-hunting-roadmap.md`（判断 10）：
    - :22 の「Go のテストファイル 81 本（…）」を消し、単体と E2E の件数を README と同じにする。
    - :31・:61・:112・:122 の「Web と Go API を分けた理由」の類いを、「Go の API に分けたあと、自分で読めないので Next.js 1 つに戻した判断」の話にする。
    - :60 の図の要素から「Go API」を消す。
    - :68 の「単体・Go・E2E の分担」→「単体・E2E の分担」。
    - :69 の「Web と Go で重複している入力の検証、CSV の取り込みの移行」→ 今の課題（`docs/architecture.md` の 11.）から 1 つ。
    - :106 の技術の一覧から「Go」を消す。
  - `docs/dependency-maintenance.md`：:45 の VuePress（docs-site）経由の `sprintf-js` の行を、`pnpm audit` に出なくなっていれば消す。出るなら、経由の説明を、実際の経路（`pnpm why sprintf-js`）に直す。
  - `.env.example`：
    - 1〜3 行目：「段階 11」と、3 つの環境変数の行を消す。1 行目のあとは「# Web がすべての機能を受け持ちます（docs/deployment.md の 2.）。」の 1 行にする。
    - 23 行目の「ローカルでサンプルの会員でログインするときは、…に替えます」を「手元では下の値（`docker compose up -d` の開発用 DB）のまま使い、サンプルの会員は `pnpm run db:seed:sample` で入れます（docs/development.md）」にする。
    - 28 行目の「（Go API と同じ値でよい。…）」の「Go API と同じ値でよい。」を消す。
    - 「# --- services/api（Go API）---」の欄（47〜53 行）を消す（`API_TEST_DATABASE_URL` も）。
    - `docs/api-deployment.md の 6.`・`7.` を `docs/deployment.md の 2.`・`3.` に、「段階10…のマージの前と後」は「移行の記録」に直す。
  - `scripts/vercel-build.sh`：コメントの `docs/api-deployment.md` を `docs/deployment.md` にする。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述とリンク切れを探す。**
  - `git grep -nI -E "api-deployment|api-local|api:db|api:dev|api:smoke|api-docs|docs-site|vuepress|services/api|GO_API_URL|API_WEB_PROXY_SECRET|API_JWT_SECRET|Go API|Go の|Go が|Go を|Go は|golang|go\.mod" -- README.md docs .env.example scripts ':!docs/superpowers' ':!docs/releases'` の結果を 1 行ずつ読む。
    - 残ってよいのは、`docs/deployment.md` の「移行の記録」、`docs/architecture.md` の「2.」、`docs/features.md` と `docs/job-hunting-roadmap.md` の過去の事実だけ。
    - リンクとしての `api-deployment.md`・`api-local.md` は、`docs/deployment.md` の改名の 1 文のほかは 0 件。
  - `git grep -nI "deployment.md" -- README.md docs .env.example scripts src ':!docs/superpowers' ':!docs/releases'` の各リンクの節の番号（「2. Web の設定」など）が、新しい `docs/deployment.md` の見出しと合う。
  - `test -e docs/api-local.md || echo gone` → `gone`。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: Next.js だけの構成に書き直し、デプロイの文書を docs/deployment.md にして段階 12 の手順を足す`

---

## 利用者が行うこと（順番）

1. 11b を本番に出し、Go を 11b の main から出し直す（11b の計画のとおり。済んでいれば飛ばす）。
2. Go の Vercel プロジェクト（`ffpf-zhuelog-api`）の **Settings → Git** で、リポジトリにつながっていないことを確かめる。つながっていれば **Disconnect**（Root Directory `services/api` の設定は、プロジェクトと一緒に消えるので、直さなくてよい）。
3. 12a をマージ → Web の Production が Ready → `vercel promote` → ログインと主な画面を確かめる。
4. Web の Vercel プロジェクトの Production と Preview から、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET` を消す。GitHub の Dependabot の Go の PR があれば閉じる。手元のサンプル用 DB（55440）を消し、`.env` の `DATABASE_URL` を戻す。
5. 11b のあと、ログインに問題が無いことを確かめたら、Go のプロジェクトの Logs を見てから、**Delete Project** で消す（Neon のストアは消さない）。残っていれば、モバイル用の GitHub OAuth App も消す。
6. 12b（下書きの PR）を「ready」にしてマージ → 本番のビルドが `ApiRefreshToken` を消す → `vercel promote` → `migrate status` と `to_regclass` を確かめる。

12a は手順 1・2 のあと、いつマージしてもよい。12b は手順 5 のあとだけ。

## 移行全体のまとめ（利用者へ）

**何が変わったか（段階 0〜12）**

- 以前：Web（Next.js）は画面だけで、データの読み書き・ログイン・チャット・LINE・AI の利用量・cron は、すべて Go の API（`services/api`、約 1.3 万行、API 約 70 本）が持っていた。Web は `src/infrastructure/go-api/` の約 20 個のアダプタで Go を呼び、ログインは Go の JWT と refresh token（`zl_access`・`zl_refresh`）だった。
- いま：アプリは Next.js 1 つ。DB は Prisma で Web が直接読み書きする。ログインは Web のセッション（Cookie `zl_session` のトークンの SHA-256 を `Session` に置く。30 日、ゲストは 24 時間）。LINE の webhook と 2 つの cron（LINE の拾い直し、デモのリセット）も Web の Route Handler と Vercel Cron。Vercel のプロジェクトは 1 つ。
- 変わらないもの：画面の動き、エラーの文言、OAuth のコールバックの URL、DB のデータ（スキーマは `Session` を足し、`ApiRefreshToken` を消しただけ）。e2e（320 件）は、移す前と同じ確かめを Go なしで通している。
- なくしたもの：ネイティブアプリ向けの `/v1/...` の JSON API と JWT（利用者の決定）、Go の CI・フック・Dependabot、API のドキュメントのサイト（docs-site）、`GO_API_URL`・`API_WEB_PROXY_SECRET`・`API_JWT_SECRET`、手元の 2 つめの DB。

**どこを読めば何が分かるか**

| 知りたいこと                        | 読む所                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 層の分け方と、どこから読むか        | `docs/architecture.md`（3. Web の層）、`src/composition/*-container.ts`（機能ごとの組み立て。ここから application と store へたどれる）                                                |
| ログイン中の人の決め方              | `src/composition/current-user.ts` → `src/infrastructure/identity/session-current-user-provider.ts` → `src/infrastructure/prisma/session-store.ts`                                      |
| ログイン・ログアウト                | `src/composition/identity-container.ts`・`sign-in-container.ts` → `src/application/identity/sign-in.ts`。OAuth は `src/infrastructure/auth/`、コールバックは `src/presentation/http/`  |
| ページの門番（Proxy）               | `src/proxy.ts` → `src/presentation/http/session-gate.ts`（Cookie があるかだけを見る）                                                                                                  |
| 学習ノート・ゴミ箱・共有・検索・CSV | `src/application/learning/learning-notes.ts`、`src/infrastructure/prisma/learning-note-reads.ts`・`learning-note-writes.ts`・`learning-csv-import.ts`                                  |
| 復習（FSRS）                        | `src/application/review/review-queue.ts`、`src/domain/review/`、`src/infrastructure/prisma/review-store.ts`                                                                            |
| 練習の記録・質問・チャット          | `src/application/practice/`・`src/application/chat/`、`src/infrastructure/prisma/practice-record-store.ts`・`question-store.ts`・`conversation-store.ts`、`src/app/api/chat/route.ts`  |
| 単語帳・学習ログ・AI の利用量       | `src/application/vocabulary/`・`study-log/`・`ai-usage/`、対応する `src/infrastructure/prisma/*-store.ts`、OpenAI は `src/infrastructure/openai/`                                      |
| フォロー・会員の管理・パスワード    | `src/application/social/social-network.ts`、`src/application/identity/member-accounts.ts`・`own-password.ts`、`src/infrastructure/prisma/social-store.ts`・`password-account-store.ts` |
| LINE と cron                        | `src/app/api/line/webhook/route.ts`・`src/app/api/cron/*/route.ts` → `src/application/line/line-bot.ts`・`src/application/demo/demo-reset.ts`、`vercel.json` の `crons`                |
| 失敗したときの画面の文言とログ      | `src/presentation/controllers/action-state.ts`・`load-or.ts`                                                                                                                           |
| 各段階で Go の何をどこへ移したか    | 各段階の計画（`docs/superpowers/plans/2026-11-16-deprecate-go-stage*.md`）と、`*-go-reference.md`（Go の処理の `file:line` の記録）、各 PR の説明の対応表                              |
| 消した Go のファイルの中身          | コメントの `services/api/...` の道を `git show "$(git log -1 --format=%H -- <道>)^:<道>"` で読む                                                                                       |
| 本番への反映と、各段階で行った手順  | `docs/deployment.md`（「移行の記録（段階 1〜12）」）                                                                                                                                   |
