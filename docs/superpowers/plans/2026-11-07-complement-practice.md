# 補語の練習 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 介詞の練習の仕組みを「種類（kind）」付きの共通の仕組みに広げ、補語の練習（`/practice/complements`）とその記録を足す。

**Architecture:** 問題データは CSV から生成した `PracticeUsage[]`、ドメイン（quiz・record）と画面の部品は kind に依らない純粋な形にし、kind ごとの文言・パス・データは `practice-kind.ts` の設定表に集める。記録は新しい表 `PracticeRecord`（`kind` 列）に Go API が書き、ルートは `/v1/preposition-records` と `/v1/complement-records` が同じハンドラを kind 付きで使う。ページは `src/app/practice/[kind]/` の 1 系統。

**Tech Stack:** Next.js 16（App Router、typed routes、Server Actions）、TypeScript、Tailwind + shadcn/ui、node:test + tsx、Go 1.27 + pgx、Prisma のマイグレーション、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-07-complement-practice-design.md`

## Global Constraints

- Web の unit は `node --import tsx --test tests/<file>.test.ts`、全体は `pnpm run test:unit`（Go の `go vet ./...` と `go test -race ./...` も走る。DB を使う Go のテストは `API_TEST_DATABASE_URL` が無いと skip）。
- typecheck は `pnpm run typecheck`（`next typegen` で `PageProps`/`LayoutProps` が生成される）、lint は `pnpm run lint`。pre-commit hook が format・lint・typecheck を走らせるので、コミットが通れば 3 つとも通っている。
- 文言はすべて日本語で、既存の文言（「介詞を選ぶ」「正解！」「ゲストの練習は記録に残りません。」など）は 1 字も変えない。補語側は `介詞` を `補語` に置き換えたもの。
- Go の検証の上限は今と同じ：1〜50 問、ミス 0〜3 件（重ならず、答えでない）、答えとミスは 1〜10 字、見出し 1〜40 字、句 1〜100 字、`elapsedMs` は 0〜24 時間。
- マイグレーションは表の追加と行の複写だけ。既存の `PrepositionPracticeRecord` は消さない・改名しない（`docs/api-deployment.md` の「マイグレーションの制約」）。
- `/practice/prepositions`・`/practice/prepositions/records`・`/practice/prepositions/records/[id]`・`/v1/preposition-records*` の URL と応答の形は変えない（`questions[].noun` → `questions[].headword` だけが変わる）。
- 生成したデータファイルは手で直さない。CSV を直して生成し直す。

## Review Focus

1. 見出し語（動詞）を 2 つ以上の行が共有するとき（`看` が `看完`・`看懂`・`看得懂`）、他の行の補語が誤答に出ない。→ Task 2 の `wrongChoicesFor` のテスト。
2. 正解を含む・正解に含まれる補語（`懂`/`得懂`、`下`/`下来`）が誤答に出ない。→ Task 1 のテスト。
3. 介詞の記録の `id` を `/v1/complement-records/{id}` で読むと 404 になり、`PUT` で上書きもされない。→ Task 4 のストアのテスト。
4. 既存の介詞の記録（`noun` キー）が、マイグレーション後に `headword` で読める。→ Task 4 のマイグレーションの検証手順。
5. `/practice/unknown` と `/practice/unknown/records` が 404 で、`/practice/complements/records` はゲストに 404、未ログインにサインインへの redirect。→ Task 9 の e2e。

---

### Task 1: ドメインを kind に依らない形にする

**Files:**

- Create: `src/domain/practice/practice-quiz.ts`（`preposition-quiz.ts` を `git mv`）
- Create: `src/domain/practice/preposition-also-in.ts`
- Create: `scripts/generate-practice-data.ts`（`generate-preposition-data.ts` を `git mv`）
- Create: `data/中国語の介詞_名詞との組み合わせと例文.csv`（`~/Downloads/typle-word-list/` から複写）
- Modify: `src/domain/practice/preposition-data.ts`（生成し直す）
- Test: `tests/practice-quiz.test.ts`（`preposition-quiz.test.ts` を `git mv`）
- Modify（型の追従だけ）: `src/presentation/components/practice/preposition-practice.tsx`、`preposition-answer-list.tsx`、`src/app/practice/prepositions/(quiz)/page.tsx`、`src/domain/practice/preposition-record.ts`、`tests/preposition-record.test.ts`

**Interfaces:**

- Produces（`practice-quiz.ts`）:

```ts
export type PracticeKind = "preposition" | "complement";
export type PracticeUsage = {
  id: string;
  word: string; // 選ぶ語
  pinyin: string;
  meaning: string;
  category: string;
  pairs: readonly { headword: string; phrase: string; at: number }[];
  example: string;
  translation: string;
};
export type PracticeQuestion = {
  id: string;
  headword: string;
  meaning: string;
  prompt: string;
  phrase: string;
  answer: string;
  pinyin: string;
  example: string;
  translation: string;
  choices: string[];
};
export type Random = () => number;
// 問題の出どころ。alsoIn は CSV に無い分類の補足（介詞だけ）。
export type QuizSource = {
  usages: readonly PracticeUsage[];
  alsoIn?: Record<string, readonly string[]>;
};
export const CHOICE_COUNT = 4;
export const BLANK = "（　）";
export function categoriesOf(word: string, source: QuizSource): Set<string>;
export function wrongChoicesFor(
  answer: string,
  headword: string,
  source: QuizSource,
): string[];
export function buildQuestion(
  source: QuizSource,
  usage: PracticeUsage,
  pair: PracticeUsage["pairs"][number],
  random?: Random,
): PracticeQuestion;
export function buildQuiz(
  source: QuizSource,
  count: number,
  random?: Random,
): PracticeQuestion[];
export function progressPercent(done: number, total: number): number;
```

- Produces（`preposition-also-in.ts`）: `export const PREPOSITION_ALSO_IN: Record<string, readonly string[]>`（今の `ALSO_IN` をそのまま移す）。
- Produces（`preposition-data.ts`）: `export const PREPOSITION_USAGES: readonly PracticeUsage[]`（`preposition` → `word`、`noun` → `headword`）。
- Produces（`generate-practice-data.ts`）: `pnpm exec tsx scripts/generate-practice-data.ts <preposition|complement> <csv>`。kind ごとの設定は 1 つの `Record<PracticeKind, KindSpec>`：

```ts
type KindSpec = {
  rowKind: string; // 区分 の値: "介詞・介詞的用法" | "補語"
  wordColumn: string; // "介詞・表現（簡体字）" | "補語（簡体字）"
  headwordsColumn: string; // "名詞・句の例（中国語）" | "動詞の例（中国語）"
  categories: readonly string[];
  moved: Record<string, string>; // 介詞の MOVED。補語は {}
  alsoIn: Record<string, readonly string[]>; // 誤答の検査用
  constName: string; // "PREPOSITION_USAGES" | "COMPLEMENT_USAGES"
  output: URL; // ../src/domain/practice/<kind>-data.ts
};
```

- [ ] **Step 1: ファイルを移す**

```bash
git mv src/domain/practice/preposition-quiz.ts src/domain/practice/practice-quiz.ts
git mv scripts/generate-preposition-data.ts scripts/generate-practice-data.ts
git mv tests/preposition-quiz.test.ts tests/practice-quiz.test.ts
mkdir -p data && cp "$HOME/Downloads/typle-word-list/中国語の介詞_名詞との組み合わせと例文.csv" data/
```

- [ ] **Step 2: テストを新しい型に書き換え、2 つのルールのテストを足す**

`tests/practice-quiz.test.ts` の既存のテストは、`PREPOSITION_SOURCE = { usages: PREPOSITION_USAGES, alsoIn: PREPOSITION_ALSO_IN }` を使い、`usage.preposition` → `usage.word`、`pair.noun` → `pair.headword`、`question.noun` → `question.headword`、`buildQuestion(usage, pair, random)` → `buildQuestion(PREPOSITION_SOURCE, usage, pair, random)`、`buildQuiz(count, random)` → `buildQuiz(PREPOSITION_SOURCE, count, random)`、`wrongChoicesFor(x)` → `wrongChoicesFor(x, "学校", PREPOSITION_SOURCE)` に直す。中身の assert は変えない。足すテスト：

```ts
test("wrong choices never pair with the headword, nor contain or sit inside the answer", () => {
  const source: QuizSource = {
    usages: [
      u("C1", "懂", "結果補語", [["看", "看懂这本书", 1]]),
      u("C2", "完", "結果補語", [["看", "看完这本书", 1]]),
      u("C3", "得懂", "可能補語", [["听", "听得懂", 1]]),
      u("C4", "下来", "方向補語（複合）", [["停", "停下来", 1]]),
      u("C5", "下", "方向補語（単純）", [["放", "放下", 1]]),
      u("C6", "得很", "程度補語", [["好", "好得很", 1]]),
      u("C7", "起来", "方向補語（複合）", [["看", "看起来", 1]]),
    ],
  };
  // 完 は同じ分類、得懂 は 懂 を含む、起来 は 看 と組む
  assert.deepEqual(wrongChoicesFor("懂", "看", source).sort(), [
    "下",
    "下来",
    "得很",
  ]);
  // 下来 は 下 を含む
  assert.deepEqual(
    wrongChoicesFor("下", "放", source).sort(),
    ["得很", "得懂", "完", "懂"].sort(),
  );
});
```

（`u(id, word, category, pairs)` は `PracticeUsage` を作るテスト内のヘルパー。`pinyin`・`meaning`・`example`・`translation` は `""`。）

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `node --import tsx --test tests/practice-quiz.test.ts`
Expected: FAIL（`practice-quiz.ts` に `QuizSource` が無い／旧シグネチャ）

- [ ] **Step 4: `practice-quiz.ts` を Interfaces のとおりに書き換える**

`wrongChoicesFor` は `source.usages` の全 `word` から、(1) `categoriesOf(answer)` と交わる分類を持つ語、(2) `pairs` に `headword` を持つ行の `word`、(3) `answer.includes(w) || w.includes(answer)` の語、を除く。`buildQuiz` は今と同じく `word` が重ならないように選ぶ。`ALSO_IN` は `preposition-also-in.ts` に移す。

- [ ] **Step 5: 生成スクリプトを kind 付きにし、介詞のデータを生成し直す**

`generate-practice-data.ts`：`process.argv[2]` を kind、`[3]` を CSV にし、`KindSpec` で列と分類を引く。出力の先頭コメントは `// Generated by scripts/generate-practice-data.ts from\n// <CSV のファイル名>. Do not edit by hand.`、型は `import type { PracticeUsage } from "./practice-quiz"`。最後に、全行・全 pair について `wrongChoicesFor(word, headword, { usages, alsoIn })` が `CHOICE_COUNT - 1` 未満なら `throw new Error(\`${id}: only N wrong choices for ${headword}\`)`。

