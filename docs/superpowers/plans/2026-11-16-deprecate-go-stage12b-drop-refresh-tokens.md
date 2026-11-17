# Go 廃止 段階 12b（`ApiRefreshToken` の表を消す）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go の refresh token の表 `ApiRefreshToken` を、マイグレーションで消す。スキーマの model と、それを言うコードとコメントも一緒に消す。これで Go 廃止の最後の段階が終わる。

**Architecture:** マイグレーション 1 本（`prisma/migrations/20261118090000_drop_api_refresh_token/migration.sql`）と、`prisma/schema.prisma` の `model ApiRefreshToken` の削除。アプリの動きは変わらない（11b から、どのコードもこの表を読み書きしていない）。

**Tech Stack:** Prisma 7（`prisma migrate deploy`、`prisma migrate diff`）、PostgreSQL、`node:test` + `tsx`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 12、「動いている Go の止め方」の「`ApiRefreshToken` を消すマイグレーションは、利用者が Go の Vercel プロジェクトを消したあとにだけ本番に出す」）

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage12a-cleanup.md`（12a。この計画は 12a の PR の上に重ねた PR。分ける理由は 12a の判断 1）。**後：** 無い（Go 廃止はこれで終わり）。

**マージの条件（必ず守る）：** 利用者が Go の Vercel プロジェクト（`ffpf-zhuelog-api`）を消してあること。12a が本番にあること。本番のビルドはマージで `prisma migrate deploy` を当てるので、この PR をマージした時点で本番の表が消える。

## 設計者の判断（コントローラーが確かめること）

1. **この PR は下書き（draft）で作り、利用者が Go を消すまで ready にしない。**
   - PR の題は `chore(db): ApiRefreshToken の表を消す（段階 12b）`。説明の 1 行目は太字で「**Go の Vercel プロジェクトを消してから、マージしてください（docs/deployment.md の『段階12 のマージの前と後』）**」。
   - マイグレーションのファイルの先頭にも、同じ注意を SQL のコメントで書く。マージする人が差分を開いたときに、必ず目に入るようにするため。
   - コントローラーは、この PR を自分で ready にしたり、マージしたりしない（12a の判断 1。順番を守るしかけは、PR の状態と説明だけ）。
2. **マイグレーションは `DROP TABLE "ApiRefreshToken";` の 1 文だけにする。**
   - Prisma が model を消したときに作るものと同じ形にする（`prisma migrate diff` で確かめる）。表のインデックス（`ApiRefreshToken_tokenHash_key`・`_familyId_idx`・`_ownerId_idx`）は、表と一緒に消える。
   - `IF EXISTS` は付けない。表が無いのは、マイグレーションの履歴と DB が食い違っているということで、そのときは止まって気づくほうがよい（`migrate deploy` が失敗すると、本番のビルドも失敗し、今の Web がそのまま動き続ける）。
   - 行を別の所へ写すことはしない。中身は、もう誰も使わない Go の refresh token のハッシュだけで、11b で全員のログインが切れたときから意味が無い。
   - 名前は `20261118090000_drop_api_refresh_token`（今ある最後の `20261117090000_add_session` のあと）。
3. **表を消すときに一緒に直すもの。**
   - `DEMO_KEPT_TABLES`（`src/infrastructure/prisma/demo-reset-store.ts`）の `ApiRefreshToken` の行。`tests/demo-reset-store.test.ts` は、ここに挙げた表がスキーマにあることを確かめるので、model と同じ PR で消す必要がある。
   - 「`ApiRefreshToken` と同じ」と書いたコメント（`Session` の model の説明、`src/domain/identity/session.ts`、`src/infrastructure/auth/session-token.ts`、`src/infrastructure/prisma/session-store.ts`、`src/infrastructure/prisma/password-account-store.ts`）。表が無くなると、何と比べているのか読めなくなるため、「Go の refresh token（段階 12b で消した `ApiRefreshToken`）」の形にする。
   - 古いマイグレーション（`20261020120000_add_api_refresh_tokens`、`20261020130000_add_api_refresh_token_login`）は **消さない**。適用済みのマイグレーションを消すと、`migrate deploy` が履歴の食い違いで止まるため。
4. **戻すとき。** 表は戻らない。Web は 12a のデプロイに戻せる（12a はこの表を使わない）。11b より前の Web には戻せない。これは Go のプロジェクトを消した時点で、すでにそうなっている。

## Global Constraints

- コメントは英語。画面の文言は変えない。依存を増やさない。
- Prisma は `src/infrastructure/prisma/` だけ。
- 適用済みのマイグレーション（`prisma/migrations/` の今ある 1 つ 1 つ）は変えない・消さない。
- `docs/superpowers/` と `docs/releases/` は直さない。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。終わったら `pnpm test:e2e:stop`。
- `git commit` と `git push` は、サンドボックスの外で行う。PR は draft で作る（判断 1）。

## Review Focus

1. **マイグレーションが、スキーマから作ったものと同じで、ほかの表に触れないか。** → Task 1 の `prisma migrate diff`。
2. **`ApiRefreshToken` を読み書きするコードが本当に無いか。** → Task 1 の grep と、e2e（320 件）。
3. **マージの順番の注意が、PR とマイグレーションのファイルと文書の 3 か所にあるか。** → 判断 1、Task 2。

---

### Task 1: マイグレーションと、スキーマ・コードの後片付け

**Files:**

- Create: `prisma/migrations/20261118090000_drop_api_refresh_token/migration.sql`
- Modify:
  - `prisma/schema.prisma`（`model ApiRefreshToken` とその上のコメントを消す。`model Session` のコメントの「what ApiRefreshToken kept」を直す）
  - `src/infrastructure/prisma/demo-reset-store.ts`（`DEMO_KEPT_TABLES` の `ApiRefreshToken` の行）
  - `src/domain/identity/session.ts:1-3`、`src/infrastructure/auth/session-token.ts:20`、`src/infrastructure/prisma/session-store.ts:2`、`src/infrastructure/prisma/password-account-store.ts:7-8`（コメント）
- Test: `tests/demo-reset-store.test.ts`（変えずに通ること）、e2e 全体

**`migration.sql`：**

```sql
-- Stage 12b of the Go retirement: the Go API's refresh tokens. Nothing has
-- read or written this table since stage 11b (sign-in uses "Session").
-- Production builds apply this on merge: merge only after the Go Vercel
-- project is deleted (docs/deployment.md, 段階12 のマージの前と後).

