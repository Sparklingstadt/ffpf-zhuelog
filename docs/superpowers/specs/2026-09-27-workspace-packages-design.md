# ワークスペース化と Typle 連携のプラグイン化

- 作成日: 2026-09-27
- 対象バージョン: v0.9.0
- 状態: 設計合意済み（この仕様書のレビュー待ち）

## 1. 目的

`ffpf-zhuelog` を npm workspaces によるモノレポにし、スコープ `@ffpf-zhuelog` の下に次のパッケージを置く。

- `@ffpf-zhuelog/core`：アプリの中心部分（domain・application 層）と、連携プラグインとの約束事
- `@ffpf-zhuelog/typle-integrate-plugin`：Typle 連携（学習ノートから Typle 用の復習リストを作る）

目的は次の2つ。

1. **リポジトリ内の整理**：Typle 連携をアプリ本体から切り離し、境界をはっきりさせる。
2. **プラグインの仕組み**：core が連携を読み込む仕組みを持ち、core 自身は個別の連携（Typle）を知らない。Typle 以外の連携も同じ形で追加できるようにする。

## 2. 決定事項

| 項目             | 決定                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| 公開             | npm・GitHub Packages には公開しない。全パッケージを private にする                                                    |
| まとめる仕組み   | npm workspaces（Turborepo などは使わない）                                                                            |
| プラグインの範囲 | 学習ノートから「表示内容」と「出力ファイル」を作る変換だけ。画面・API・認証はアプリ側の共通部分が担当する             |
| 構成             | Next.js アプリはリポジトリのルートに残し、`@ffpf-zhuelog/web` とする                                                  |
| URL              | `/typle` → `/integrations/typle`、`/api/typle/export` → `/api/integrations/typle/export`。旧 URL からの転送は作らない |
| 見た目           | レイアウト・画面の文言・出力 JSON は維持する。アイコンと一部の共通文言の変更は許容する（8.3）                         |

## 3. 対象外

- LINE・ChatGPT・Codex 連携のプラグイン化
- Next.js アプリの `apps/web` への移動（将来、別の作業として検討できる）
- パッケージのビルドと公開
- プラグインごとの権限設定、プラグイン独自の画面・API・DB テーブル
- 旧 URL からの転送

## 4. パッケージ構成

```text
ffpf-zhuelog/                          @ffpf-zhuelog/web（ルート = Next.js アプリ）
├── src/                               画面・DB・認証・LINE（domain・application 以外）
│   └── composition/
│       └── integration-container.ts   連携の登録（Typle を import する唯一の場所）
├── prisma/ e2e/ tests/ scripts/       置き場所は変えない（import の書き換えのみ）
├── workers/line/                      変更なし
└── packages/
    ├── core/                          @ffpf-zhuelog/core
    │   ├── package.json
    │   ├── src/
    │   │   ├── domain/                src/domain から移動（typle を除く）
    │   │   ├── application/           src/application から移動 + 連携のユースケース
    │   │   └── integration/           プラグイン向けの約束事（新規）
    │   └── tests/
    └── typle-integrate-plugin/        @ffpf-zhuelog/typle-integrate-plugin
        ├── package.json
        ├── src/
        │   ├── index.ts               連携の定義（default export）
        │   └── typle-word-list.ts     src/domain/typle から移動
        └── tests/
```

### 4.1 ルートの `package.json`

- `name`：`ffpf-zhuelog` → `@ffpf-zhuelog/web`（`private: true` のまま）
- `version`：`0.8.0` → `0.9.0`
- `workspaces`：`["packages/*"]`
- `dependencies` に追加：`"@ffpf-zhuelog/core": "*"`、`"@ffpf-zhuelog/typle-integrate-plugin": "*"`
- `zod` はアプリ側（infrastructure・presentation）でも使っているため残す

### 4.2 `packages/core/package.json`

```json
{
  "name": "@ffpf-zhuelog/core",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./domain/*": "./src/domain/*.ts",
    "./application/*": "./src/application/*.ts",
    "./integration": "./src/integration/index.ts"
  },
  "dependencies": { "zod": "^4.6.5" }
}
```

### 4.3 `packages/typle-integrate-plugin/package.json`

```json
{
  "name": "@ffpf-zhuelog/typle-integrate-plugin",
  "version": "0.0.0",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@ffpf-zhuelog/core": "*" }
}
```

### 4.4 ビルドとバージョン