Run: `pnpm exec tsx scripts/generate-practice-data.ts preposition "data/中国語の介詞_名詞との組み合わせと例文.csv"`
Expected: `… usages, … questions`（今の 202 行から作った数と同じ。`git diff --stat src/domain/practice/preposition-data.ts` がキー名の変更だけであること）

- [ ] **Step 6: 介詞の画面・記録の型を追従させる**

`preposition-record.ts` の `PrepositionAnswer.noun` を `headword` に、`preposition-practice.tsx`・`preposition-answer-list.tsx`・`(quiz)/page.tsx` の `question.noun`／`buildQuiz(QUESTION_COUNT)`／`buildQuiz(total)` を新しい呼び方に直す（この時点では介詞専用のまま。共通化は Task 7）。`tests/preposition-record.test.ts` はそのまま通る。

- [ ] **Step 7: テストと typecheck を通す**

Run: `node --import tsx --test tests/practice-quiz.test.ts tests/preposition-record.test.ts && pnpm run typecheck`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add -A data scripts src tests
git commit -m "refactor(web): 練習の問題づくりを介詞に限らない形にする"
```

---

### Task 2: 補語の CSV と問題データ

**Files:**

- Create: `data/中国語の補語_動詞との組み合わせと例文.csv`
- Create: `src/domain/practice/complement-data.ts`（生成）
- Modify: `scripts/generate-practice-data.ts`（`complement` の `KindSpec`）
- Test: `tests/practice-quiz.test.ts`

**Interfaces:**

- Produces: `export const COMPLEMENT_USAGES: readonly PracticeUsage[]`（`complement-data.ts`）。

- [ ] **Step 1: 補語のデータのテストを足す**

```ts
const COMPLEMENT_SOURCE: QuizSource = { usages: COMPLEMENT_USAGES };