-- DropTable
DROP TABLE "ApiRefreshToken";
```

**コメントの直し方：**

- `schema.prisma` の `Session`：`role/login/sessionVersion are what ApiRefreshToken kept, so the per-request check stays the same.` → `role/login/sessionVersion are what Go's refresh tokens kept (the ApiRefreshToken table, dropped in stage 12b), so the per-request check stayed the same.`
- `session.ts`：`what Go's refresh token kept (services/api/auth/token.go), so the check on every request stays the one ApiRefreshToken had.` → 同じ内容を過去の形で（`… stays the one Go's refresh tokens (ApiRefreshToken, dropped in stage 12b) had.`）。
- `session-token.ts:20`：`SHA-256 in lowercase hex, as ApiRefreshToken.tokenHash.` → `SHA-256 in lowercase hex, as Go's refresh tokens were stored.`
- `session-store.ts:2`：`with what ApiRefreshToken kept` → `with what Go's refresh tokens kept`。
- `password-account-store.ts:7-8`：`ApiRefreshToken is left alone until stage 12 drops it.` の 1 文を消す。

- [ ] **Step 1: テストが今は通ることを確かめ、比べるもとを取っておく（足場）。**
  - `node --import tsx --test tests/demo-reset-store.test.ts` → PASS。
  - `git show HEAD:prisma/schema.prisma > "$TMPDIR/schema-before.prisma"`。
  - `docker ps` で `zhuelog-e2e` が無いことを確かめ、`docker compose -f compose.e2e.yaml up -d --wait`。`DATABASE_URL=postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e` で `node_modules/.bin/prisma migrate deploy`、続けて `node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$TMPDIR/db-diff-before.sql"`。
    - この差は 0 ではない。Prisma のスキーマが表せないもの（`20261116090000_add_entry_search_trgm` の 4 つの式のインデックスなど）が出る。後で同じ差かを比べるために取っておく。
  - `pnpm test:e2e:stop`（DB は tmpfs なので、次に起動すると空から始まる）。