- パッケージはビルドせず、TypeScript のまま使う。Next.js 16 はワークスペースのパッケージを自動で変換するため、`transpilePackages` は不要（`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/transpilePackages.md`）。
- `tsx`（単体テスト・スクリプト）と `tsc`（型チェック）が `exports` の `.ts` を解決できることは、リポジトリ外の試験で確認済み。
- 内部パッケージのバージョンは `0.0.0` で固定する。リリースで上げるのはルートのバージョンだけ。
- パッケージの `package.json` に `"type"` は書かない（ルートと同じ扱いにする）。

## 5. 依存のルール

```text
@ffpf-zhuelog/web ──→ @ffpf-zhuelog/core
        │                     ↑
        └──→ @ffpf-zhuelog/typle-integrate-plugin
```

- core が依存するのは `zod` だけ。
- プラグインが使ってよいのは `@ffpf-zhuelog/core/integration` だけ（`domain/*`・`application/*` は使わない）。
- アプリでプラグインを import してよいのは `src/composition/` だけ。

これを ESLint の `no-restricted-imports` で強制する。

| 対象ファイル                            | 禁止する import                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/**`                           | `@/*`、`next`・`next/*`、`react`・`react/*`、`react-dom`・`react-dom/*`、`@prisma/*`         |
| `packages/core/**`                      | `packages/**` の禁止項目 + `@ffpf-zhuelog/*-plugin`（サブパスを含む）                        |
| `packages/*-plugin/**`                  | `packages/**` の禁止項目 + `@ffpf-zhuelog/core/domain/*`・`@ffpf-zhuelog/core/application/*` |
| `src/**`（`src/composition/**` を除く） | `@ffpf-zhuelog/*-plugin`                                                                     |

flat config では、後の設定が同じルールを上書きする。そのため core とプラグイン向けの設定には、`packages/**` の禁止項目も含める。

### 5.1 import の書き換え

| 場所                                            | 変更前                                       | 変更後                                                            |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| アプリ（`src`・`e2e`・`scripts`・`prisma`）     | `@/domain/…`、`@/application/…`              | `@ffpf-zhuelog/core/domain/…`、`@ffpf-zhuelog/core/application/…` |
| アプリ内の相対パス（例：`../../application/…`） | `../../domain/…`、`../../application/…` など | 同上                                                              |
| `tests/`                                        | `../src/domain/…`、`../src/application/…`    | 同上                                                              |
| core の内部                                     | `@/domain/…`、`@/application/…`              | 相対パス                                                          |
| Typle の処理                                    | `@/domain/learning/entities/learning-entry`  | `@ffpf-zhuelog/core/integration`（型を再公開したもの）            |

## 6. 連携の約束事（`@ffpf-zhuelog/core/integration`）

### 6.1 型と `defineIntegration`

`packages/core/src/integration/integration.ts`

```ts
import type { LearningEntry } from "../domain/learning/entities/learning-entry";

export type IntegrationText = {
  navLabel: string; // ホームのボタン
  title: string; // 画面の見出し
  description: string; // 見出しの下の説明
  listTitle: string; // 一覧カードの見出し
  listDescription: string; // 一覧カードの説明
  sources: string[]; // 抽出元を示すチップ
  emptyMessage: string; // 一覧が空のときの案内
  downloadLabel: string; // ダウンロードボタン
};

export type IntegrationStat = { label: string; value: string };

export type IntegrationItem = {
  title: string;
  description: string;
  lang?: string; // title の言語（例: "zh-Hans"）
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

export type Integration = {
  id: string;
  text: IntegrationText;
  preview(entries: readonly LearningEntry[]): IntegrationPreview;
  export(entries: readonly LearningEntry[]): IntegrationFile | null;
};

export function defineIntegration(integration: Integration): Integration {
  return integration;
}
```

- `preview` と `export` は同期の純粋関数にする。受け取るのは学習ノートだけで、リクエスト・ログイン情報・DB には触れない。
- `export` は、出力する項目がないときに `null` を返す。
- `entries` は新しい順に並んでいる。

### 6.2 登録（`createIntegrationRegistry`）

`packages/core/src/integration/registry.ts`

- 引数：`readonly Integration[]`
- 検査（違反したら例外を投げる。アプリはモジュールの読み込み時に失敗する）
  - `id` が `^[a-z0-9]+(?:-[a-z0-9]+)*$` に一致し、40文字以内であること
  - `id` が重複しないこと
- 戻り値：`{ list(): readonly Integration[]; find(id: string): Integration | undefined }`
  - `list()` は登録順に返す
  - `find()` は `Map` で引く（`__proto__` などの文字列でも `undefined` を返す）

### 6.3 公開する入口

`packages/core/src/integration/index.ts` は次を再公開する。

- `defineIntegration` と 6.1 の型
- `createIntegrationRegistry` と `IntegrationRegistry` 型
- `LearningEntry`・`LearningHint` 型（プラグインが domain を直接 import しなくて済むように）

### 6.4 ユースケース

`packages/core/src/application/integration/use-cases/`

- 共通の定数 `INTEGRATION_SOURCE_LIMIT = 1000`（読み込む学習ノートの上限。今の Typle と同じ）
- `PreviewIntegration`（`preview-integration.ts`）
  - `execute(integration)`：`repository.listRecent(1000)` の結果から `{ sourceCount: entries.length, total, preview: integration.preview(entries) }` を返す
- `ExportIntegration`（`export-integration.ts`）
  - `execute(integration)`：`repository.listRecent(1000)` の結果で `integration.export(entries)` を呼び、その戻り値を返す（`null` はそのまま返す）
  - ファイル名が `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$` に一致しなければ例外を投げる（`Content-Disposition` ヘッダーの引用符の中に入れるため）
- 依存は既存の `LearningEntryRepository` だけ

## 7. Typle プラグイン

### 7.1 ファイル

- `src/typle-word-list.ts`：`src/domain/typle/typle-word-list.ts` を移動する。処理は変えない。変えるのは、import 元と、引数の型を `readonly LearningEntry[]` にすることだけ。
- `src/index.ts`：`defineIntegration` で連携を定義し、default export する。

### 7.2 定義

| 項目                   | 値                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`                   | `typle`                                                                                               |
| `text.navLabel`        | `Typle用リスト`                                                                                       |
| `text.title`           | `Typle用の復習リスト`                                                                                 |
| `text.description`     | `添削で増えた中国語と、ヒント内で引用された語を集めて、Typleの保存形式へ整えます。`                   |
| `text.listTitle`       | `自動生成された単語リスト`                                                                            |
| `text.listDescription` | `表示文字と入力文字には中国語を、補足には元のヒント・例文・拼音を入れます。同じ語は1件にまとめます。` |
| `text.sources`         | `ヒントの「引用語」`、`添削で追加された語`                                                            |
| `text.emptyMessage`    | `抽出できる語がまだありません。ヒントに中国語を「」で記録するか、添削を追加してください。`            |
| `text.downloadLabel`   | `Typle互換JSONをダウンロード`                                                                         |

- `preview(entries)`：`extractTypleWords(entries)` の結果から次を作る
  - `stats`：`{ label: "抽出した復習語", value: "<語数>語" }`、`{ label: "Typleでの入力", value: "中国語IME" }`
  - `items`：各語を `{ title: display, description: annotation, lang: "zh-Hans" }` にしたもの
- `export(entries)`：`createTypleExport(entries)` の語が0件なら `null` を返す。それ以外は次を返す
  - `fileName`：`ffpf-zhuelog-typle-words.json`
  - `contentType`：`application/json; charset=utf-8`
  - `body`：`JSON.stringify(payload, null, 2)`（今と同じ）

## 8. アプリ側

### 8.1 登録（`src/composition/integration-container.ts`）

- `createIntegrationRegistry([typleIntegration])` の結果を `integrations` として公開する
- `PreviewIntegration`・`ExportIntegration` を既存の `PrismaLearningEntryRepository` で組み立て、`integrationUseCases = { previewIntegration, exportIntegration }` として公開する
- アプリで Typle プラグインを import するのはこのファイルだけ

### 8.2 共通画面（`src/app/integrations/[id]/page.tsx`）

処理の順番：

1. `params` から `id` を取り出し、`integrations.find(id)` で連携を引く（`Map` を引くだけ）
2. 未ログインなら、連携があれば `/signin?callbackUrl=/integrations/<登録済みの id>` へ、なければ `/signin` へリダイレクトする（URL の入力値をそのまま戻り先に入れない）
3. 管理者でなければ `/` へリダイレクトする
4. 連携がなければ `notFound()`
5. `integrationUseCases.previewIntegration.execute(integration)` で表示内容を作る。例外が起きたら固定のエラー文言を表示し、`console.error("INTEGRATION_PREVIEW_UNAVAILABLE", integration.id)` を出す

表示（今の Typle 画面のレイアウトを共通化する）：

- バッジ：パズルのアイコン（`Puzzle`）と `Integration`
- 見出し・説明：`text.title`・`text.description`
- 戻るボタン（`学習ノートへ`）とログイン情報の表示：今と同じ
- 読み込みに失敗したとき：`学習ノートを読み込めませんでした。データベースの状態を確認してください。`（今と同じ）
- 統計カード：1枚目はアプリ側の「参照したノート」（`<件数> / <全体>件`。今と同じ書式）。続けてプラグインの `stats` を、今の数値と同じ書式（`font-mono text-3xl`）で表示する
- 一覧カード：`text.listTitle`・`text.listDescription`・`text.sources`（チップ。アイコンなし）
- 一覧：`items` の先頭20件。20件を超えるときは `先頭20件を表示しています。出力には全<件数>件が含まれます。` を表示する
- ダウンロード：`/api/integrations/<id>/export` へのリンク（文言は `text.downloadLabel`）。`items` が1件以上のときだけ表示する
- `items` が0件のとき：`text.emptyMessage`

### 8.3 見た目の変更点（合意済み）

- バッジが `Typle bridge` から `Integration` になり、アイコンはパズル（`Puzzle`）になる
- プラグインの統計値がすべて同じ書式になる（今は `中国語IME` だけ小さい）
- `先頭20語…全N語` が `先頭20件…全N件` になる
- 抽出元のチップからアイコンがなくなる
- API のエラー文言が共通の文言になる（8.4）

### 8.4 出力 API（`src/app/api/integrations/[id]/export/route.ts`）

- ルートは `params` から `id` を取り出し、依存と一緒にコントローラーへ渡すだけにする（既存の `src/app/api/corrections/route.ts` と同じ形）。`runtime = "nodejs"` と `dynamic = "force-dynamic"` は今と同じ。
- コントローラー `src/presentation/controllers/integration-export-controller.ts` は、上から順に判定する。

| 順  | 条件                                                                       | 応答                                                      |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | 管理者でない（未ログイン・ゲスト）                                         | 403 `{ "error": "管理者としてログインしてください。" }`   |
| 2   | 連携がない                                                                 | 404 `{ "error": "連携が見つかりません。" }`               |
| 3   | `export` が `null`                                                         | 422 `{ "error": "出力できる項目がありません。" }`         |
| 4   | 成功                                                                       | 200。本文は `body`                                        |
| 5   | 想定外の例外（DB・プラグイン・不正なファイル名・不正な Content-Type など） | 503 `{ "error": "出力ファイルを作成できませんでした。" }` |

- すべての応答に `Cache-Control: private, no-store` を付ける
- 200 のときは `Content-Type: <contentType>` と `Content-Disposition: attachment; filename="<fileName>"` を付ける
- 503 のときは `console.error("INTEGRATION_EXPORT_UNAVAILABLE", integration.id)` を出す。例外の内容や学習ノートは出さない

### 8.5 ホーム（`src/app/page.tsx`）

- 管理者向けの `Typle用リスト` ボタンを、`integrations.list()` から作るボタンに置き換える（パズルのアイコンと `text.navLabel`。リンク先は `/integrations/<id>`）
- 並び順は今と同じ（連携のボタン、`ChatGPTと話す` の順）

### 8.6 削除するもの

- `src/app/typle/page.tsx`
- `src/app/api/typle/export/route.ts`
- `src/domain/typle/`（プラグインへ移動）

## 9. テスト

### 9.1 新しく書くテスト（実装より先に書く）

- `packages/core/tests/integration-registry.test.ts`：正しい登録、`id` の形式違反（大文字・空文字・先頭のハイフン・41文字など）、重複、`find` に未登録の ID や `__proto__` を渡すと `undefined`
- `packages/core/tests/integration-use-cases.test.ts`：読み込み件数が1000件、`preview` の結果と件数、`export` の `null` をそのまま返す、不正なファイル名（`"` を含む・`.` で始まる・空文字）で例外
- `packages/typle-integrate-plugin/tests/typle-word-list.test.ts`：`tests/typle-word-list.test.ts` を移動する（import 以外は変えない）
- `packages/typle-integrate-plugin/tests/typle-integration.test.ts`：7.2 の定義、`preview` の統計と一覧、語がないときに `export` が `null`、ファイル名・Content-Type・JSON の形
- `tests/integration-export.test.ts`：8.4 の表のすべての行、200 のときのヘッダー、503 のログにエラーコードと ID しか出ないこと

### 9.2 既存のテスト

- `tests/` の単体テストはそのまま残し、import だけを 5.1 に従って書き換える
- `scripts/test-unit.mjs` は、`tests/*.test.ts` に加えて `packages/*/tests/*.test.ts` も実行する

### 9.3 E2E（`e2e/learning.spec.ts`）

- URL を新しいものに変える（未ログインのリダイレクト、ゲストのリダイレクトと 403、管理者の流れ）
- 管理者の流れで確認する内容（見出し、`道`、ダウンロードのリンク、JSON の中身、ファイル名）は今のまま
- 追加：管理者が存在しない ID を開くと、画面・API とも 404

## 10. ツール・CI・デプロイ

- `tsconfig.json`・Prettier：変更なし（`packages/` もすでに対象に含まれる）
- ESLint：5 のルールを追加する。あわせて `globalIgnores` に `.claude/**` を追加する。worktree は `.claude/worktrees/` に置かれ、Git は `.git/info/exclude` で無視しているが、ESLint はこの設定を読まない。そのため、除外しないと worktree の生成ファイル（`.next/types` など）まで main の `npm run lint` が検査してエラーになる（2026-09-27 に確認）
- lockfile：`npm install` で差分だけを更新する（作り直さない）。Node 22 の CI の `npm ci` で通ることを確認する
- CI・Lefthook・Dependabot・Vercel の設定：変更なし
- README：アーキテクチャの節に、パッケージ構成・依存のルール・連携の追加手順を書く。Typle の節の URL を更新する
- リリースノート：`docs/releases/v0.9.0.md`（URL の変更を明記する）

## 11. 作業の順番

作業は worktree のブランチ `worktree-workspace-packages` で行う。各段階で型チェック・Lint・単体テストを通す。

1. ESLint の `globalIgnores` に `.claude/**` を追加する（10）。そのうえでワークスペース化：`packages/core`（domain・application）と `packages/typle-integrate-plugin`（`typle-word-list.ts` とそのテスト）を作り、import を書き換える。動作は変えない。旧 Typle 画面と API は、4 で削除するまでの間だけ、プラグインのパッケージから関数を import する。この段階でビルドと E2E も通す
2. core：連携の約束事・登録・ユースケース
3. Typle プラグイン：連携の定義
4. アプリ：登録・共通画面・出力 API・ホームのボタン・旧 Typle 画面の削除・E2E の更新
5. ESLint の依存ルール・README・リリースノート・バージョン 0.9.0
6. CI と同じ確認一式（`npm ci`・`npm audit`・型チェック・Lint・単体テスト・ビルド・E2E）

push と PR の作成は、6 の後にユーザーへ確認してから行う。PR では、プレビューデプロイのビルドが通ることも確認する。

## 12. 完了の条件

- 11 の 6 の確認がすべて通る
- `packages/core` に `typle` という語が（大文字・小文字を問わず）出てこない
- アプリで `@ffpf-zhuelog/typle-integrate-plugin` を import しているのは `src/composition/integration-container.ts` だけ
- DB マイグレーションも、Vercel の環境変数の追加もない

## 13. リスクと対策

| リスク                                                                                        | 対策                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| macOS の npm 11 で更新した lockfile が、CI（Node 22）の `npm ci` で通らない                   | 差分だけを更新し、PR の CI で確認する。通らなければ lockfile を同期し直す                                                          |
| 依存の巻き上げ（hoisting）で、core から宣言していないパッケージを import できてしまう         | ESLint の依存ルール（5）で禁止する                                                                                                 |
| Turbopack がワイルドカードの `exports` を解決できない                                         | 作業の1でビルドと E2E を通して確認する                                                                                             |
| Vercel がワークスペースをインストールできない                                                 | PR のプレビューデプロイで確認する                                                                                                  |
| 旧 URL のブックマークが使えなくなる                                                           | リリースノートに明記する                                                                                                           |
| worktree の生成ファイル（`.next/types` など）を main の `npm run lint` が検査してエラーになる | `.claude/**` を ESLint の除外に追加する。main に入るまでは、worktree で型チェックやビルドをした後に worktree の `.next` を削除する |