test("every complement phrase holds its verb and, right after it, the complement", () => {
  const pairs = COMPLEMENT_USAGES.flatMap((u) =>
    u.pairs.map((pair) => ({ u, pair })),
  );
  assert.ok(pairs.length >= 200);
  for (const { u, pair } of pairs) {
    assert.ok(
      pair.phrase.startsWith(pair.headword) ||
        pair.phrase.includes(pair.headword),
      u.id,
    );
    assert.equal(
      pair.phrase.slice(pair.at, pair.at + u.word.length),
      u.word,
      u.id,
    );
    assert.equal(
      pair.at,
      pair.phrase.indexOf(pair.headword) + pair.headword.length,
      `${u.id}: ${pair.phrase}`,
    );
  }
});

test("complements come in the six categories and at least 30 words", () => {
  const categories = new Set(COMPLEMENT_USAGES.map((u) => u.category));
  assert.deepEqual(
    [...categories].sort(),
    [
      "程度・様態補語",
      "結果補語",
      "方向補語（単純）",
      "方向補語（派生）",
      "方向補語（複合）",
      "可能補語",
    ].sort(),
  );
  assert.ok(new Set(COMPLEMENT_USAGES.map((u) => u.word)).size >= 30);
});

test("every complement question has three wrong choices that obey the rules", () => {
  for (const u of COMPLEMENT_USAGES)
    for (const pair of u.pairs) {
      const wrong = wrongChoicesFor(u.word, pair.headword, COMPLEMENT_SOURCE);
      assert.ok(wrong.length >= CHOICE_COUNT - 1, `${u.id} ${pair.headword}`);
      for (const w of wrong) {
        assert.ok(!w.includes(u.word) && !u.word.includes(w), `${u.id}: ${w}`);
        assert.ok(
          !COMPLEMENT_USAGES.some(
            (o) =>
              o.word === w && o.pairs.some((p) => p.headword === pair.headword),
          ),
          `${u.id}: ${w} pairs with ${pair.headword}`,
        );
      }
    }
});

