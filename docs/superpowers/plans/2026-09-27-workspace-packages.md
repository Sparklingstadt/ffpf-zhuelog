# ワークスペース化と Typle 連携のプラグイン化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リポジトリを npm workspaces のモノレポにし、`@ffpf-zhuelog/core`（domain・application 層と連携の約束事）と `@ffpf-zhuelog/typle-integrate-plugin`（Typle 連携）に分け、Typle の画面・API をアプリ側の共通の連携画面に置き換える。

**Architecture:** Next.js アプリはルート（`@ffpf-zhuelog/web`）に残し、`packages/core` と `packages/typle-integrate-plugin` を TypeScript のまま読み込む。プラグインは学習ノートから「表示内容」と「出力ファイル」を作る純粋な処理だけを持ち、画面・API・管理者の確認はアプリ側の共通部分が担当する。core はプラグインを知らず、プラグインの登録は `src/composition/integration-container.ts` だけで行う。

**Tech Stack:** npm workspaces（npm 11 / Node 22 以上）、Next.js 16（App Router・Turbopack）、TypeScript 6、node:test + tsx、Playwright、ESLint 9（flat config）、Prisma 7

**Spec:** `docs/superpowers/specs/2026-09-27-workspace-packages-design.md`

## Global Constraints

- パッケージ名：ルート `@ffpf-zhuelog/web`、`@ffpf-zhuelog/core`、`@ffpf-zhuelog/typle-integrate-plugin`。すべて `"private": true`
- ルートの `workspaces` は `["packages/*"]`。ワークスペースへの依存のバージョン指定は `"*"`
- 内部パッケージのバージョンは `0.0.0` 固定。ルートのバージョンは最後に `0.8.0` → `0.9.0`
- core の依存は `"zod": "^4.6.5"` だけ。パッケージの `package.json` に `"type"` を書かない
- パッケージはビルドしない。`next.config.ts` に `transpilePackages` を追加しない
- URL：画面 `/integrations/<id>`、出力 API `/api/integrations/<id>/export`。旧 URL（`/typle`・`/api/typle/export`）からの転送は作らない
- 連携 ID：`^[a-z0-9]+(?:-[a-z0-9]+)*$` に一致し、40文字以内
- 出力ファイル名：`^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$`
- 読み込む学習ノートの上限：`INTEGRATION_SOURCE_LIMIT = 1000`（新しい順）。画面に出す項目は先頭20件
- API の応答文言：403 `管理者としてログインしてください。`／404 `連携が見つかりません。`／422 `出力できる項目がありません。`／503 `出力ファイルを作成できませんでした。`
- 画面の読み込み失敗の文言：`学習ノートを読み込めませんでした。データベースの状態を確認してください。`
- API のすべての応答に `Cache-Control: private, no-store`。200 のときは `Content-Type: <contentType>` と `Content-Disposition: attachment; filename="<fileName>"`
- ログ：`console.error("INTEGRATION_EXPORT_UNAVAILABLE", id)`、`console.error("INTEGRATION_PREVIEW_UNAVAILABLE", id)`。例外の内容や学習ノートは出さない
- コミットメッセージの最後に空行と `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける
- push と PR の作成は、Task 8 の後でユーザーに確認してから行う（この計画の中では行わない）

## 作業環境の注意（このセッション固有）

- 作業場所は worktree `/Users/liyur_qie/ffpf-zhuelog/.claude/worktrees/workspace-packages`（ブランチ `worktree-workspace-packages`）。コマンドはすべてここで実行する。main のチェックアウト `/Users/liyur_qie/ffpf-zhuelog` には触らない（`cd` で移動しない、`git -C` を使わない）。
- worktree の安全確認が、複雑なコマンド（入り組んだパイプや `node -e` での `require` など）を拒否することがある。拒否されたら、単純なコマンドに分けて実行する。
- 一時ファイルの置き場所（以下 `SCRATCH`）：`/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad`。シェルの状態は次のコマンドに引き継がれないので、使うコマンドの先頭で毎回 `SCRATCH='…'` を設定する。
- npm はホームのキャッシュ（`~/.npm`）に書き込めない。`npm install`・`npm ci`・`npm audit` には必ず `--cache "$SCRATCH/npm-cache"` を付ける。
- worktree には `.env` がない。`prisma generate` と `npm run build` の前に、CI と同じダミー値 `DATABASE_URL='postgresql://zhuelog:zhuelog@127.0.0.1:5432/zhuelog?schema=public'` を設定する。ユーザーの `.env` はコピーしない。
- main の ESLint は、Task 1 の変更が main に入るまで worktree の生成ファイルも検査してしまう。`npm run typecheck`・`npm run build`・`npm run test:e2e`・`git commit`（コミット前のフックが型チェックを実行する）の後は、次へ進む前に `rm -rf .next` を実行する。E2E の後は `rm -rf .next playwright-report test-results` を実行する。
- コミット前のフック（Lefthook）は、ステージしたファイルを Prettier で整形してから Lint と型チェックを実行する。次の5ファイルは、もともと Prettier の整形どおりになっていないため、Task 1 のコミットで整形の差分が出る（想定どおり）：`src/application/learning/use-cases/get-daily-entry.ts`、`src/application/learning/use-cases/list-daily-entries.ts`、`src/application/learning/use-cases/list-log-dates.ts`、`src/domain/learning/repositories/learning-entry-repository.ts`（いずれも core への移動後のパス）、`src/infrastructure/persistence/prisma/mappers/learning-entry-mapper.ts`。`npx prettier --write .` のようにリポジトリ全体を整形しない。
- E2E（`npm run test:e2e`）は Docker を使う。`compose.e2e.yaml` のプロジェクト名は `zhuelog-e2e` で固定、ポートは `127.0.0.1:55439`（DB）と `127.0.0.1:3107`（アプリ）。実行前に、main 側の E2E が動いていないことを確かめる（Task 1 の手順を参照）。サンドボックスで Docker に接続できない場合は、サンドボックスを無効にせず、止めてユーザーに相談する。
- 作業前の基準：`npm run test:unit` は TypeScript 70件と Go のテストがすべて成功、`npm run typecheck`・`npm run lint` も成功。

## Review Focus

仕様が求めているのに、どのタスクのテストも確かめていない入力のうち、使う人に影響しやすいもの5つ（影響しやすい順）。それぞれのテストを、担当するタスクに追加してある。

1. 未ログインで存在しない連携 ID（`/integrations/unknown`）を開いたら、戻り先なしの `/signin` へ移動する。ゲストなら `/` へ移動する。どちらも 404 を出さず、連携があるかどうかを見せない（Task 6 の E2E）
2. 未ログインで `/integrations/typle` を開いたら、`/signin?callbackUrl=/integrations/typle` へ移動し、ログイン後に同じ画面へ戻れる（Task 6 の E2E）
3. ゲストのホームには、連携のボタン（`Typle用リスト`）が表示されない（Task 6 の E2E）
4. 抽出語が21語あるとき、画面は20件だけを表示し、`先頭20件を表示しています。出力には全21件が含まれます。` を出す。ダウンロードには21語すべてが入る（Task 6 の E2E）
5. 画面の表示中に DB の読み込みが失敗したら、固定のエラー文言と空の一覧を返し、ログにはエラーコードと連携 ID だけを出す（Task 6 の単体テスト）

## ファイル構成

| 状態 | パス                                                                                              | 役割                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 変更 | `package.json`                                                                                    | 名前 `@ffpf-zhuelog/web`、`workspaces`、パッケージへの依存、バージョン 0.9.0 |
| 変更 | `package-lock.json`                                                                               | ワークスペースの反映（差分だけ更新）                                         |
| 変更 | `eslint.config.mjs`                                                                               | `.claude/**` の除外（Task 1）、パッケージ間の依存ルール（Task 7）            |
| 変更 | `scripts/test-unit.mjs`                                                                           | `packages/*/tests/*.test.ts` も実行する                                      |
| 移動 | `src/domain/` → `packages/core/src/domain/`                                                       | ドメイン層（`typle/` を除く）                                                |
| 移動 | `src/application/` → `packages/core/src/application/`                                             | アプリケーション層                                                           |
| 新規 | `packages/core/package.json`                                                                      | core の公開入口（`exports`）                                                 |
| 新規 | `packages/core/src/integration/integration.ts`                                                    | 連携の型と `defineIntegration`                                               |
| 新規 | `packages/core/src/integration/registry.ts`                                                       | `createIntegrationRegistry`（ID の検査・一覧・検索）                         |
| 新規 | `packages/core/src/integration/index.ts`                                                          | `@ffpf-zhuelog/core/integration` の入口                                      |
| 新規 | `packages/core/src/application/integration/use-cases/integration-source-limit.ts`                 | 読み込む学習ノートの上限                                                     |
| 新規 | `packages/core/src/application/integration/use-cases/preview-integration.ts`                      | 表示内容を作るユースケース                                                   |
| 新規 | `packages/core/src/application/integration/use-cases/export-integration.ts`                       | 出力ファイルを作るユースケース（ファイル名の検査）                           |
| 新規 | `packages/core/tests/integration-registry.test.ts`                                                | 登録のテスト                                                                 |
| 新規 | `packages/core/tests/integration-use-cases.test.ts`                                               | ユースケースのテスト                                                         |
| 新規 | `packages/typle-integrate-plugin/package.json`                                                    | プラグインの公開入口                                                         |
| 移動 | `src/domain/typle/typle-word-list.ts` → `packages/typle-integrate-plugin/src/typle-word-list.ts`  | Typle の単語抽出と JSON 生成                                                 |
| 新規 | `packages/typle-integrate-plugin/src/index.ts`                                                    | 連携の定義（default export）                                                 |
| 移動 | `tests/typle-word-list.test.ts` → `packages/typle-integrate-plugin/tests/typle-word-list.test.ts` | 単語抽出のテスト                                                             |
| 新規 | `packages/typle-integrate-plugin/tests/typle-integration.test.ts`                                 | 連携の定義のテスト                                                           |
| 変更 | `src/**`・`tests/**` の import                                                                    | `@/domain/…` などを `@ffpf-zhuelog/core/…` に                                |
| 新規 | `src/composition/integration-container.ts`                                                        | プラグインの登録とユースケースの組み立て                                     |
| 新規 | `src/presentation/controllers/integration-export-controller.ts`                                   | 出力 API の処理                                                              |
| 新規 | `src/app/api/integrations/[id]/export/route.ts`                                                   | 出力 API のルート                                                            |
| 新規 | `tests/fixtures/sample-integration.ts`                                                            | アプリ側テスト用の連携                                                       |
| 新規 | `tests/integration-export.test.ts`                                                                | 出力 API のテスト                                                            |
| 新規 | `src/presentation/presenters/integration-preview-presenter.ts`                                    | 画面用の読み込みと失敗時の扱い                                               |
| 新規 | `tests/integration-preview.test.ts`                                                               | 画面用の読み込みのテスト                                                     |
| 新規 | `src/app/integrations/[id]/page.tsx`                                                              | 共通の連携画面                                                               |
| 変更 | `src/app/page.tsx`                                                                                | 連携のボタンを登録済みの連携から作る                                         |
| 削除 | `src/app/typle/page.tsx`、`src/app/api/typle/export/route.ts`                                     | 旧 Typle 画面・API                                                           |
| 変更 | `e2e/learning.spec.ts`                                                                            | 新しい URL と追加の確認                                                      |
| 変更 | `README.md`                                                                                       | パッケージ構成・依存のルール・連携の追加手順・Typle の URL                   |
| 新規 | `docs/releases/v0.9.0.md`                                                                         | リリースノート                                                               |

---

### Task 1: ワークスペース化（動作は変えない）

**Files:**

- Modify: `eslint.config.mjs`、`package.json`、`package-lock.json`、`scripts/test-unit.mjs`
- Create: `packages/core/package.json`、`packages/typle-integrate-plugin/package.json`、`packages/typle-integrate-plugin/src/index.ts`
- Move: `src/domain/`・`src/application/` → `packages/core/src/`、`src/domain/typle/typle-word-list.ts` → `packages/typle-integrate-plugin/src/`、`tests/typle-word-list.test.ts` → `packages/typle-integrate-plugin/tests/`
- Modify（import の書き換え）：`src/**` と `tests/*.test.ts` のうち、`domain`・`application` を参照しているファイル（対象は Step 7 の `grep` が列挙する。旧 Typle 画面・API の2ファイルはプラグインを向ける）

**Interfaces:**

- Consumes: なし
- Produces:
  - `@ffpf-zhuelog/core/domain/<path>` と `@ffpf-zhuelog/core/application/<path>`（`<path>` は旧 `src/domain/`・`src/application/` 以下のパスから `.ts` を除いたもの）
  - `@ffpf-zhuelog/typle-integrate-plugin` の名前付き export：`extractTypleWords(entries: LearningEntry[]): TypleWord[]`、`createTypleExport(entries: LearningEntry[], createdAt?: Date): TypleExport`、型 `TypleWord`・`TypleWordList`・`TypleExport`（旧 Typle 画面・API のための一時的なもの。Task 6 で削除する）

- [ ] **Step 1: `.claude/` の中が今は Lint の対象になっていることを確かめる**

```bash
SCRATCH='/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad'
mkdir -p .claude/probe
printf 'export const probe = 1;\n' > .claude/probe/probe.ts
npx eslint . --format json -o "$SCRATCH/eslint-probe.json"
grep -c '/.claude/probe/probe.ts' "$SCRATCH/eslint-probe.json"
```

Expected: 最後の行が `1`（検査されている）

- [ ] **Step 2: ESLint の除外に `.claude/**` を追加する**

`eslint.config.mjs` の `globalIgnores([...])` を次のようにする。

```js
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Claude Code worktrees live here. Git skips them via .git/info/exclude,
    // which ESLint does not read.
    ".claude/**",
  ]),
```

- [ ] **Step 3: 除外されたことを確かめて、確認用のファイルを消す**

```bash
SCRATCH='/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad'
npx eslint . --format json -o "$SCRATCH/eslint-probe.json"
grep -c '/.claude/probe/probe.ts' "$SCRATCH/eslint-probe.json"
rm -rf .claude/probe
```

Expected: `grep` の結果が `0`

- [ ] **Step 4: パッケージの `package.json` を作る**

`packages/core/package.json`：

```json
{
  "name": "@ffpf-zhuelog/core",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./domain/*": "./src/domain/*.ts",
    "./application/*": "./src/application/*.ts"
  },
  "dependencies": {
    "zod": "^4.6.5"
  }
}
```

`packages/typle-integrate-plugin/package.json`：

```json
{
  "name": "@ffpf-zhuelog/typle-integrate-plugin",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@ffpf-zhuelog/core": "*"
  }
}
```

- [ ] **Step 5: ルートの `package.json` を変える**

- `"name": "ffpf-zhuelog",` を `"name": "@ffpf-zhuelog/web",` にする
- `"private": true,` の次の行に `"workspaces": ["packages/*"],` を追加する
- `dependencies` の `"@ai-sdk/react": "^4.0.110",` の次に、次の2行を追加する（アルファベット順）

```json
    "@ffpf-zhuelog/core": "*",
    "@ffpf-zhuelog/typle-integrate-plugin": "*",
```

- [ ] **Step 6: ファイルを移動する（Typle を先に、空になったフォルダーを消してから層ごと）**

```bash
mkdir -p packages/core/src packages/typle-integrate-plugin/src packages/typle-integrate-plugin/tests
git mv src/domain/typle/typle-word-list.ts packages/typle-integrate-plugin/src/typle-word-list.ts
git mv tests/typle-word-list.test.ts packages/typle-integrate-plugin/tests/typle-word-list.test.ts
rmdir src/domain/typle
git mv src/domain packages/core/src/domain
git mv src/application packages/core/src/application
ls src
```

Expected: `ls src` に `domain` と `application` がない

- [ ] **Step 7: import を書き換える（この順番で実行する）**

旧 Typle 画面・API の import を先にプラグインへ向ける（次の一括置換で core を向いてしまうのを防ぐ）。

```bash
perl -pi -e 's#"\@/domain/typle/typle-word-list"#"\@ffpf-zhuelog/typle-integrate-plugin"#g' src/app/typle/page.tsx src/app/api/typle/export/route.ts
```

プラグインの単語抽出とそのテスト（`LearningEntry` 型は Task 4 で `@ffpf-zhuelog/core/integration` に変える）：

```bash
perl -pi -e 's#"\@/domain/#"\@ffpf-zhuelog/core/domain/#g' packages/typle-integrate-plugin/src/typle-word-list.ts
perl -pi -e 's#"\.\./src/domain/typle/typle-word-list"#"../src/typle-word-list"#g; s#"\.\./src/domain/#"\@ffpf-zhuelog/core/domain/#g' packages/typle-integrate-plugin/tests/typle-word-list.test.ts
```

core の中の `@/` を相対パスにする。`@/` を使っているファイルは、すべて `src/` から3階層下（`domain/learning/repositories/`、`application/<機能>/ports/`、`application/<機能>/use-cases/`）にあるので、`../../../` に置き換えればよい。

```bash
grep -rl '"@/' packages/core/src | xargs perl -pi -e 's#"\@/#"../../../#g'
```

アプリ（`src`・`e2e`・`scripts`・`prisma`）の `@/domain/…`・`@/application/…`：

```bash
grep -rlE '"@/(domain|application)/' src e2e scripts prisma | xargs perl -pi -e 's#"\@/(domain|application)/#"\@ffpf-zhuelog/core/$1/#g'
```

アプリ内の相対パス（`../../domain/…` など。`src/composition/practice-container.ts`、`src/infrastructure/theme/browser-theme-store.ts`、`src/infrastructure/practice/*.ts` の3ファイル、`src/presentation/controllers/personal-correction-controller.ts`）：

```bash
grep -rlE '"(\.\./)+(domain|application)/' src | xargs perl -pi -e 's#"(?:\.\./)+(domain|application)/#"\@ffpf-zhuelog/core/$1/#g'
```

`tests/` の `../src/domain/…`・`../src/application/…`：

```bash
grep -rlE '"\.\./src/(domain|application)/' tests | xargs perl -pi -e 's#"\.\./src/(domain|application)/#"\@ffpf-zhuelog/core/$1/#g'
```

- [ ] **Step 8: 書き換え漏れがないことを確かめる**

```bash
grep -rnE '"@/(domain|application)/|"(\.\./)+(src/)?(domain|application)/' src tests e2e scripts prisma
grep -rn '"@/' packages
grep -rn 'src/domain\|domain/typle' src tests packages
```

Expected: 3つとも何も出力しない（`packages/core/src` の中の `../../../domain/…` のような相対パスは対象外。2つ目の `grep` は `"@/` だけを探す）

- [ ] **Step 9: プラグインの入口を作る（旧 Typle 画面・API 用の一時的な export）**

`packages/typle-integrate-plugin/src/index.ts`：

```ts
// Named exports keep the legacy /typle routes working until the shared
// integration screen replaces them.
export {
  createTypleExport,
  extractTypleWords,
  type TypleExport,
  type TypleWord,
  type TypleWordList,
} from "./typle-word-list";
```

- [ ] **Step 10: lockfile を更新し、差分が想定どおりか確かめる**

```bash
SCRATCH='/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad'
npm install --ignore-scripts --cache "$SCRATCH/npm-cache"
git diff --stat package-lock.json
git diff package-lock.json
ls -l node_modules/@ffpf-zhuelog
```

Expected:

- `node_modules/@ffpf-zhuelog/core` が `../../packages/core` への、`node_modules/@ffpf-zhuelog/typle-integrate-plugin` が `../../packages/typle-integrate-plugin` へのシンボリックリンクになっている
- lockfile の差分は、ルートの `name`（`@ffpf-zhuelog/web`）、`workspaces`、`dependencies` の2行、`"node_modules/@ffpf-zhuelog/core"`・`"node_modules/@ffpf-zhuelog/typle-integrate-plugin"`（`"link": true`）、`"packages/core"`・`"packages/typle-integrate-plugin"` のエントリーだけ（合計で数十行程度）
- ほかの依存のバージョンやエントリーが大量に変わっていたら、ここで止めてユーザーに報告する

- [ ] **Step 11: テストの実行スクリプトがパッケージのテストを見つけられないことを確かめる**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 67`（移動した `typle-word-list` の3件が実行されていない）

- [ ] **Step 12: `scripts/test-unit.mjs` をパッケージのテストにも対応させる**

`const workerOnly = process.argv.includes("--worker");` の直前に、次の関数を追加する。

```js
async function testFiles(dir) {
  const names = await readdir(new URL(`../${dir}`, import.meta.url)).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return names
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `${dir}${name}`);
}
```

`if (!workerOnly) {` の直後にある次の部分を、

```js
const files = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => `tests/${name}`);
```

次のように置き換える。

```js
// App tests live in tests/; each workspace package keeps its own tests/.
const packages = (
  await readdir(new URL("../packages/", import.meta.url), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const files = [
  ...(await testFiles("tests/")),
  ...(
    await Promise.all(
      packages.map((name) => testFiles(`packages/${name}/tests/`)),
    )
  ).flat(),
];
```

- [ ] **Step 13: 単体テストがすべて通ることを確かめる**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|^ok|FAIL"
```

Expected: `ℹ tests 70`、`ℹ pass 70`、`ℹ fail 0`、Go の `ok  	github.com/Sparklingstadt/ffpf-zhuelog/workers/line`

- [ ] **Step 14: 型チェック・Lint・ビルドを通す**

```bash
npm run typecheck
npm run lint
DATABASE_URL='postgresql://zhuelog:zhuelog@127.0.0.1:5432/zhuelog?schema=public' npm run build
rm -rf .next
```

Expected: 3つとも成功（ビルドはワークスペースのパッケージを `transpilePackages` なしで変換できることの確認も兼ねる）

- [ ] **Step 15: E2E を通す（動作が変わっていないことの確認）**

main 側の E2E が動いていないことを確かめる。

```bash
docker ps --filter name=zhuelog-e2e --format '{{.Names}}'
lsof -nP -iTCP:3107 -sTCP:LISTEN
```

Expected: 2つとも何も出力しない。何か出たら、main で E2E を実行中の可能性があるので止めてユーザーに相談する。

```bash
npm run test:e2e
npm run test:e2e:stop
rm -rf .next playwright-report test-results
```

Expected: すべてのテストが passed（旧 URL `/typle` のままで通る）

- [ ] **Step 16: コミットする**

```bash
git add -A
git status --short
git commit -q -F - <<'EOF'
refactor: move domain and application layers into @ffpf-zhuelog/core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
git log --oneline -1
```

Expected: `git status --short` に出るのはこのタスクのファイルだけ。コミット前のフックが成功する（上の5ファイルの整形差分はフックが自動で取り込む）

---

### Task 2: core — 連携の約束事と登録

**Files:**

- Create: `packages/core/src/integration/integration.ts`、`packages/core/src/integration/registry.ts`、`packages/core/src/integration/index.ts`
- Modify: `packages/core/package.json`（`exports` に `./integration`）
- Test: `packages/core/tests/integration-registry.test.ts`

**Interfaces:**

- Consumes: `LearningEntry`・`LearningHint`（`packages/core/src/domain/learning/entities/learning-entry.ts`）
- Produces（`@ffpf-zhuelog/core/integration`）：
  - `type IntegrationText = { navLabel: string; title: string; description: string; listTitle: string; listDescription: string; sources: string[]; emptyMessage: string; downloadLabel: string }`
  - `type IntegrationStat = { label: string; value: string }`
  - `type IntegrationItem = { title: string; description: string; lang?: string }`
  - `type IntegrationPreview = { stats: IntegrationStat[]; items: IntegrationItem[] }`
  - `type IntegrationFile = { fileName: string; contentType: string; body: string }`
  - `type Integration = { id: string; text: IntegrationText; preview(entries: readonly LearningEntry[]): IntegrationPreview; export(entries: readonly LearningEntry[]): IntegrationFile | null }`
  - `function defineIntegration(integration: Integration): Integration`
  - `type IntegrationRegistry = { list(): readonly Integration[]; find(id: string): Integration | undefined }`
  - `function createIntegrationRegistry(integrations: readonly Integration[]): IntegrationRegistry`（不正な ID は `Invalid integration id: "<id>"`、重複は `Duplicate integration id: "<id>"` の `Error` を投げる）
  - 型 `LearningEntry`・`LearningHint` の再公開

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/tests/integration-registry.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIntegrationRegistry,
  defineIntegration,
  type Integration,
} from "@ffpf-zhuelog/core/integration";

function sample(id: string): Integration {
  return defineIntegration({
    id,
    text: {
      navLabel: "Sample list",
      title: "Sample title",
      description: "Sample description",
      listTitle: "Sample items",
      listDescription: "Sample item description",
      sources: ["Sample source"],
      emptyMessage: "Nothing yet",
      downloadLabel: "Download sample",
    },
    preview: () => ({ stats: [], items: [] }),
    export: () => null,
  });
}

test("registry lists integrations in registration order and finds them by id", () => {
  const first = sample("sample");
  const second = sample("other-2");
  const registry = createIntegrationRegistry([first, second]);
  assert.deepEqual(registry.list(), [first, second]);
  assert.equal(registry.find("sample"), first);
  assert.equal(registry.find("other-2"), second);
});

test("registry rejects ids that are not lowercase URL slugs of at most 40 characters", () => {
  for (const id of [
    "",
    "Sample",
    "-sample",
    "sample-",
    "sam--ple",
    "has space",
    "snake_case",
    "日本語",
    "a".repeat(41),
  ]) {
    assert.throws(
      () => createIntegrationRegistry([sample(id)]),
      /Invalid integration id/,
      JSON.stringify(id),
    );
  }
  assert.doesNotThrow(() =>
    createIntegrationRegistry([sample("a".repeat(40))]),
  );
});

test("registry rejects duplicate ids", () => {
  assert.throws(
    () => createIntegrationRegistry([sample("sample"), sample("sample")]),
    /Duplicate integration id/,
  );
});

test("registry returns undefined for unknown and prototype-like ids", () => {
  const registry = createIntegrationRegistry([sample("sample")]);
  for (const id of [
    "unknown",
    "SAMPLE",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    assert.equal(registry.find(id), undefined, id);
  }
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --import tsx --test packages/core/tests/integration-registry.test.ts`
Expected: FAIL（`Package subpath './integration' is not defined by "exports"`）

- [ ] **Step 3: 型と `defineIntegration` を書く**

`packages/core/src/integration/integration.ts`：

```ts
import type { LearningEntry } from "../domain/learning/entities/learning-entry";

export type IntegrationText = {
  navLabel: string; // Home button label
  title: string; // Page heading
  description: string; // Text under the heading
  listTitle: string; // Heading of the item list card
  listDescription: string; // Description of the item list card
  sources: string[]; // Chips that explain where items come from
  emptyMessage: string; // Shown when there are no items
  downloadLabel: string; // Download button label
};

export type IntegrationStat = { label: string; value: string };

export type IntegrationItem = {
  title: string;
  description: string;
  lang?: string; // BCP 47 language of the title, e.g. "zh-Hans"
};

export type IntegrationPreview = {
  stats: IntegrationStat[];
  items: IntegrationItem[];
};

export type IntegrationFile = {
  fileName: string;
  contentType: string;
  body: string;
};

// Plugins only transform learning notes (newest first). The app owns the
// screen, the API, and the admin check, so plugins never see requests,
// sessions, or the database.
export type Integration = {
  id: string;
  text: IntegrationText;
  preview(entries: readonly LearningEntry[]): IntegrationPreview;
  // null means there is nothing to export.
  export(entries: readonly LearningEntry[]): IntegrationFile | null;
};

export function defineIntegration(integration: Integration): Integration {
  return integration;
}
```

- [ ] **Step 4: 登録を書く**

`packages/core/src/integration/registry.ts`：

```ts
import type { Integration } from "./integration";

// Ids become URL path segments (/integrations/<id>), so keep them to
// lowercase, hyphen-separated slugs.
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 40;

export type IntegrationRegistry = {
  list(): readonly Integration[];
  find(id: string): Integration | undefined;
};

export function createIntegrationRegistry(
  integrations: readonly Integration[],
): IntegrationRegistry {
  const byId = new Map<string, Integration>();
  for (const integration of integrations) {
    const { id } = integration;
    if (id.length > MAX_ID_LENGTH || !ID.test(id))
      throw new Error(`Invalid integration id: ${JSON.stringify(id)}`);
    if (byId.has(id))
      throw new Error(`Duplicate integration id: ${JSON.stringify(id)}`);
    byId.set(id, integration);
  }
  const list = Object.freeze([...byId.values()]);
  return {
    list: () => list,
    find: (id) => byId.get(id),
  };
}
```

- [ ] **Step 5: 入口を書き、`exports` に追加する**

`packages/core/src/integration/index.ts`：

```ts
export type {
  LearningEntry,
  LearningHint,
} from "../domain/learning/entities/learning-entry";
export {
  defineIntegration,
  type Integration,
  type IntegrationFile,
  type IntegrationItem,
  type IntegrationPreview,
  type IntegrationStat,
  type IntegrationText,
} from "./integration";
export {
  createIntegrationRegistry,
  type IntegrationRegistry,
} from "./registry";
```

`packages/core/package.json` の `exports` を次のようにする。

```json
  "exports": {
    "./domain/*": "./src/domain/*.ts",
    "./application/*": "./src/application/*.ts",
    "./integration": "./src/integration/index.ts"
  },
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: `node --import tsx --test packages/core/tests/integration-registry.test.ts`
Expected: PASS（4件）

- [ ] **Step 7: 型チェックと Lint を通してコミットする**

```bash
npm run typecheck
npm run lint
rm -rf .next
git add -A
git commit -q -F - <<'EOF'
feat: add integration contract and registry to core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

Expected: 型チェック・Lint・コミット前のフックが成功

---

### Task 3: core — 連携のユースケース

**Files:**

- Create: `packages/core/src/application/integration/use-cases/integration-source-limit.ts`、`packages/core/src/application/integration/use-cases/preview-integration.ts`、`packages/core/src/application/integration/use-cases/export-integration.ts`
- Test: `packages/core/tests/integration-use-cases.test.ts`

**Interfaces:**

- Consumes: `Integration`・`IntegrationFile`（Task 2）、`LearningEntryRepository`（`packages/core/src/domain/learning/repositories/learning-entry-repository.ts`。`listRecent(limit: number): Promise<{ entries: LearningEntry[]; total: number }>`）
- Produces:
  - `INTEGRATION_SOURCE_LIMIT = 1000`（`@ffpf-zhuelog/core/application/integration/use-cases/integration-source-limit`）
  - `class PreviewIntegration { constructor(repository: LearningEntryRepository); execute(integration: Integration): Promise<{ sourceCount: number; total: number; preview: IntegrationPreview }> }`（`…/use-cases/preview-integration`）
  - `class ExportIntegration { constructor(repository: LearningEntryRepository); execute(integration: Integration): Promise<IntegrationFile | null> }`（`…/use-cases/export-integration`。ファイル名が不正なら `Error("INVALID_INTEGRATION_FILE_NAME")` を投げる）

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/tests/integration-use-cases.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import type { LearningEntryRepository } from "@ffpf-zhuelog/core/domain/learning/repositories/learning-entry-repository";
import {
  defineIntegration,
  type IntegrationFile,
  type LearningEntry,
} from "@ffpf-zhuelog/core/integration";

const entry: LearningEntry = {
  id: "entry-1",
  originalText: "我去学校。",
  correctedText: "我去了学校。",
  pinyin: "Wǒ qù le xuéxiào.",
  createdAt: new Date("2026-09-25T00:00:00.000Z"),
  hints: [],
};

function fakeRepository(entries: LearningEntry[], total = entries.length) {
  const limits: number[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("unused repository method");
  };
  const repository: LearningEntryRepository = {
    async listRecent(limit) {
      limits.push(limit);
      return { entries, total };
    },
    importBatch: unused,
    listCreatedAt: unused,
    listByDate: unused,
    getByDateAndNumber: unused,
  };
  return { repository, limits };
}

function sample(file: IntegrationFile | null) {
  const received: (readonly LearningEntry[])[] = [];
  const integration = defineIntegration({
    id: "sample",
    text: {
      navLabel: "Sample list",
      title: "Sample title",
      description: "Sample description",
      listTitle: "Sample items",
      listDescription: "Sample item description",
      sources: [],
      emptyMessage: "Nothing yet",
      downloadLabel: "Download sample",
    },
    preview(entries) {
      received.push(entries);
      return {
        stats: [{ label: "notes", value: String(entries.length) }],
        items: [],
      };
    },
    export(entries) {
      received.push(entries);
      return file;
    },
  });
  return { integration, received };
}

test("preview reads the newest 1,000 notes, passes them to the plugin, and reports counts", async () => {
  const { repository, limits } = fakeRepository([entry], 5);
  const { integration, received } = sample(null);
  const result = await new PreviewIntegration(repository).execute(integration);
  assert.deepEqual(limits, [1000]);
  assert.deepEqual(received, [[entry]]);
  assert.deepEqual(result, {
    sourceCount: 1,
    total: 5,
    preview: { stats: [{ label: "notes", value: "1" }], items: [] },
  });
});

test("export returns the plugin file, or null when there is nothing to export", async () => {
  const file = {
    fileName: "sample-v1.2_final.json",
    contentType: "application/json; charset=utf-8",
    body: "{}",
  };
  const { repository, limits } = fakeRepository([entry]);
  assert.deepEqual(
    await new ExportIntegration(repository).execute(sample(file).integration),
    file,
  );
  assert.equal(
    await new ExportIntegration(repository).execute(sample(null).integration),
    null,
  );
  assert.deepEqual(limits, [1000, 1000]);
});

test("export rejects file names that could break Content-Disposition", async () => {
  const { repository } = fakeRepository([entry]);
  const exportFile = (fileName: string) =>
    new ExportIntegration(repository).execute(
      sample({ fileName, contentType: "text/plain", body: "" }).integration,
    );
  for (const fileName of [
    "",
    '"quoted".json',
    ".hidden",
    "dir/file.json",
    "dir\\file.json",
    "line\r\nbreak.json",
    "space name.json",
    "単語.json",
    `${"a".repeat(96)}.json`,
  ]) {
    await assert.rejects(
      exportFile(fileName),
      /INVALID_INTEGRATION_FILE_NAME/,
      JSON.stringify(fileName),
    );
  }
  await assert.doesNotReject(exportFile(`${"a".repeat(95)}.json`));
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --import tsx --test packages/core/tests/integration-use-cases.test.ts`
Expected: FAIL（`Cannot find module` で `export-integration` が見つからない）

- [ ] **Step 3: 上限の定数を書く**

`packages/core/src/application/integration/use-cases/integration-source-limit.ts`：

```ts
// Same window as the pre-plugin Typle bridge: the newest 1,000 notes.
export const INTEGRATION_SOURCE_LIMIT = 1000;
```

- [ ] **Step 4: 表示内容のユースケースを書く**

`packages/core/src/application/integration/use-cases/preview-integration.ts`：

```ts
import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import type { Integration } from "../../../integration/integration";
import { INTEGRATION_SOURCE_LIMIT } from "./integration-source-limit";

export class PreviewIntegration {
  constructor(private readonly repository: LearningEntryRepository) {}

  async execute(integration: Integration) {
    const { entries, total } = await this.repository.listRecent(
      INTEGRATION_SOURCE_LIMIT,
    );
    return {
      sourceCount: entries.length,
      total,
      preview: integration.preview(entries),
    };
  }
}
```

- [ ] **Step 5: 出力のユースケースを書く**

`packages/core/src/application/integration/use-cases/export-integration.ts`：

```ts
import type { LearningEntryRepository } from "../../../domain/learning/repositories/learning-entry-repository";
import type {
  Integration,
  IntegrationFile,
} from "../../../integration/integration";
import { INTEGRATION_SOURCE_LIMIT } from "./integration-source-limit";

// The name goes inside a quoted Content-Disposition parameter.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

export class ExportIntegration {
  constructor(private readonly repository: LearningEntryRepository) {}

  async execute(integration: Integration): Promise<IntegrationFile | null> {
    const { entries } = await this.repository.listRecent(
      INTEGRATION_SOURCE_LIMIT,
    );
    const file = integration.export(entries);
    if (file && !FILE_NAME.test(file.fileName))
      throw new Error("INVALID_INTEGRATION_FILE_NAME");
    return file;
  }
}
```

- [ ] **Step 6: テストが通ることを確かめる**

Run: `node --import tsx --test packages/core/tests/integration-use-cases.test.ts`
Expected: PASS（3件）

- [ ] **Step 7: 型チェックと Lint を通してコミットする**

```bash
npm run typecheck
npm run lint
rm -rf .next
git add -A
git commit -q -F - <<'EOF'
feat: add integration preview and export use cases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

---

### Task 4: Typle プラグインの連携定義

**Files:**

- Modify: `packages/typle-integrate-plugin/src/typle-word-list.ts`（import 元と `readonly`）、`packages/typle-integrate-plugin/src/index.ts`（default export を追加）、`packages/typle-integrate-plugin/tests/typle-word-list.test.ts`（`LearningEntry` の import 元）
- Test: `packages/typle-integrate-plugin/tests/typle-integration.test.ts`

**Interfaces:**

- Consumes: `defineIntegration`・`LearningEntry`（Task 2）
- Produces: `@ffpf-zhuelog/typle-integrate-plugin` の default export（`Integration`。`id` は `"typle"`）。名前付き export（Task 1）は Task 6 まで残す

- [ ] **Step 1: 失敗するテストを書く**

`packages/typle-integrate-plugin/tests/typle-integration.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { LearningEntry } from "@ffpf-zhuelog/core/integration";
import typle from "@ffpf-zhuelog/typle-integrate-plugin";

function entry(overrides: Partial<LearningEntry> = {}): LearningEntry {
  return {
    id: "entry-1",
    originalText: "这个菜很好吃。",
    correctedText: "这道菜很好吃。",
    pinyin: "Zhè dào cài hěn hǎochī.",
    createdAt: new Date("2026-09-25T00:00:00.000Z"),
    hints: [{ id: "hint-1", content: "料理を数える量詞は「道」", position: 0 }],
    ...overrides,
  };
}

test("Typle integration keeps the existing id and screen copy", () => {
  assert.equal(typle.id, "typle");
  assert.deepEqual(typle.text, {
    navLabel: "Typle用リスト",
    title: "Typle用の復習リスト",
    description:
      "添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。",
    listTitle: "自動生成された単語リスト",
    listDescription:
      "表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。",
    sources: ["ヒントの「引用語」", "添削で追加された語"],
    emptyMessage:
      "抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。",
    downloadLabel: "Typle互換JSONをダウンロード",
  });
});

test("preview lists extracted words with their annotations", () => {
  const preview = typle.preview([entry()]);
  assert.deepEqual(preview.stats, [
    { label: "抽出した復習語", value: "1語" },
    { label: "Typleでの入力", value: "中国語IME" },
  ]);
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].title, "道");
  assert.equal(preview.items[0].lang, "zh-Hans");
  assert.match(preview.items[0].description, /料理を数える量詞/);
  assert.match(preview.items[0].description, /拼音: Zhè dào cài/);
});

test("export returns null when no Typle words can be extracted", () => {
  const plain = entry({
    originalText: "我很好。",
    correctedText: "我很好。",
    hints: [],
  });
  assert.deepEqual(typle.preview([plain]).items, []);
  assert.equal(typle.export([plain]), null);
});

test("export produces the typle-r v1 JSON download", () => {
  const file = typle.export([entry()]);
  assert.ok(file);
  assert.equal(file.fileName, "ffpf-zhuelog-typle-words.json");
  assert.equal(file.contentType, "application/json; charset=utf-8");
  const payload = JSON.parse(file.body);
  assert.equal(payload.version, 1);
  assert.equal(payload.lists[0].id, "ffpf-zhuelog-review");
  assert.deepEqual(
    payload.lists[0].words.map((word: { display: string }) => word.display),
    ["道"],
  );
  assert.equal(file.body, JSON.stringify(payload, null, 2));
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --import tsx --test packages/typle-integrate-plugin/tests/typle-integration.test.ts`
Expected: FAIL（default export がないため `Cannot read properties of undefined (reading 'id')`）

- [ ] **Step 3: 単語抽出が公開の入口だけを使い、`readonly` を受け取るようにする**

`packages/typle-integrate-plugin/src/typle-word-list.ts` を次のように変える（処理は変えない）。

- 1行目：`import type { LearningEntry } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";` → `import type { LearningEntry } from "@ffpf-zhuelog/core/integration";`
- `export function extractTypleWords(entries: LearningEntry[]): TypleWord[] {` → `export function extractTypleWords(entries: readonly LearningEntry[]): TypleWord[] {`
- `createTypleExport` の引数 `entries: LearningEntry[],` → `entries: readonly LearningEntry[],`

`packages/typle-integrate-plugin/tests/typle-word-list.test.ts` の `import type { LearningEntry } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";` を `import type { LearningEntry } from "@ffpf-zhuelog/core/integration";` にする。

- [ ] **Step 4: 連携を定義する**

`packages/typle-integrate-plugin/src/index.ts` の全体を次のようにする。

```ts
import { defineIntegration } from "@ffpf-zhuelog/core/integration";

import { createTypleExport, extractTypleWords } from "./typle-word-list";

// Named exports keep the legacy /typle routes working until the shared
// integration screen replaces them.
export {
  createTypleExport,
  extractTypleWords,
  type TypleExport,
  type TypleWord,
  type TypleWordList,
} from "./typle-word-list";

export default defineIntegration({
  id: "typle",
  text: {
    navLabel: "Typle用リスト",
    title: "Typle用の復習リスト",
    description:
      "添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。",
    listTitle: "自動生成された単語リスト",
    listDescription:
      "表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。",
    sources: ["ヒントの「引用語」", "添削で追加された語"],
    emptyMessage:
      "抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。",
    downloadLabel: "Typle互換JSONをダウンロード",
  },
  preview(entries) {
    const words = extractTypleWords(entries);
    return {
      stats: [
        { label: "抽出した復習語", value: `${words.length}語` },
        { label: "Typleでの入力", value: "中国語IME" },
      ],
      items: words.map((word) => ({
        title: word.display,
        description: word.annotation,
        lang: "zh-Hans",
      })),
    };
  },
  export(entries) {
    const payload = createTypleExport(entries);
    if (payload.lists[0].words.length === 0) return null;
    return {
      fileName: "ffpf-zhuelog-typle-words.json",
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(payload, null, 2),
    };
  },
});
```

- [ ] **Step 5: プラグインのテストが通ることを確かめる**

Run: `node --import tsx --test packages/typle-integrate-plugin/tests/typle-integration.test.ts packages/typle-integrate-plugin/tests/typle-word-list.test.ts`
Expected: PASS（4件 + 3件）

- [ ] **Step 6: 全体の確認とコミット**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run typecheck
npm run lint
rm -rf .next
git add -A
git commit -q -F - <<'EOF'
feat: define the Typle integration plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

Expected: `ℹ tests 81`、`ℹ fail 0`

---

### Task 5: 出力 API（コントローラー・ルート・登録）

**Files:**

- Create: `src/composition/integration-container.ts`、`src/presentation/controllers/integration-export-controller.ts`、`src/app/api/integrations/[id]/export/route.ts`、`tests/fixtures/sample-integration.ts`
- Test: `tests/integration-export.test.ts`

**Interfaces:**

- Consumes: `createIntegrationRegistry`・`Integration`・`IntegrationFile`（Task 2）、`PreviewIntegration`・`ExportIntegration`（Task 3）、Typle プラグインの default export（Task 4）、`getCurrentAdminUser(): Promise<AuthenticatedUser | null>`（`src/composition/identity-container.ts`）、`PrismaLearningEntryRepository`（`src/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository.ts`）
- Produces:
  - `integrations: IntegrationRegistry` と `integrationUseCases: { previewIntegration: PreviewIntegration; exportIntegration: ExportIntegration }`（`@/composition/integration-container`）
  - `handleIntegrationExport(id: string, dependencies: { isAdmin: () => Promise<boolean>; findIntegration: (id: string) => Integration | undefined; exportIntegration: Pick<ExportIntegration, "execute"> }): Promise<Response>`
  - `sampleIntegration: Integration`（`tests/fixtures/sample-integration.ts`。`id` は `"sample"`）

- [ ] **Step 1: テスト用の連携を作る**

`tests/fixtures/sample-integration.ts`：

```ts
import { defineIntegration } from "@ffpf-zhuelog/core/integration";

export const sampleIntegration = defineIntegration({
  id: "sample",
  text: {
    navLabel: "Sample list",
    title: "Sample title",
    description: "Sample description",
    listTitle: "Sample items",
    listDescription: "Sample item description",
    sources: [],
    emptyMessage: "Nothing yet",
    downloadLabel: "Download sample",
  },
  preview: () => ({ stats: [], items: [] }),
  export: () => null,
});
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/integration-export.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { IntegrationFile } from "@ffpf-zhuelog/core/integration";
import { handleIntegrationExport } from "../src/presentation/controllers/integration-export-controller";
import { sampleIntegration } from "./fixtures/sample-integration";

type Dependencies = Parameters<typeof handleIntegrationExport>[1];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    isAdmin: async () => true,
    findIntegration: (id) => (id === "sample" ? sampleIntegration : undefined),
    exportIntegration: {
      execute: async (): Promise<IntegrationFile | null> => null,
    },
    ...overrides,
  };
}

test("export API rejects non-admins before looking up the integration", async () => {
  let lookedUp = false;
  const response = await handleIntegrationExport(
    "sample",
    dependencies({
      isAdmin: async () => false,
      findIntegration: () => {
        lookedUp = true;
        return sampleIntegration;
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "管理者としてログインしてください。",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(lookedUp, false);
});

test("export API returns 404 for unknown integrations", async () => {
  const response = await handleIntegrationExport("unknown", dependencies());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "連携が見つかりません。" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("export API returns 422 when there is nothing to export", async () => {
  const response = await handleIntegrationExport("sample", dependencies());
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "出力できる項目がありません。",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("export API sends the file as a private download", async () => {
  const file = {
    fileName: "sample.json",
    contentType: "application/json; charset=utf-8",
    body: '{"ok":true}',
  };
  const response = await handleIntegrationExport(
    "sample",
    dependencies({ exportIntegration: { execute: async () => file } }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="sample.json"',
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), '{"ok":true}');
});

test("export API hides failures and logs only the code and integration id", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args);
  });
  for (const execute of [
    async (): Promise<IntegrationFile | null> => {
      throw new Error("password=secret 我很好");
    },
    async (): Promise<IntegrationFile | null> => ({
      fileName: "sample.json",
      contentType: "text/plain\r\nX-Injected: yes",
      body: "",
    }),
  ]) {
    const response = await handleIntegrationExport(
      "sample",
      dependencies({ exportIntegration: { execute } }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "出力ファイルを作成できませんでした。",
    });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(logged, [
    ["INTEGRATION_EXPORT_UNAVAILABLE", "sample"],
    ["INTEGRATION_EXPORT_UNAVAILABLE", "sample"],
  ]);
});
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `node --import tsx --test tests/integration-export.test.ts`
Expected: FAIL（`Cannot find module` で `integration-export-controller` が見つからない）

- [ ] **Step 4: コントローラーを書く**

`src/presentation/controllers/integration-export-controller.ts`：

```ts
import type { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import type { Integration } from "@ffpf-zhuelog/core/integration";

const noStore = { "Cache-Control": "private, no-store" };

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStore });
}

export async function handleIntegrationExport(
  id: string,
  dependencies: {
    isAdmin: () => Promise<boolean>;
    findIntegration: (id: string) => Integration | undefined;
    exportIntegration: Pick<ExportIntegration, "execute">;
  },
) {
  if (!(await dependencies.isAdmin()))
    return error("管理者としてログインしてください。", 403);
  const integration = dependencies.findIntegration(id);
  if (!integration) return error("連携が見つかりません。", 404);

  try {
    const file = await dependencies.exportIntegration.execute(integration);
    if (!file) return error("出力できる項目がありません。", 422);
    return new Response(file.body, {
      headers: {
        ...noStore,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Type": file.contentType,
      },
    });
  } catch {
    // Log only the code and the public integration id: never learning notes,
    // plugin errors, or database details.
    console.error("INTEGRATION_EXPORT_UNAVAILABLE", integration.id);
    return error("出力ファイルを作成できませんでした。", 503);
  }
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `node --import tsx --test tests/integration-export.test.ts`
Expected: PASS（5件）

- [ ] **Step 6: 登録を書く**

`src/composition/integration-container.ts`：

```ts
import { ExportIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/export-integration";
import { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import { createIntegrationRegistry } from "@ffpf-zhuelog/core/integration";
import typleIntegration from "@ffpf-zhuelog/typle-integrate-plugin";

import { PrismaLearningEntryRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-learning-entry-repository";

// The only place in the app that knows which plugins are installed.
export const integrations = createIntegrationRegistry([typleIntegration]);

const repository = new PrismaLearningEntryRepository();

export const integrationUseCases = {
  previewIntegration: new PreviewIntegration(repository),
  exportIntegration: new ExportIntegration(repository),
};
```

- [ ] **Step 7: ルートを書く**

`src/app/api/integrations/[id]/export/route.ts`：

```ts
import { getCurrentAdminUser } from "@/composition/identity-container";
import {
  integrationUseCases,
  integrations,
} from "@/composition/integration-container";
import { handleIntegrationExport } from "@/presentation/controllers/integration-export-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationExportContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  { params }: IntegrationExportContext,
) {
  const { id } = await params;
  return handleIntegrationExport(id, {
    isAdmin: async () => Boolean(await getCurrentAdminUser()),
    findIntegration: (integrationId) => integrations.find(integrationId),
    exportIntegration: integrationUseCases.exportIntegration,
  });
}
```

- [ ] **Step 8: 全体の確認とコミット**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run typecheck
npm run lint
rm -rf .next
git add -A
git commit -q -F - <<'EOF'
feat: serve integration exports from a shared API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

Expected: `ℹ tests 86`、`ℹ fail 0`。型チェックが Next.js のルートの型（`params` が `Promise`）も検証する

---

### Task 6: 共通画面・ホームのボタン・旧 Typle 画面の削除・E2E

**Files:**

- Create: `src/presentation/presenters/integration-preview-presenter.ts`、`src/app/integrations/[id]/page.tsx`
- Modify: `src/app/page.tsx`、`packages/typle-integrate-plugin/src/index.ts`、`e2e/learning.spec.ts`
- Delete: `src/app/typle/page.tsx`、`src/app/api/typle/export/route.ts`
- Test: `tests/integration-preview.test.ts`、`e2e/learning.spec.ts`

**Interfaces:**

- Consumes: `integrations`・`integrationUseCases`（Task 5）、`PreviewIntegration`（Task 3）、`Integration`・`IntegrationPreview`（Task 2）、`sampleIntegration`（Task 5）、`getCurrentViewerUser(): Promise<AuthenticatedUser | null>`（`role` は `"admin"` か `"guest"`）
- Produces:
  - `type IntegrationPreviewResult = { sourceCount: number; total: number; preview: IntegrationPreview; error: string | null }`
  - `loadIntegrationPreview(integration: Integration, previewIntegration: Pick<PreviewIntegration, "execute">): Promise<IntegrationPreviewResult>`
  - 画面 `/integrations/[id]`

- [ ] **Step 1: 画面用の読み込みの、失敗するテストを書く（Review Focus 5）**

`tests/integration-preview.test.ts`：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadIntegrationPreview } from "../src/presentation/presenters/integration-preview-presenter";
import { sampleIntegration } from "./fixtures/sample-integration";

test("preview loader returns the use case result without an error", async () => {
  const loaded = {
    sourceCount: 2,
    total: 9,
    preview: {
      stats: [{ label: "notes", value: "2" }],
      items: [{ title: "道", description: "量詞", lang: "zh-Hans" }],
    },
  };
  assert.deepEqual(
    await loadIntegrationPreview(sampleIntegration, {
      execute: async () => loaded,
    }),
    { ...loaded, error: null },
  );
});

test("preview loader hides database failures and logs only the code and id", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args);
  });
  const result = await loadIntegrationPreview(sampleIntegration, {
    execute: async () => {
      throw new Error("password=secret 我很好");
    },
  });
  assert.deepEqual(result, {
    sourceCount: 0,
    total: 0,
    preview: { stats: [], items: [] },
    error:
      "学習ノートを読み込めませんでした。データベースの状態を確認してください。",
  });
  assert.deepEqual(logged, [["INTEGRATION_PREVIEW_UNAVAILABLE", "sample"]]);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --import tsx --test tests/integration-preview.test.ts`
Expected: FAIL（`Cannot find module` で `integration-preview-presenter` が見つからない）

- [ ] **Step 3: 画面用の読み込みを書く**

`src/presentation/presenters/integration-preview-presenter.ts`：

```ts
import type { PreviewIntegration } from "@ffpf-zhuelog/core/application/integration/use-cases/preview-integration";
import type {
  Integration,
  IntegrationPreview,
} from "@ffpf-zhuelog/core/integration";

export type IntegrationPreviewResult = {
  sourceCount: number;
  total: number;
  preview: IntegrationPreview;
  error: string | null;
};

export async function loadIntegrationPreview(
  integration: Integration,
  previewIntegration: Pick<PreviewIntegration, "execute">,
): Promise<IntegrationPreviewResult> {
  try {
    return { ...(await previewIntegration.execute(integration)), error: null };
  } catch {
    // Same rule as the export API: only the code and the public id.
    console.error("INTEGRATION_PREVIEW_UNAVAILABLE", integration.id);
    return {
      sourceCount: 0,
      total: 0,
      preview: { stats: [], items: [] },
      error:
        "学習ノートを読み込めませんでした。データベースの状態を確認してください。",
    };
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --import tsx --test tests/integration-preview.test.ts`
Expected: PASS（2件）

- [ ] **Step 5: E2E を新しい URL と Review Focus 1〜4 に合わせて書き換える（先にテストを変える）**

`e2e/learning.spec.ts` を次のように変える。

未ログインのリダイレクト先の一覧（11行目付近）：`"/typle",` → `"/integrations/typle",`

「unauthenticated pages redirect to signin」のテストの直後に、次のテストを追加する（Review Focus 1・2）。

```ts
test("integration pages keep sign-in callbacks and hide unknown ids", async ({
  page,
}) => {
  await page.goto("/integrations/typle");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=\/integrations\/typle$/);
  await page.goto("/integrations/unknown");
  await expect(page).toHaveURL(/\/signin$/);
  await asGuest(page);
  await page.goto("/integrations/unknown");
  await expect(page).toHaveURL(/\/$/);
});
```

ゲストのテスト（「guest signs in, cannot post or use chat, and can sign out」）で、

```ts
await expect(page.getByRole("link", { name: "ChatGPTと話す" })).toHaveCount(0);
```

の直後に、次の1行を追加する（Review Focus 3）。

```ts
await expect(page.getByRole("link", { name: "Typle用リスト" })).toHaveCount(0);
```

同じテストの次の部分を、

```ts
await page.goto("/typle");
await expect(page).toHaveURL(/\/$/);
const typleResponse = await page.request.get("/api/typle/export");
expect(typleResponse.status()).toBe(403);
```

次のように置き換える。

```ts
await page.goto("/integrations/typle");
await expect(page).toHaveURL(/\/$/);
const typleResponse = await page.request.get("/api/integrations/typle/export");
expect(typleResponse.status()).toBe(403);
```

「admin creates a Typle-compatible review list from corrections and hints」のテストの `const response = await page.request.get("/api/typle/export");` を `const response = await page.request.get("/api/integrations/typle/export");` にする。

このテストの直後に、次の2つのテストを追加する（Review Focus 4 と、存在しない ID の 404）。

```ts
test("admin gets 404 for unknown integrations", async ({ context, page }) => {
  await asAdmin(context);
  const response = await page.goto("/integrations/unknown");
  expect(response?.status()).toBe(404);
  const api = await page.request.get("/api/integrations/unknown/export");
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: "連携が見つかりません。" });
});

test("admin preview shows 20 items while the download keeps all of them", async ({
  context,
  page,
}) => {
  await asAdmin(context);
  await page.goto("/");
  const words = Array.from("天地人山川日月水火木金土花草鳥魚犬猫馬牛羊");
  await upload(
    page,
    [
      "最初の文,添削後の文,ピン音,ヒント1",
      ...words.map(
        (word, index) => `row${index},row${index},pinyin,「${word}」`,
      ),
    ].join("\n"),
  );
  await expect(page.getByText("21件の学習文を登録しました。")).toBeVisible();
  await page.goto("/integrations/typle");
  await expect(page.getByText("21語", { exact: true })).toBeVisible();
  await expect(page.locator('p[lang="zh-Hans"]')).toHaveCount(20);
  await expect(
    page.getByText("先頭20件を表示しています。出力には全21件が含まれます。"),
  ).toBeVisible();
  const response = await page.request.get("/api/integrations/typle/export");
  expect(response.status()).toBe(200);
  expect((await response.json()).lists[0].words).toHaveLength(21);
});
```

- [ ] **Step 6: E2E が失敗することを確かめる**

先に main 側の E2E が動いていないことを確かめる。

```bash
docker ps --filter name=zhuelog-e2e --format '{{.Names}}'
lsof -nP -iTCP:3107 -sTCP:LISTEN
```

Expected: 2つとも何も出力しない。何か出たら、止めてユーザーに相談する。

```bash
npm run test:e2e -- e2e/learning.spec.ts
npm run test:e2e:stop
rm -rf .next playwright-report test-results
```

Expected: FAIL（`/integrations/typle` がまだないので、新しい URL を使うテストが失敗する）

- [ ] **Step 7: 共通の連携画面を書く**

`src/app/integrations/[id]/page.tsx`：

```tsx
import { ArrowLeft, Download, Puzzle, WandSparkles } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  integrationUseCases,
  integrations,
} from "@/composition/integration-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { loadIntegrationPreview } from "@/presentation/presenters/integration-preview-presenter";

export const dynamic = "force-dynamic";

const PREVIEW_ITEM_LIMIT = 20;

type IntegrationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function IntegrationPage({
  params,
}: IntegrationPageProps) {
  const { id } = await params;
  // Map lookup only, so the sign-in redirect never echoes the raw URL segment.
  const integration = integrations.find(id);
  const user = await getCurrentViewerUser();
  if (!user)
    redirect(
      integration
        ? `/signin?callbackUrl=/integrations/${integration.id}`
        : "/signin",
    );
  if (user.role !== "admin") redirect("/");
  if (!integration) notFound();

  const { sourceCount, total, preview, error } = await loadIntegrationPreview(
    integration,
    integrationUseCases.previewIntegration,
  );
  const { text } = integration;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Puzzle className="size-3.5" /> Integration
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {text.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {text.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>参照したノート</CardDescription>
              <CardTitle className="font-mono text-3xl">
                {sourceCount}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {total}件
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          {preview.stats.map((stat, index) => (
            <Card key={index}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="font-mono text-3xl">
                  {stat.value}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader>
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <WandSparkles className="size-4" />
            </div>
            <CardTitle>{text.listTitle}</CardTitle>
            <CardDescription>{text.listDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {text.sources.map((source, index) => (
                <span
                  key={index}
                  className="inline-flex items-center rounded-lg border px-3 py-2"
                >
                  {source}
                </span>
              ))}
            </div>

            {preview.items.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {preview.items
                    .slice(0, PREVIEW_ITEM_LIMIT)
                    .map((item, index) => (
                      <div
                        key={index}
                        className="min-w-0 rounded-xl border bg-muted/30 p-4"
                      >
                        <p lang={item.lang} className="text-xl font-semibold">
                          {item.title}
                        </p>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    ))}
                </div>
                {preview.items.length > PREVIEW_ITEM_LIMIT ? (
                  <p className="text-sm text-muted-foreground">
                    先頭{PREVIEW_ITEM_LIMIT}件を表示しています。出力には全
                    {preview.items.length}件が含まれます。
                  </p>
                ) : null}
                <Button asChild size="lg">
                  <a
                    href={`/api/integrations/${integration.id}/export`}
                    download
                  >
                    <Download /> {text.downloadLabel}
                  </a>
                </Button>
              </>
            ) : (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {text.emptyMessage}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: ホームのボタンを登録済みの連携から作る**

`src/app/page.tsx` を次のように変える。

lucide のアイコンの import：`Keyboard,` を削除し、`MessageCircle,` の次に `Puzzle,` を追加する。

```tsx
import {
  BookOpenText,
  CalendarDays,
  Database,
  Eye,
  Languages,
  MessageCircle,
  Puzzle,
  Sparkles,
} from "lucide-react";
```

`import { getCurrentViewerUser } from "@/composition/identity-container";` の次に、次の1行を追加する。

```tsx
import { integrations } from "@/composition/integration-container";
```

管理者向けボタンの次の部分を、

```tsx
<Button asChild variant="outline" size="sm">
  <Link href="/typle">
    <Keyboard /> Typle用リスト
  </Link>
</Button>
```

次のように置き換える（`ChatGPTと話す` のボタンはそのまま）。

```tsx
{
  integrations.list().map((integration) => (
    <Button key={integration.id} asChild variant="outline" size="sm">
      <Link href={`/integrations/${integration.id}`}>
        <Puzzle /> {integration.text.navLabel}
      </Link>
    </Button>
  ));
}
```

- [ ] **Step 9: 旧 Typle 画面・API と、プラグインの一時的な export を削除する**

```bash
git rm -q src/app/typle/page.tsx src/app/api/typle/export/route.ts
```

`packages/typle-integrate-plugin/src/index.ts` から、次のコメントと `export { … } from "./typle-word-list";` の部分を削除する（`import { createTypleExport, extractTypleWords } from "./typle-word-list";` と default export は残す）。

```ts
// Named exports keep the legacy /typle routes working until the shared
// integration screen replaces them.
export {
  createTypleExport,
  extractTypleWords,
  type TypleExport,
  type TypleWord,
  type TypleWordList,
} from "./typle-word-list";
```

削除後に参照が残っていないことを確かめる。

```bash
grep -rn '"/typle"\|/api/typle\|app/typle' src e2e tests
grep -rln '@ffpf-zhuelog/typle-integrate-plugin' src e2e tests scripts prisma
```

Expected: 1つ目は何も出力しない。2つ目は `src/composition/integration-container.ts` だけ

- [ ] **Step 10: 単体テスト・型チェック・Lint を通す**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run typecheck
npm run lint
rm -rf .next
```

Expected: `ℹ tests 88`、`ℹ fail 0`、型チェックと Lint が成功

- [ ] **Step 11: E2E が通ることを確かめる**

先に main 側の E2E が動いていないことを確かめる。

```bash
docker ps --filter name=zhuelog-e2e --format '{{.Names}}'
lsof -nP -iTCP:3107 -sTCP:LISTEN
```

Expected: 2つとも何も出力しない。何か出たら、止めてユーザーに相談する。

```bash
npm run test:e2e
npm run test:e2e:stop
rm -rf .next playwright-report test-results
```

Expected: すべてのテストが passed（デスクトップとモバイルの両方）

- [ ] **Step 12: コミットする**

```bash
git add -A
git commit -q -F - <<'EOF'
feat: render integrations on a shared screen and drop legacy Typle routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

---

### Task 7: ESLint の依存ルール・ドキュメント・バージョン 0.9.0

**Files:**

- Modify: `eslint.config.mjs`、`README.md`、`package.json`、`package-lock.json`
- Create: `docs/releases/v0.9.0.md`

**Interfaces:**

- Consumes: Task 1〜6 のファイル構成
- Produces: なし（ルールと文書）

- [ ] **Step 1: 依存のルール違反が、今は検出されないことを確かめる**

次の3つの確認用ファイルを作る。

`packages/core/src/zz-lint-probe.ts`：

```ts
import "next/navigation";
import "@/composition/identity-container";
import "@ffpf-zhuelog/typle-integrate-plugin";
```

`packages/typle-integrate-plugin/src/zz-lint-probe.ts`：

```ts
import "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import "react";
```

`src/presentation/zz-lint-probe.ts`：

```ts
import "@ffpf-zhuelog/typle-integrate-plugin";
```

```bash
npx eslint packages/core/src/zz-lint-probe.ts packages/typle-integrate-plugin/src/zz-lint-probe.ts src/presentation/zz-lint-probe.ts
echo "exit=$?"
```

Expected: `exit=0`（まだルールがない）

- [ ] **Step 2: 依存のルールを追加する**

`eslint.config.mjs` の import 文の後、`const eslintConfig = defineConfig([` の前に、次を追加する。

```js
// Workspace packages stay framework-free and never reach into the app.
const packageBoundaries = [
  {
    group: ["@/**"],
    message: "パッケージからアプリの内部（src/）を import しないでください。",
  },
  {
    group: [
      "next",
      "next/**",
      "react",
      "react/**",
      "react-dom",
      "react-dom/**",
      "@prisma/**",
    ],
    message: "パッケージをフレームワークやDBに依存させないでください。",
  },
];
const pluginImports = ["@ffpf-zhuelog/*-plugin", "@ffpf-zhuelog/*-plugin/**"];
```

`...nextTs,` の直後（`globalIgnores` の前）に、次の4つの設定を追加する。flat config では後の設定が同じルールを上書きするため、core とプラグインの設定には `packageBoundaries` も含める。

```js
  {
    files: ["packages/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: packageBoundaries }],
    },
  },
  {
    files: ["packages/core/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...packageBoundaries,
            {
              group: pluginImports,
              message: "core は個別の連携プラグインを import しません。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/*-plugin/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...packageBoundaries,
            {
              group: [
                "@ffpf-zhuelog/core/domain/**",
                "@ffpf-zhuelog/core/application/**",
              ],
              message:
                "プラグインは @ffpf-zhuelog/core/integration だけを使ってください。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/composition/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: pluginImports,
              message:
                "連携プラグインの登録は src/composition/ だけで行ってください。",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 3: 違反が検出されることを確かめ、確認用のファイルを消す**

```bash
npx eslint packages/core/src/zz-lint-probe.ts packages/typle-integrate-plugin/src/zz-lint-probe.ts src/presentation/zz-lint-probe.ts
echo "exit=$?"
rm packages/core/src/zz-lint-probe.ts packages/typle-integrate-plugin/src/zz-lint-probe.ts src/presentation/zz-lint-probe.ts
npm run lint
```

Expected: 1回目は `exit=1` で `no-restricted-imports` のエラーが6件（core 3件、プラグイン 2件、src 1件）。確認用ファイルを消した後の `npm run lint` は成功

- [ ] **Step 4: README を更新する**

`## アーキテクチャ` の節（見出しから `## 起動方法` の直前まで）を、次の内容に置き換える。

````markdown
## アーキテクチャ

npm workspaces のモノレポです。ルートの Next.js アプリ（`@ffpf-zhuelog/web`）が、`packages/` のパッケージを使います。パッケージはビルドせず、TypeScript のまま読み込みます。

```text
.
├── src/                          # Next.js アプリ（@ffpf-zhuelog/web）
├── packages/
│   ├── core/                     # @ffpf-zhuelog/core
│   └── typle-integrate-plugin/   # @ffpf-zhuelog/typle-integrate-plugin
└── workers/line/                 # Go製のLINEワーカー
```

コードは依存関係が内側へ向くよう、機能別の関心事を層に分けています。

```text
packages/core/src/
├── domain/          # エンティティ、値オブジェクト、リポジトリの契約
├── application/     # ユースケースと外部サービスのポート
└── integration/     # 連携プラグインとの約束事（defineIntegration・登録）
src/
├── infrastructure/  # Prisma、Auth.js、CSV解析、OpenAIの実装
├── presentation/    # 画面部品、Server Action、HTTPコントローラー
├── composition/     # 実装を組み立ててユースケースを公開
└── app/             # Next.js App Routerのエントリーポイント
```

`domain` はフレームワークやデータベースに依存せず、`application` はドメインの契約だけを利用します。外部サービス固有のコードは `infrastructure` に閉じ込め、`composition` で依存性を注入します。

パッケージ間の依存は、次のルールをESLintで検査します。

- `packages/` からアプリの内部（`@/…`）、Next.js、React、Prismaを import しない
- `@ffpf-zhuelog/core` は個別の連携プラグインを import しない
- プラグインは `@ffpf-zhuelog/core/integration` だけを使う
- アプリでプラグインを import するのは `src/composition/` だけ

### 連携プラグインの追加

連携の画面（`/integrations/<id>`）、出力API（`/api/integrations/<id>/export`）、管理者の確認はアプリ側が共通で用意します。プラグインは、学習ノートから表示内容と出力ファイルを作る処理だけを持ちます。

1. `packages/<名前>-plugin/` を作り、`package.json` の `name` を `@ffpf-zhuelog/<名前>-plugin`、`exports` を `{ ".": "./src/index.ts" }`、`dependencies` を `{ "@ffpf-zhuelog/core": "*" }` にします。
2. `src/index.ts` で、`@ffpf-zhuelog/core/integration` の `defineIntegration` を使って連携を定義し、default export します。`id` は英小文字・数字・ハイフンで、40文字以内です。
3. ルートの `package.json` の `dependencies` に追加して `npm install` を実行し、`src/composition/integration-container.ts` の `createIntegrationRegistry([...])` に加えます。
````

`## Typle用の復習リスト` の節で、

- `管理者はホームの「Typle用リスト」から、学習ノートをTyple向けの復習リストへ変換できます。` を `管理者はホームの「Typle用リスト」（`/integrations/typle`）から、学習ノートをTyple向けの復習リストへ変換できます。処理は連携プラグイン `@ffpf-zhuelog/typle-integrate-plugin`（`packages/typle-integrate-plugin/`）にあります。` にする
- `` - `/api/typle/export` から、`typle-r` v1保存形式のJSONをダウンロードできます。`` を `` - `/api/integrations/typle/export` から、`typle-r` v1保存形式のJSONをダウンロードできます。`` にする

`## Playwright E2E` の節の `- Typle用リストの抽出・管理者限定表示・互換JSON出力` を `- Typle用リストの抽出・管理者限定表示・互換JSON出力・先頭20件の表示・存在しない連携の404` にする。

- [ ] **Step 5: リリースノートを書く**

`docs/releases/v0.9.0.md`：

```markdown
# v0.9.0 — ワークスペース化とTyple連携のプラグイン化

npm workspacesを導入し、アプリの中心部分とTyple連携をパッケージに分けました。

- `@ffpf-zhuelog/core`：domain・application層と、連携プラグインとの約束事（`defineIntegration`・登録・ユースケース）
- `@ffpf-zhuelog/typle-integrate-plugin`：Typle連携。学習ノートから表示内容と `typle-r` v1形式のJSONを作ります。
- Next.jsアプリはルートの `@ffpf-zhuelog/web` です。連携の画面・出力API・管理者の確認はアプリ側が共通で用意し、coreは個別の連携を知りません。
- パッケージ間の依存のルールをESLintで検査します。Claude Codeのworktree（`.claude/`）をLintの対象から外しました。

URLが変わりました。旧URLからの転送はありません。

- 画面：`/typle` → `/integrations/typle`
- 出力API：`/api/typle/export` → `/api/integrations/typle/export`

出力されるJSON・ファイル名・管理者専用であることは変わりません。画面のアイコン、統計の書式、件数の表記（「先頭20件」）、APIのエラー文言が共通のものになります。

DBマイグレーションとVercel環境変数の追加はありません。Go workerとLaunchAgentの変更もありません。

検証: TypeScript単体テスト88件、Go vet・race detector、連携の登録・出力APIの403/404/422/503、ブラウザーE2E（未認証・ゲスト・管理者、先頭20件の表示、存在しない連携の404）、型チェック、Lint、Turbopack本番ビルド。

本番: https://ffpf-zhuelog.vercel.app/
```

- [ ] **Step 6: バージョンを 0.9.0 にし、lockfile を合わせる**

`package.json` の `"version": "0.8.0",` を `"version": "0.9.0",` にする。

```bash
SCRATCH='/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad'
npm install --package-lock-only --ignore-scripts --cache "$SCRATCH/npm-cache"
git diff package-lock.json
```

Expected: lockfile の差分は、ルートの `"version": "0.9.0"`（2か所）だけ

- [ ] **Step 7: 確認してコミットする**

```bash
npm run typecheck
npm run lint
npx prettier --check README.md docs/releases/v0.9.0.md eslint.config.mjs
rm -rf .next
git add -A
git commit -q -F - <<'EOF'
chore: enforce package boundaries and document v0.9.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rm -rf .next
```

Expected: すべて成功（Prettier が差分を報告したら `npx prettier --write` で該当ファイルだけを整形してからコミットする）

---

### Task 8: 最終確認（CI と同じ確認一式と完了条件）

**Files:** なし（確認だけ。失敗したら原因のタスクに戻って直す）

**Interfaces:**

- Consumes: Task 1〜7 のすべて
- Produces: なし

- [ ] **Step 1: CI と同じ手順で、クリーンインストールから確認する**

```bash
SCRATCH='/private/tmp/claude-501/-Users-liyur-qie-Library-Application-Support-Claude-scratch-workspaces-bce93722-25b0-481d-b26c-144ed007805a-d51153c8-a12a-442f-abbe-98308642f9a0-scratch-2026-09-26-2c3073/cae1d829-e313-4fcc-9018-da7da6ee1710/scratchpad'
CI=true DATABASE_URL='postgresql://zhuelog:zhuelog@127.0.0.1:5432/zhuelog?schema=public' npm ci --cache "$SCRATCH/npm-cache"
npm audit --cache "$SCRATCH/npm-cache"
npm run typecheck
npm run lint
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|^ok|FAIL"
DATABASE_URL='postgresql://zhuelog:zhuelog@127.0.0.1:5432/zhuelog?schema=public' npm run build
rm -rf .next
```

Expected: `npm ci` と `npm audit` が成功（`CI=true` でコミット前のフックの再インストールを省く）、型チェック・Lint が成功、`ℹ tests 88`・`ℹ fail 0`・Go の `ok`、ビルドが成功

- [ ] **Step 2: E2E を通す**

先に main 側の E2E が動いていないことを確かめる。

```bash
docker ps --filter name=zhuelog-e2e --format '{{.Names}}'
lsof -nP -iTCP:3107 -sTCP:LISTEN
```

Expected: 2つとも何も出力しない。何か出たら、止めてユーザーに相談する。

```bash
npm run test:e2e
npm run test:e2e:stop
rm -rf .next playwright-report test-results
```

Expected: すべてのテストが passed

- [ ] **Step 3: 完了の条件を確かめる**

```bash
grep -rni typle packages/core
grep -rln '@ffpf-zhuelog/typle-integrate-plugin' src e2e tests scripts prisma
ls prisma/migrations
git diff d4d6959 --stat -- prisma .env.example
git status --short
git log --oneline d4d6959..HEAD
```

Expected:

- 1つ目は何も出力しない（core に Typle が出てこない）
- 2つ目は `src/composition/integration-container.ts` だけ
- `prisma/migrations` に新しいマイグレーションがなく、`prisma`・`.env.example` に差分がない（DB マイグレーションも環境変数の追加もない）
- 作業ツリーがきれいで、仕様書・計画・Task 1〜7 のコミットが並んでいる

- [ ] **Step 4: リリースノートのテスト件数を確かめる**

Step 1 の `ℹ tests` が 88 でなければ、`docs/releases/v0.9.0.md` の `TypeScript単体テスト88件` を実際の件数に直してコミットする（コミット後に `rm -rf .next`）。

- [ ] **Step 5: 結果を報告する**

確認結果（コマンドと結果）をユーザーに報告し、push と PR の作成に進んでよいか確認する。PR を作ったら、プレビューデプロイのビルドが通ること（Vercel がワークスペースをインストールできること）も確認する。
