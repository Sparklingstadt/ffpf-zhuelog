# Go 廃止 段階 10c（Web の `vercel.json` に cron を足す）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LINE の拾い直し（と復習のお知らせ）とデモのリセットを、Web の Vercel プロジェクトの Cron で毎日動かす。Web の `vercel.json` に `crons` を足すだけで、Route Handler（10a の `/api/cron/line-drain`、10b の `/api/cron/demo-reset`）はすでにある。これで段階 10 の 4 つ目の手順が終わる。

**Architecture:** `vercel.json` に Go と同じ時刻の 2 つの cron を書き、それが指すパスと route の決まり（`GET` があり、`maxDuration` があり、proxy の公開ルートである）を unit テストで固定する。

**Tech Stack:** Vercel Cron（`vercel.json` の `crons`）、Next.js 16.4 の Route Handler、`node:test` + `tsx`。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 10、「動いている Go の止め方」の手順 4、決めたこと 10）

**Go の今の動きの参照：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage10-go-reference.md` の §10、§13、§14。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage10b-go-line-removal.md`（この計画は 10b の PR の上に重ねた別の PR。分ける理由は 10a の判断 1）。

**マージの条件：** 10b をマージし、main から Go を再デプロイして、Go の Cron が無くなった（手順 3）**あと** にだけマージする。先に出すと、Go と Web の Cron が同じ朝に並んで動き、`pending` のまま残った文の OpenAI の呼び出しが 2 回になり得る（参照 §20）。

## 設計者の判断（コントローラーが確かめること）

1. **時刻は Go と同じにする。** 拾い直しとお知らせは `0 21 * * *`（毎日 06:00 JST）、デモのリセットは `0 19 * * *`（毎日 04:00 JST）。画面の文言（「朝（6 時ごろ）」「毎晩 04:00」）を変えずに済む。
2. **パスは `/api/cron/` にまとめる。** proxy の公開ルート（10a の判断 8）が `/api/cron/` で始まるパスを通すので、新しい cron もそこに置けば門を直さずに済む。テストで、`vercel.json` のすべての cron のパスが `/api/cron/` で始まり、route があることを確かめる。
3. **`maxDuration` は `vercel.json` に書かず、route に書く。** 10a・10b の route がすでに `export const maxDuration`（60・30）を持つ。Vercel は Next.js のビルドの出力からそれを読む。1 か所にしておくため。
4. **Hobby の Cron の数。** Go のプロジェクトの 2 つは 10b の再デプロイで消えているので、Web に 2 つを足しても数は今と同じ。Vercel の Hobby の Cron は 1 日 1 回までで、決めた時刻の 1 時間のうちのどこかで動くことがある。Go と同じプランなので、今と変わらない。

## Global Constraints

- コメントは英語。画面の文言は変えない。依存を増やさない。
- `vercel.json` の `buildCommand` と `$schema` は変えない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **時刻とパスが Go と同じ朝の動きになるか。** → Task 1 の `the crons are Go's schedules on the web's routes`。
2. **cron のパスが、すべて proxy を通り、`GET` で動くか。** → Task 1 の `every cron path is a public GET route with a maximum duration`。
3. **マージの順番が文書に書いてあるか。** → Task 2。

---

### Task 1: `vercel.json` に cron を足す

**Files:**

- Modify: `vercel.json`
- Test: `tests/vercel-config.test.ts`（新規）