test("a complement quiz of 25 asks about different complements", () => {
  const quiz = buildQuiz(COMPLEMENT_SOURCE, 25, seeded(5));
  assert.equal(quiz.length, 25);
  assert.equal(new Set(quiz.map((q) => q.answer)).size, 25);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --import tsx --test tests/practice-quiz.test.ts`
Expected: FAIL（`complement-data` が無い）

- [ ] **Step 3: CSV を書く**

`data/中国語の補語_動詞との組み合わせと例文.csv`（UTF-8、BOM なし、RFC 4180）。見出し行は spec 4.1 の 14 列。120〜150 行、`ID` は `C001` から連番、`区分` は `補語`、`意味分類` は spec 4.2 の 6 つ、行数の目安も 4.2 のとおり。各行の `動詞の例` は `；` 区切りで 1〜3 語、`組み合わせ例` は動詞と同じ順で、動詞の直後に補語が続く句（`看完这本书；吃完饭`）。例文は組み合わせ例の 1 つを含む自然な 1 文、和訳はその訳。

書き方の決まり：

- 可能補語は `得完`・`不完` のように `得`/`不` を含めて 1 行ずつ（`看得完`・`看不完`）。程度補語の `得很`・`得很好` も同じ。
- 同じ補語を別の分類で出すとき（`起来` の複合と派生）は別の行にし、意味と例文を分ける。
- 動詞は、その補語とその意味で自然に組み合わさるものだけ。迷うものは入れない（誤答の除外は「データにある組み合わせ」だけを見るため、不自然な組み合わせが無いことが品質になる）。
- 同じ分類に 3 語以上の別の補語がある（誤答の候補は他の分類から出るので、各分類に偏りが無いこと）。

- [ ] **Step 4: 生成して検査を通す**

`generate-practice-data.ts` に `complement` の `KindSpec`（`rowKind: "補語"`、`wordColumn: "補語（簡体字）"`、`headwordsColumn: "動詞の例（中国語）"`、6 分類、`moved: {}`、`alsoIn: {}`、`constName: "COMPLEMENT_USAGES"`、`output: complement-data.ts`）を足す。

Run: `pnpm exec tsx scripts/generate-practice-data.ts complement "data/中国語の補語_動詞との組み合わせと例文.csv"`
Expected: `… usages, … questions`（usages ≥ 120、questions ≥ 200）。誤答不足の `throw` が出たら CSV を直す。

- [ ] **Step 5: テストを通す**

Run: `node --import tsx --test tests/practice-quiz.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add data scripts src/domain/practice/complement-data.ts tests
git commit -m "feat(web): 補語の練習の問題を CSV から作る"
```

---

### Task 3: 種類ごとの設定と記録の型

**Files:**

- Create: `src/domain/practice/practice-kind.ts`
- Create: `src/domain/practice/practice-record.ts`（`preposition-record.ts` を `git mv`、型名から Preposition を外す）
- Test: `tests/practice-kind.test.ts`、`tests/practice-record.test.ts`（`git mv`）
- Modify（import の追従）: Task 1 で触った介詞の画面・ページ・ゲートウェイ・アクション

**Interfaces:**

- Produces（`practice-kind.ts`）:

```ts
export type PracticeKindConfig = {
  kind: PracticeKind;
  slug: "prepositions" | "complements";
  path: `/practice/${string}`; // "/practice/prepositions"
  recordsPath: `/practice/${string}/records`;
  apiPath: "/v1/preposition-records" | "/v1/complement-records";
  title: string; // 介詞の練習 / 補語の練習
  eyebrow: string; // Preposition practice / Complement practice
  recordsEyebrow: string; // Preposition records / Complement records
  recordEyebrow: string; // Preposition record / Complement record
  description: string; // 名詞と日本語の意味に合う介詞を、4つの中から選んでください。 / 動詞と…補語を…
  wordLabel: string; // 介詞 / 補語
  navLabel: string; // 介詞練習 / 補語練習
  questionCount: 25;
  source: QuizSource;
};
export const PRACTICE_KINDS: Readonly<Record<PracticeKind, PracticeKindConfig>>;
export const PRACTICE_KIND_LIST: readonly PracticeKindConfig[]; // preposition, complement の順
export function kindFromSlug(slug: string): PracticeKind | null;
```

- Produces（`practice-record.ts`）: `PracticeAnswer { answer; headword; prompt; misses }`、`PracticeScore`、`PracticeRecordSummary`、`PracticeRecord`、`scoreRound`、`accuracyPercent`、`formatElapsed`（中身は今のまま）。

- [ ] **Step 1: テストを書く**

`tests/practice-kind.test.ts`：

```ts
test("kinds are found by their URL slug", () => {
  assert.equal(kindFromSlug("prepositions"), "preposition");
  assert.equal(kindFromSlug("complements"), "complement");
  assert.equal(kindFromSlug("complement"), null);
  assert.equal(kindFromSlug(""), null);
});
test("each kind's paths and labels follow its slug and word", () => {
  for (const c of PRACTICE_KIND_LIST) {
    assert.equal(c.path, `/practice/${c.slug}`);
    assert.equal(c.recordsPath, `${c.path}/records`);
    assert.ok(
      c.title.startsWith(c.wordLabel) && c.navLabel.startsWith(c.wordLabel),
    );
    assert.ok(c.source.usages.length >= 100);
  }
  assert.equal(PRACTICE_KINDS.preposition.apiPath, "/v1/preposition-records");
  assert.equal(PRACTICE_KINDS.complement.apiPath, "/v1/complement-records");
  assert.deepEqual(
    PRACTICE_KINDS.preposition.source.alsoIn,
    PREPOSITION_ALSO_IN,
  );
});
```

- [ ] **Step 2: 失敗を確かめ、実装し、通す**

Run: `node --import tsx --test tests/practice-kind.test.ts tests/practice-record.test.ts`
Expected: 実装前 FAIL（モジュールが無い）→ 実装後 PASS

- [ ] **Step 3: typecheck を通してコミット**

Run: `pnpm run typecheck`

```bash
git add -A src tests
git commit -m "feat(web): 練習の種類ごとの設定表を置く"
```

---

### Task 4: DB の表とマイグレーション、Go のストア

**Files:**

- Create: `prisma/migrations/20261107120000_add_practice_records/migration.sql`（spec 6.1 の SQL そのまま）
- Modify: `prisma/schema.prisma:184-201`（`PracticeRecord` モデルを足す。`PrepositionPracticeRecord` は「次のリリースで消す。v0.22.0 から Go は `PracticeRecord` に書く」と注記して残す）
- Create: `services/api/store/practice_records.go`（`preposition_records.go` を `git mv`）
- Test: `services/api/store/practice_records_test.go`（`git mv`）
- Modify: `e2e/fixtures.ts:39`（TRUNCATE に `"PracticeRecord"` を足す）

**Interfaces:**

- Produces:

```go
type PracticeKind string
const (
    PracticeKindPreposition PracticeKind = "preposition"
    PracticeKindComplement  PracticeKind = "complement"
)
type PracticeQuestion struct {
    Answer   string   `json:"answer"`
    Headword string   `json:"headword"`
    Prompt   string   `json:"prompt"`
    Misses   []string `json:"misses"`
}
type PracticeRecordSummary struct { ID string; QuestionCount, FirstTryCount, MissCount, ElapsedMs int; StartedAt, CreatedAt time.Time }
type PracticeRecord struct { PracticeRecordSummary; Questions []PracticeQuestion }
func (s *Store) ListPracticeRecords(ctx context.Context, kind PracticeKind, ownerID string, limit int) ([]PracticeRecordSummary, error)
func (s *Store) GetPracticeRecord(ctx context.Context, kind PracticeKind, ownerID, id string) (PracticeRecord, error)
func (s *Store) AddPracticeRecord(ctx context.Context, kind PracticeKind, ownerID string, r PracticeRecord, now time.Time) (PracticeRecord, error)
```

- [ ] **Step 1: ストアのテストを kind 付きに直し、kind をまたぐケースを足す**

既存の 3 テストは `PracticeKindPreposition` で呼ぶ（`Noun:` → `Headword:`）。`cleanPracticeRecords` は `"PracticeRecord"` を消す。足すテスト：

```go
func TestPracticeRecordsAreKeptApartByKind(t *testing.T) {
    // owner が preposition で保存した id は complement では Get も List も見えず、
    // complement で同じ id を Add すると ErrNotFound（上書きされない）。
    // complement で別の id を保存すると、両 kind の List がそれぞれ 1 件になる。
}
```

- [ ] **Step 2: ローカルの DB を用意し、失敗を確かめる**

Run: `pnpm run api:db`（compose の Postgres に `prisma migrate deploy`）→ `cd services/api && API_TEST_DATABASE_URL=<scripts/api-local.sh の URL> go test ./store/ -run PracticeRecord`
Expected: FAIL（コンパイルエラー）

- [ ] **Step 3: マイグレーションと schema を書き、ストアを kind 付きにする**

SQL は spec 6.1 のまま。ストア：3 つのクエリに `"kind" = $n` を足し、`INSERT` に `"kind"` を入れ、`ON CONFLICT ("id") DO UPDATE … WHERE "PracticeRecord"."ownerId" = EXCLUDED."ownerId" AND "PracticeRecord"."kind" = EXCLUDED."kind"`。エラーの接頭辞は `store: list practice records:` など。

- [ ] **Step 4: マイグレーションの複写を確かめる**

Run: ローカル DB で `psql "$URL" -c "INSERT INTO \"PrepositionPracticeRecord\" VALUES ('11111111-1111-4111-8111-111111111111','o',1,1,0,1000,'[{\"answer\":\"在\",\"noun\":\"学校\",\"prompt\":\"（　）学校学习\",\"misses\":[]}]',now(),now())"` を打ってから `pnpm exec prisma migrate deploy`（`DATABASE_URL` を同じ URL に）→ `psql "$URL" -c "SELECT kind, questions FROM \"PracticeRecord\""`
Expected: 1 行、`kind = preposition`、`questions` に `"headword":"学校"` があり `noun` が無い。確かめたら `pnpm run api:db:stop` で消す（tmpfs）か、両表の行を `DELETE` する。

- [ ] **Step 5: ストアのテストを通す**

Run: `cd services/api && API_TEST_DATABASE_URL=… go test -race ./store/`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add prisma services/api/store e2e/fixtures.ts
git commit -m "feat(api): 練習記録の表を種類付きの PracticeRecord にする"
```

---

### Task 5: Go のハンドラとルート

**Files:**

- Create: `services/api/httpapi/practice_handlers.go`（`preposition_handlers.go` を `git mv`）
- Test: `services/api/httpapi/practice_handlers_test.go`（`git mv`）
- Modify: `services/api/httpapi/router.go:108-109, 234-238`、`services/api/httpapi/respond.go:54-55`、`services/api/httpapi/router_test.go:24,81,147`、`services/api/httpapi/act_as_test.go:97`、`services/api/main.go:166`

**Interfaces:**

- Produces:

```go
type PracticeRecords interface {
    ListPracticeRecords(ctx context.Context, kind store.PracticeKind, ownerID string, limit int) ([]store.PracticeRecordSummary, error)
    GetPracticeRecord(ctx context.Context, kind store.PracticeKind, ownerID, id string) (store.PracticeRecord, error)
    AddPracticeRecord(ctx context.Context, kind store.PracticeKind, ownerID string, r store.PracticeRecord, now time.Time) (store.PracticeRecord, error)
}
func listPracticeRecords(rs PracticeRecords, kind store.PracticeKind) http.Handler
func getPracticeRecord(rs PracticeRecords, kind store.PracticeKind) http.Handler
func putPracticeRecord(rs PracticeRecords, kind store.PracticeKind, now func() time.Time) http.Handler
func validPracticeRecord(elapsedMs int, questions []store.PracticeQuestion) bool
// Deps.PracticeRecords PracticeRecords；定数は maxPracticeQuestions などに改名
```

ルート（`router.go`）：`/v1/preposition-records*` は `store.PracticeKindPreposition`、`/v1/complement-records*` は `store.PracticeKindComplement` で、GET 一覧・GET 1 件・PUT の 3 つずつ。

- [ ] **Step 1: ハンドラのテストを 2 つのルートで回す**

偽のストアに `kinds map[string]store.PracticeKind`（`Add` した id → kind）と、`Get`/`List` が受けた kind を記録する項目を足す。`question()` の `"noun"` を `"headword"` に。既存の 3 テストを `for _, rt := range []struct{ path string; kind store.PracticeKind }{{"/v1/preposition-records", store.PracticeKindPreposition}, {"/v1/complement-records", store.PracticeKindComplement}}` で回し、`PUT` のあと `rs.kinds[testConversationID] == rt.kind` を確かめる。

- [ ] **Step 2: 失敗を確かめ、実装し、通す**

Run: `cd services/api && go vet ./... && go test -race ./httpapi/`
Expected: 実装前 FAIL（コンパイル）→ 実装後 PASS

- [ ] **Step 3: コミット**

```bash
git add services/api
git commit -m "feat(api): 補語の練習記録のルート /v1/complement-records を足す"
```

---

### Task 6: Web のゲートウェイ・アクション・DI

**Files:**

- Create: `src/infrastructure/go-api/practice-record-gateway.ts`（`git mv`）
- Modify: `src/composition/practice-container.ts`
- Create: `src/presentation/actions/practice-record-actions.ts`（`git mv`）
- Test: `tests/go-api-practice-record-gateway.test.ts`（`git mv`）

**Interfaces:**

- Produces:

```ts
export function createPracticeRecordGateway(
  kind: PracticeKind,
  call?: GoApiCall,
): { list(); get(id); save(round) }; // パスは PRACTICE_KINDS[kind].apiPath
export type PracticeRecordGateway = ReturnType<
  typeof createPracticeRecordGateway
>;
export function practiceRecords(kind: PracticeKind): PracticeRecordGateway; // composition。kind ごとに 1 つ作って使い回す
export type SavePracticeRoundInput = {
  kind: PracticeKind;
  id;
  startedAt;
  elapsedMs;
  questions: PracticeAnswer[];
};
export async function savePracticeRoundAction(
  input: SavePracticeRoundInput,
): Promise<SavePracticeRoundResult>;
```

- [ ] **Step 1: ゲートウェイのテストを kind 付きにする**

既存の 3 テストは `createPracticeRecordGateway("preposition", call)` で、`questions[].noun` → `headword`。足す：

```ts
test("the complement gateway talks to /v1/complement-records", async () => {
  const { call, calls } = fakeCall({ records: [] });
  await createPracticeRecordGateway("complement", call).list();
  assert.equal(calls[0].path, "/v1/complement-records");
});
```

- [ ] **Step 2: 失敗を確かめ、実装し、通す**

アクションの zod は `kind: z.enum(["preposition", "complement"])` を足し、`practiceRecords(parsed.data.kind).save(...)`。`goFailureMessage` のコードは `"PRACTICE_RECORD_SAVE_FAILED"`。

Run: `node --import tsx --test tests/go-api-practice-record-gateway.test.ts && pnpm run typecheck`
Expected: PASS（typecheck は介詞のページ・部品の import を追従させてから）

- [ ] **Step 3: コミット**

```bash
git add -A src tests
git commit -m "refactor(web): 練習記録のゲートウェイとアクションを種類付きにする"
```

---

### Task 7: 画面の部品を共通化する

**Files:**

- Create: `src/presentation/components/practice/practice.tsx`（`preposition-practice.tsx` を `git mv`）
- Create: `src/presentation/components/practice/practice-answer-list.tsx`（`git mv`）
- Create: `src/presentation/components/practice/practice-stats.tsx`（`git mv`、名前だけ）
- Create: `src/presentation/components/practice/practice-kind-icon.ts`

**Interfaces:**

- Produces:

```ts
export function Practice({
  kind,
  initialQuiz,
  canSave,
}: {
  kind: PracticeKind;
  initialQuiz: PracticeQuestion[];
  canSave: boolean;
});
export function PracticeAnswerList({
  answers,
  wordLabel,
  onlyMissed,
  className,
}: {
  answers: readonly PracticeAnswer[];
  wordLabel: string;
  onlyMissed?: boolean;
  className?: string;
});
export function PracticeStats(props); // 今の PrepositionStats と同じ
export function practiceKindIcon(kind: PracticeKind): LucideIcon; // preposition: Shuffle, complement: MoveRight
```

`Practice` の中で kind の設定を引き、`buildQuiz(config.source, total)`、`savePracticeRoundAction({ kind, ... })`、`RECORDS_HREF` → `config.recordsPath`、`aria-label` は `${config.wordLabel}を選ぶ`、`PracticeAnswerList` に `wordLabel` を渡す。`PracticeAnswerList` の `aria-label` は `選んだ${wordLabel}: …`。見た目・他の文言は変えない。

- [ ] **Step 1: 移して書き換え、介詞のページから使う**

介詞のページ（`src/app/practice/prepositions/...`、Task 8 で消す）は一時的に `<Practice kind="preposition" …/>` を使う。

- [ ] **Step 2: typecheck と lint を通し、介詞の e2e で退行が無いことを確かめる**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:e2e -- e2e/prepositions.spec.ts`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add -A src
git commit -m "refactor(web): 練習の画面の部品を種類付きにする"
```

---

### Task 8: `[kind]` のページとヘッダーの入口

**Files:**

- Create: `src/app/practice/[kind]/(quiz)/page.tsx`・`loading.tsx`、`[kind]/records/layout.tsx`・`page.tsx`・`loading.tsx`、`[kind]/records/[id]/page.tsx`・`loading.tsx`（`src/app/practice/prepositions/` を `git mv`）
- Modify: `src/presentation/components/layout/app-header.tsx:92-94`
- Delete: `src/app/practice/prepositions/`（mv で消える）

**Interfaces:**

- Consumes: `kindFromSlug`、`PRACTICE_KINDS`、`PRACTICE_KIND_LIST`、`Practice`、`PracticeAnswerList`、`PracticeStats`、`practiceRecords(kind)`、`practiceKindIcon`。

- [ ] **Step 1: ページを `[kind]` に移す**

各ページ・layout は `params` の `kind` を `kindFromSlug` に通し、`null` なら `notFound()`。`PageProps<"/practice/[kind]">`・`LayoutProps<"/practice/[kind]/records">` を使う。文言は設定から：練習ページの `eyebrow`/`title`/`description`、記録一覧の `recordsEyebrow`/`${wordLabel}の練習記録`/空のときの `${wordLabel}の練習を最後まで解くと、ここに記録が残ります。`、1 件の `recordEyebrow`。`callbackUrl` は `config.recordsPath`。リンクは `config.path`・`config.recordsPath`・`${config.recordsPath}/${record.id}`。loading の 3 ファイルは中身を変えない。`(quiz)/page.tsx` の `QUESTION_COUNT` は `config.questionCount`。

- [ ] **Step 2: ヘッダーに種類ごとのリンクを出す**

`app-header.tsx` の「介詞練習」の `NavLink` を `PRACTICE_KIND_LIST.map((c) => <NavLink key={c.kind} label={label} href={c.path} icon={practiceKindIcon(c.kind)}>{c.navLabel}</NavLink>)` にする。

- [ ] **Step 3: 404 と動作を確かめる**

Run: `pnpm run typecheck && pnpm run lint`、`pnpm run dev` で `/practice/complements`・`/practice/complements/records`・`/practice/unknown`（404）・`/practice/prepositions` を開く。ヘッダーのラベルが `xl` 以上で 7 つ収まるか見て、収まらなければ `label` の境を `max-2xl:sr-only` にし、`app-header.tsx:66-69` のコメントの「six links」「xl」を直す。
Expected: 4 つの URL が意図どおり。ブラウザのコンソールにエラーが無い。

- [ ] **Step 4: コミット**

```bash
git add -A src
git commit -m "feat(web): 補語の練習 /practice/complements とヘッダーの入口を足す"
```

---

### Task 9: e2e を両方の種類で回す

**Files:**

- Create: `e2e/practice.spec.ts`（`prepositions.spec.ts` を `git mv`）

- [ ] **Step 1: spec を kind のループにする**

```ts
const KINDS = [
  { slug: "prepositions", kind: "preposition", word: "介詞" },
  { slug: "complements", kind: "complement", word: "補語" },
] as const;
for (const { slug, kind, word } of KINDS)
  test.describe(`${word}の練習`, () => {
    /* 既存の 2 テスト。"介詞を選ぶ" → `${word}を選ぶ`、URL → `/practice/${slug}`、SQL は "PracticeRecord" を WHERE "kind" = $1 で数える */
  });
```

ゲストのテストに足す：`expect((await guest.goto("/practice/unknown"))?.status()).toBe(404)` と `expect((await guest.goto("/practice/unknown/records"))?.status()).toBe(404)`。会員のテストに足す：記録 1 件のページで `page.getByRole("main")` に `question.headword` の文字（`すべての問題（25問）` の下の最初の行）があること。

- [ ] **Step 2: 走らせる**

Run: `pnpm run test:e2e -- e2e/practice.spec.ts`
Expected: 4 テスト PASS

- [ ] **Step 3: コミット**

```bash
git add e2e
git commit -m "test(e2e): 介詞と補語の練習の記録を同じ spec で確かめる"
```

---

### Task 10: ドキュメントとリリースノート

**Files:**

- Modify: `README.md:220-227`
- Modify: `docs-site/reference/practice.md`、`docs-site/reference/README.md:48-50`
- Create: `docs/releases/v0.22.0.md`
- Modify: `package.json:3`（`"version": "0.22.0"`）

- [ ] **Step 1: README**

見出しを「介詞・補語の練習」にし、`/practice/complements`（ヘッダーの「補語練習」）で「動詞と日本語の意味に合う補語を 4 つから選ぶ」こと、記録が `/v1/complement-records` と `/practice/complements/records` であること、問題データが `data/` の CSV から `scripts/generate-practice-data.ts` で作られることを書く。「本番への反映」は v0.21.0 の書き方（本番ビルドが `20261107120000_add_practice_records` を自動で当てる。`PracticeRecord` を足して介詞の記録を写すだけで、今の Go API と両立する。古い `PrepositionPracticeRecord` は次のリリースで消す）。

- [ ] **Step 2: docs-site**

`practice.md`：題を「介詞・補語の練習の記録」にし、冒頭に「`/v1/preposition-records` と `/v1/complement-records` は同じ形。以下は介詞で書く」と断り、`noun` を `headword`（見出しの名詞・動詞）に直す。`README.md` の表に `/v1/complement-records` の 3 行を足す。

- [ ] **Step 3: リリースノート**

`docs/releases/v0.22.0.md`：題「v0.22.0 — 補語の練習」。何ができるか、介詞との共通化、`/v1/complement-records`、`questions[].noun` → `headword`、新しい表と古い表の扱い、**デプロイ前に必要な作業**（無し。マイグレーションは自動）・**デプロイ後に必要な作業**（Go API に main を手でデプロイ。古い表に残った記録の写しは次のリリースで）、検証の一覧。

- [ ] **Step 4: コミット**

```bash
git add README.md docs docs-site package.json
git commit -m "docs: 補語の練習と v0.22.0 のリリースノート"
```

---

### Task 11: 全体の検証

- [ ] **Step 1: 回帰テスト一式**

Run: `pnpm run test:regression`（typecheck → lint → unit（Node + Go）→ build → e2e）
Expected: すべて PASS。Go の DB テストは `API_TEST_DATABASE_URL` を付けて別に `go test -race ./...` で PASS。

- [ ] **Step 2: ブラウザで確かめる**

`pnpm run dev` で、会員として `/practice/complements` を 25 問解き、結果・「記録に保存しました。」・`/practice/complements/records` の 1 件・全問の一覧を見る。`/practice/prepositions` も 1 問だけ解いて見た目が変わっていないことを見る。
Expected: 文言・配置が介詞と同じで、補語の問題は動詞の直後が空欄。

- [ ] **Step 3: 設計書の状態を更新してコミット**

`docs/superpowers/specs/2026-11-07-complement-practice-design.md` の「状態」を「実装済み（v0.22.0）」にする。

```bash
git add docs/superpowers/specs
git commit -m "docs: 補語の練習の設計書を実装済みにする"
```