- [ ] **Step 2: model だけを消して、テストが失敗することを確かめる。** `schema.prisma` から `model ApiRefreshToken` を消す → `tests/demo-reset-store.test.ts` の `every owner table is emptied or kept on purpose` が `table ApiRefreshToken is listed for the demo reset but has no ownerId column` で FAIL。
- [ ] **Step 3: 直す。** `DEMO_KEPT_TABLES` の行を消し、マイグレーションを足し、コメントを直す。`pnpm run db:generate`（`src/generated/prisma` から `ApiRefreshToken` が消える。生成物はコミットしない）。
- [ ] **Step 4: マイグレーションがスキーマと合うことを確かめる。**
  - スキーマの差：`node_modules/.bin/prisma migrate diff --from-schema "$TMPDIR/schema-before.prisma" --to-schema prisma/schema.prisma --script` → 出るのは（`Loaded Prisma config from prisma.config.ts.` と空行のほかは）`-- DropTable` と `DROP TABLE "ApiRefreshToken";` の 2 行だけ（新しい `migration.sql` の SQL の部分と同じ）。
  - DB との差：`docker compose -f compose.e2e.yaml up -d --wait`。Step 1 と同じ `DATABASE_URL` で `prisma migrate deploy` → `20261118090000_drop_api_refresh_token` が当たる。続けて `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$TMPDIR/db-diff-after.sql"`。
    - `diff "$TMPDIR/db-diff-before.sql" "$TMPDIR/db-diff-after.sql"` → 何も出ない（このマイグレーションで、スキーマと DB の差は増えも減りもしない）。
    - `grep -c ApiRefreshToken "$TMPDIR/db-diff-after.sql"` → `0`。
  - 同じ DB で `docker compose -f compose.e2e.yaml exec postgres psql -U zhuelog_e2e -d zhuelog_e2e -Atc "SELECT to_regclass('\"ApiRefreshToken\"')"` → 空の行（`NULL`）。
  - 確かめたら `pnpm test:e2e:stop`。
- [ ] **Step 5: 残りが無いことを確かめる。**
  - `git grep -n "ApiRefreshToken" -- . ':!docs/superpowers' ':!docs/releases' ':!prisma/migrations/20261020*'` → 出るのは、新しいマイグレーションと、上で直した「dropped in stage 12b」のコメントと、Task 2 で直す文書だけ。
  - `grep -rn "ApiRefreshToken" src/generated` → 何も出ない。
- [ ] **Step 6: 全体を確かめる。** `pnpm test:regression` → PASS（e2e 320 件。e2e は新しいマイグレーションまで当てた DB で走る）。終わったら `pnpm test:e2e:stop`。
- [ ] **Step 7: コミット。** `chore(db): Go の refresh token の表 ApiRefreshToken を消す`

### Task 2: 文書の仕上げ

**Files:** `docs/deployment.md`、`docs/architecture.md`、`docs/development.md`、`README.md`（必要なら）

- [ ] **Step 1: 直す。**
  - `docs/deployment.md`：
    - 「1. 本番の DB とマイグレーション」の「`ApiRefreshToken` は段階 12b で消す」を「段階 12b で消しました」にする。
    - 「段階12 のマージの前と後」の 12b の節が、この PR の中身（マイグレーションの名前 `20261118090000_drop_api_refresh_token`、確かめの SQL）と合うことを確かめる。合わなければ直す。
  - `docs/architecture.md`：認証の節やデータの説明に `ApiRefreshToken` が今もあるように読める所があれば、「段階 12b で消した」にする。「2.」の移行の話の最後に「段階 12b で `ApiRefreshToken` を消し、Go の移行が終わった（2026 年 11 月）」を足す。
  - `docs/development.md`：「データ構造」の節に `ApiRefreshToken` が出ていれば消す。
  - `README.md`：`ApiRefreshToken` が出ていれば消す（12a の時点では出ていない見込み）。
- [ ] **Step 2: 確かめる。**
  - `git grep -nI "ApiRefreshToken\|refresh token\|リフレッシュ" -- README.md docs .env.example ':!docs/superpowers' ':!docs/releases'` の結果を 1 行ずつ読む。残ってよいのは、`docs/deployment.md` の「移行の記録」と、`docs/architecture.md` の「2.」の過去の話だけ。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: ApiRefreshToken を消して Go の移行が終わったことを書く`
- [ ] **Step 4: PR を draft で作る（コントローラー）。** 題と説明の 1 行目は判断 1 のとおり。説明には、12a の計画の「利用者が行うこと（順番）」の手順 5・6 を貼る。ready にもマージにもしない。

## 利用者が行うこと

1. 12a の計画の「利用者が行うこと（順番）」の手順 1〜5（12a のマージと promote、Web の 3 つの環境変数の削除、Go の Vercel プロジェクトの削除）が終わっていることを確かめる。
2. この PR を ready にしてマージする。本番のビルドが `ApiRefreshToken` を消してから Web をビルドする。
3. Ready になったら `vercel promote`。`docs/deployment.md` の「1. 本番の DB とマイグレーション」の手順で `migrate status` が up to date、Neon の SQL Editor で `SELECT to_regclass('"ApiRefreshToken"');` が `NULL` であることを確かめる。
4. 次の朝、デモのリセット（`/api/cron/demo-reset`）が 200 で動いたことを、Vercel の Cron のログで確かめる。