`vercel.json`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "bash scripts/vercel-build.sh",
  "crons": [
    { "path": "/api/cron/line-drain", "schedule": "0 21 * * *" },
    { "path": "/api/cron/demo-reset", "schedule": "0 19 * * *" }
  ]
}
```

- [ ] **Step 1: 失敗するテストを書く。** `tests/vercel-config.test.ts`（`vercel.json` と route のファイルを `readFileSync` で読む）：
  - `the crons are Go's schedules on the web's routes`：`crons` が `[{ path: "/api/cron/line-drain", schedule: "0 21 * * *" }, { path: "/api/cron/demo-reset", schedule: "0 19 * * *" }]` と `deepEqual`。`buildCommand` が `"bash scripts/vercel-build.sh"`。
  - `every cron path is a public GET route with a maximum duration`：それぞれの `path` で、`src/app${path}/route.ts` があり、本文が `/export async function GET\(/`・`/export const maxDuration = \d+;/`・`/export const dynamic = "force-dynamic";/` に合う。`goProxy`（`tests/go-proxy.test.ts` の `harness` と同じ形の偽物）に Cookie なしの `GET <path>` を渡すと、proxy は通す（`x-test-next` が `"1"`）。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/vercel-config.test.ts` → FAIL（`crons` が無い）。
- [ ] **Step 3: `vercel.json` を直す。** 上のとおり。
- [ ] **Step 4: 確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint`、`node_modules/.bin/prettier --check vercel.json` → PASS。`docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 5: コミット。** `feat(web): LINE の拾い直しとデモのリセットを Web の Cron で動かす`

### Task 2: ドキュメント

**Files:** `README.md`、`docs/architecture.md`、`docs/features.md`、`docs/api-deployment.md`、`docs-site/README.md`

- [ ] **Step 1: 直す。**
  - `README.md`：33 行の Go の受け持ちから「定期実行」が消えていることを確かめ、Web の受け持ちに「毎日の定期実行（Vercel Cron）」を足す。
  - `docs/architecture.md`：mermaid の Cron を「Vercel Cron（Web の `vercel.json`）→ `/api/cron/line-drain`・`/api/cron/demo-reset`」に。§7「LINE」の 06:00 の Cron を Web に。
  - `docs/features.md`：デモの「リセット」と LINE の「拾い直し」「復習のお知らせ」の Cron を、Web の `vercel.json` の Cron（06:00 JST・04:00 JST）に。
  - `docs/api-deployment.md`：
    - §7「LINE 連携」と §10「デモアカウント」の Cron の説明を、Web の `vercel.json`（`0 21 * * *`・`0 19 * * *`、UTC）に。Vercel が Cron の呼び出しに `Authorization: Bearer <CRON_SECRET>` を付けるので、Web の Production に `CRON_SECRET` が要ること。`maxDuration` は route に書いてあること（60 秒・30 秒）。Hobby の Cron は 2 つまで・1 日 1 回までで、Web の 2 つで埋まること。
    - 「段階10（LINE とデモのリセットの cron）のマージの前と後」の **手順 4** を書き足す：
      - マージの前：手順 3 が済み、Go の Vercel プロジェクトの **Settings → Cron Jobs** に何も無いこと。Web の Production に `CRON_SECRET` があること。
      - マージのあと：1. Web の Production のデプロイが Ready。2. `vercel promote`（Cron は Production のデプロイで登録される）。3. Web の Vercel プロジェクトの **Settings → Cron Jobs** に `/api/cron/line-drain`（`0 21 * * *`）と `/api/cron/demo-reset`（`0 19 * * *`）が出ることを確かめる。4. 次の朝、Web のログ（Vercel の **Logs**）に `DEMO_RESET_DONE` と `LINE_REVIEW_NOTIFY_SENT` が出ていることを確かめる。待たずに確かめるなら、`curl -i https://ffpf-zhuelog.sparklingstadt.com/api/cron/demo-reset -H "Authorization: Bearer $CRON_SECRET"` が `204`。
      - 戻すとき：この PR を戻すと Web の Cron が消えるだけで、ほかは動く（拾い直しとリセットが止まる）。Go の Cron を戻すなら、先にこの PR を戻してから Go を 10b の前に戻す（2 つの Cron を並べない）。
    - 節のはじめの段落に「段階 10 の 4 つの手順はすべて終わり、Go に残るのはログインだけ」と足す。
  - `docs-site/README.md`：Go の受け持ちの説明に cron が残っていないことを確かめる。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "Cron\|cron" README.md docs/architecture.md docs/features.md docs/api-deployment.md docs/roadmap.md docs-site --include='*.md' | grep -v "\.vuepress/dist"` の結果を 1 行ずつ読み、Go が Cron を動かすと書いた所が、段階 10 の節の歴史の説明のほかに残っていないことを確かめる。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: Cron を Web に移し、段階 10 の切り替えを終えたことを書く`
