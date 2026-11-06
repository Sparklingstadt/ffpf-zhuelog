# 補語の練習を、介詞の練習と同じ仕組みで足す

- 作成日: 2026-11-07
- 状態: 実装済み（v0.22.0）

## 1. 目的

介詞の練習（`/practice/prepositions`、`2026-10-24` の #93〜#99 で作ったもの）と同じ使い心地で、補語（結果補語・方向補語・可能補語・程度補語）の練習ができるようにする。動詞と日本語の意味に合う補語を 4 つから選び、25 問を解き終えると正答率・ミス数・経過時間が出て、会員と管理者の結果は記録に残り、見返せる。

介詞と補語で画面・ドメイン・Go API・DB の表を別々に持つと、同じコードが二重になる。今回は介詞の仕組みを「種類（kind）」を受け取る共通の仕組みに広げ、補語をその 2 つ目の種類として足す。

成功の条件は次のとおり。

1. `/practice/complements` で、介詞の練習と同じ流れで補語の練習が 25 問できる。ゲストもできる。
2. 会員と管理者の結果は Go API に保存され、`/practice/complements/records` で新しい順に見返せ、1 件ずつ全問の結果も見られる。
3. 介詞の練習と記録は、URL・画面・API のルートを変えずに、今までどおり動く（既存の記録も見られる）。
4. 介詞と補語で、画面の部品・ドメインのロジック・Go のハンドラとストアを共有し、種類ごとに違うのは問題データと文言・パスだけになる。

## 2. 決定事項

| 項目                 | 決定                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 問題データの出どころ | 介詞 CSV と同じ列構成の補語 CSV を Claude が書き、リポジトリの `data/` に置く。介詞 CSV も同じ場所に入れる                                                                                                           |
| 問題の数             | 補語 120〜150 行、各行に動詞 2 つ前後。25 問が毎回ちがう補語になるよう、補語は 30 種以上                                                                                                                             |
| 出題の形             | 介詞と同じ。大きく動詞、上に日本語の意味、下に空欄つきの句、4 択。正解後に例文と和訳                                                                                                                                 |
| 誤答の選び方         | 介詞の「意味分類を共有しない語から」に加え、同じ動詞と組み合わさる補語と、正解を含む／正解に含まれる補語を除く                                                                                                       |
| 記録の表             | `kind` 列を持つ `PracticeRecord` を新しく作り、`PrepositionPracticeRecord` の行を `kind = 'preposition'` で写す。questions の JSON のキー `noun` は写すときに `headword` に改める。古い表は次のリリースで消す        |
| Go のルート          | `/v1/preposition-records` はそのまま。`/v1/complement-records` を足す。ハンドラとストアは kind 付きで一本化                                                                                                          |
| Web のページ         | `src/app/practice/[kind]/…` の 1 系統。`prepositions` と `complements` 以外の kind は 404                                                                                                                            |
| 入口                 | ヘッダーに「補語練習」を足す                                                                                                                                                                                         |
| 本番への反映         | マイグレーションは Web の本番ビルドが当てる。表を足すだけなので、動いている Go API とそのまま両立する（`docs/api-deployment.md` の「マイグレーションの制約」）。古い表へ保存された記録は、次のリリースで消す前に写す |

`noun` を `headword` にする理由：補語の見出しは動詞なので、`noun` のままだと保存した JSON と Go の型の名前が嘘になる。Web 以外に API の利用者は無く、既存行の書き換えはマイグレーション 1 回で済む。

## 3. 対象外

- 補語以外の新しい種類（量詞・副詞など）。ただし kind を 1 つ足せば増やせる作りにする
- 問題の難易度や出題範囲の選択、問題数の変更
- 介詞と補語を混ぜた練習
- 記録の削除・統計の集計
- モバイルアプリ

## 4. 問題データ

### 4.1 CSV

`data/中国語の補語_動詞との組み合わせと例文.csv` を Claude が書く。列は介詞 CSV（`data/中国語の介詞_名詞との組み合わせと例文.csv` として同じ場所に入れる）と同じ並びで、見出しは次のとおり。

| 列                               | 補語での中身                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `ID`                             | `C001`〜                                                                      |
| `区分`                           | `補語`                                                                        |
| `意味分類`                       | 4.2 の 6 つのどれか                                                           |
| `補語（簡体字）`                 | 選ぶ語。`完`・`出来`・`得懂`・`得很` のように、動詞の直後に続く部分をまるごと |
| `ピンイン（見出し）`             | 補語のピンイン                                                                |
| `意味（日本語）`                 | その使い方の意味                                                              |
| `組み合わせる動詞・形容詞の種類` | 説明用                                                                        |
| `動詞の例（中国語）`             | `；` 区切り。1〜3 語                                                          |
| `基本構文`                       | `動詞＋完＋目的語` など、説明用                                               |
| `組み合わせ例（中国語）`         | `；` 区切り。動詞ごとに 1 つ、補語を含む句（`看完这本书；吃完饭`）            |
| `説明（日本語）`                 | 説明用                                                                        |
| `例文（中国語・オリジナル）`     | 1 文                                                                          |
| `例文の和訳`                     | 1 文                                                                          |
| `制約・類義語・品詞の注意`       | 説明用                                                                        |

生成に使うのは `ID`・`区分`・`意味分類`・`補語`・`ピンイン`・`意味`・`動詞の例`・`組み合わせ例`・`例文`・`和訳`。残りの列は人が読むためのもので、空でもよい。

### 4.2 意味分類

| 意味分類         | 例                                                                                                                                               | 行数の目安 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 結果補語         | 完・好・到・见・懂・清楚・对・错・着・住・下・掉・坏・开・成・会・光・饱・够・晚                                                                 | 30〜40     |
| 方向補語（単純） | 来・去・上・下・进・出・回・过・起・开                                                                                                           | 10〜12     |
| 方向補語（複合） | 上来・上去・下来・下去・进来・进去・出来・出去・回来・回去・过来・过去・起来                                                                     | 13〜15     |
| 方向補語（派生） | 起来（始める・思い出す・まとめる）・下去（続ける）・下来（残る・落ち着く）・出来（見分ける・考え出す）・过来（戻る・気づく）・过去（乗り越える） | 15〜20     |
| 可能補語         | 得完・不完・得懂・不懂・得见・不见・得了・不了・得起・不起・得下・不下・得及・不及 など                                                          | 30〜40     |
| 程度・様態補語   | 得很・极了・死了・坏了・多了・透了・得不得了・得要命・得很好・得很快・得很慢・一点                                                               | 12〜15     |

同じ補語が複数の行に出てよい（`起来` が複合と派生の両方、`下` が結果と単純方向）。誤答の選び方は 5.2 のとおり、ある語がどの分類にも出ているかで決める。

### 4.3 生成スクリプト

`scripts/generate-preposition-data.ts` を `scripts/generate-practice-data.ts` に広げる。使い方は `pnpm exec tsx scripts/generate-practice-data.ts <preposition|complement> <csv>`。

- kind ごとの設定（使う `区分`、列の見出し、意味分類の一覧と移し替え、出力先）を 1 つの表にまとめ、CSV の読み取り・句の中の語の位置の計算・Prettier での整形は共有する。
- 出力は `src/domain/practice/preposition-data.ts` と `src/domain/practice/complement-data.ts`。どちらも `PracticeUsage[]`（5.1）で、介詞のデータはこの型に合わせて作り直す（中身は今と同じ）。
- 介詞の `MOVED`（`補足の時間・対象・基準表現` の行を 5 分類へ移す対応）は介詞の設定に残す。補語には移し替えは無い。
- 語の位置：介詞は「名詞の外にある最初の介詞」、補語は「動詞の直後」。どちらも「見出し語の外にある最初の出現」で探せるので、同じ関数でよい。見つからない行は捨てる。

## 5. Web のドメイン（`src/domain/practice/`）

### 5.1 共通の型（`practice-quiz.ts`）

今の `preposition-quiz.ts` を kind に依らない形にする。

```ts
export type PracticeKind = "preposition" | "complement";

// One use of a word, from a row of the CSV.
export type PracticeUsage = {
  id: string;
  word: string; // 選ぶ語（介詞・補語）
  pinyin: string;
  meaning: string;
  category: string;
  // 見出し語（名詞・動詞）ごとの句と、句の中で word が始まる位置
  pairs: readonly { headword: string; phrase: string; at: number }[];
  example: string;
  translation: string;
};

export type PracticeQuestion = {
  id: string;
  headword: string;
  meaning: string;
  prompt: string; // phrase の word を BLANK にしたもの
  phrase: string;
  answer: string;
  pinyin: string;
  example: string;
  translation: string;
  choices: string[]; // CHOICE_COUNT 個、正解は 1 つ
};
```

`buildQuestion`・`buildQuiz`・`progressPercent`・`BLANK`・`CHOICE_COUNT` は引数に `usages` と、誤答の決め方（5.2）を取る純粋関数のまま残す。

### 5.2 誤答の選び方（`wrongChoicesFor`）

介詞：今と同じ。「正解と意味分類を 1 つも共有しない語」から選ぶ。`ALSO_IN`（CSV に無い分類の補足）は介詞の設定に残す。

補語：次の 3 つをすべて満たす語から選ぶ。

1. 正解と意味分類を 1 つも共有しない
2. 正解の見出し語（その問題の動詞）と組み合わさる行がデータに無い（`看懂` が正解のとき `看完`・`看见`・`看得懂` の `完`・`见`・`得懂` は出さない）
3. 正解を含まず、正解に含まれない（`懂` に対する `得懂`・`不懂`、`下` に対する `下来`・`下去`、`起来` に対する `起`）

2 と 3 は介詞にも害が無いので、共通の関数に入れ、介詞の `ALSO_IN` だけを kind の設定にする。

候補が 3 つに満たないデータの行は、生成スクリプトの最後で検査して失敗にする（CSV を直す）。

### 5.3 種類ごとの設定（`practice-kind.ts`）

画面・ページ・ゲートウェイが参照する、kind ごとの値を 1 か所にまとめる。

| 項目           | preposition                                                 | complement                                                  |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `slug`         | `prepositions`                                              | `complements`                                               |
| `path`         | `/practice/prepositions`                                    | `/practice/complements`                                     |
| `apiPath`      | `/v1/preposition-records`                                   | `/v1/complement-records`                                    |
| `title`        | 介詞の練習                                                  | 補語の練習                                                  |
| `eyebrow`      | Preposition practice                                        | Complement practice                                         |
| `description`  | 名詞と日本語の意味に合う介詞を、4つの中から選んでください。 | 動詞と日本語の意味に合う補語を、4つの中から選んでください。 |
| `wordLabel`    | 介詞                                                        | 補語                                                        |
| `navLabel`     | 介詞練習                                                    | 補語練習                                                    |
| `icon`         | `Shuffle`                                                   | `MoveRight`（lucide）                                       |
| `usages`       | `PREPOSITION_USAGES`                                        | `COMPLEMENT_USAGES`                                         |
| `wrongChoices` | 介詞の `ALSO_IN` 付き                                       | 補足なし                                                    |

`wordLabel` から「介詞を選ぶ」「選んだ介詞」「ミスした問題（正解と、間違えて選んだ介詞）」「介詞の練習記録」「介詞の練習を最後まで解くと…」などの文言を組み立てる。`slug` から kind を引く `kindFromSlug(slug): PracticeKind | null` も置く。

### 5.4 記録（`practice-record.ts`）

今の `preposition-record.ts` の型の名前から Preposition を外し、`PrepositionAnswer.noun` を `PracticeAnswer.headword` にする。`scoreRound`・`accuracyPercent`・`formatElapsed` は変えない。

## 6. Go API

### 6.1 DB（マイグレーション `20261107120000_add_practice_records`）

`docs/api-deployment.md` の「マイグレーションの制約」（動いている Go API と両立する変更だけ。改名は 2 段階に分ける）に従い、表を足して行を写す。古い `PrepositionPracticeRecord` は残し、次のリリースのマイグレーションで消す。

```sql
CREATE TABLE "PracticeRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "firstTryCount" INTEGER NOT NULL,
    "missCount" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PracticeRecord_ownerId_kind_createdAt_idx" ON "PracticeRecord"("ownerId", "kind", "createdAt");
CREATE UNIQUE INDEX "PracticeRecord_id_ownerId_key" ON "PracticeRecord"("id", "ownerId");
-- 介詞の記録を写す。questions の各要素の "noun" は "headword" に。
INSERT INTO "PracticeRecord"
  ("id", "ownerId", "kind", "questionCount", "firstTryCount", "missCount", "elapsedMs", "questions", "startedAt", "createdAt")
SELECT "id", "ownerId", 'preposition', "questionCount", "firstTryCount", "missCount", "elapsedMs",
  (SELECT COALESCE(jsonb_agg((q - 'noun') || jsonb_build_object('headword', q->'noun') ORDER BY ord), '[]'::jsonb)
   FROM jsonb_array_elements("questions") WITH ORDINALITY AS t(q, ord)),
  "startedAt", "createdAt"
FROM "PrepositionPracticeRecord";
```

`prisma/schema.prisma` に `PracticeRecord`（`kind String`、索引 `(ownerId, kind, createdAt)`、一意 `(id, ownerId)`）を足す。`PrepositionPracticeRecord` のモデルは「次のリリースで消す」と注記して残す（消すと `migrate status` がずれを報告する）。マイグレーションの SQL は手で書く。

JSON のキーは Web の型と同じ `headword`（見出しの名詞・動詞）。選ぶ語（介詞・補語）は `answer` のまま。

### 6.2 ストア（`services/api/store/practice_records.go`）

`preposition_records.go` を改名し、型から Preposition を外す。

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

func (s *Store) ListPracticeRecords(ctx, kind PracticeKind, ownerID string, limit int) ([]PracticeRecordSummary, error)
func (s *Store) GetPracticeRecord(ctx, kind PracticeKind, ownerID, id string) (PracticeRecord, error)
func (s *Store) AddPracticeRecord(ctx, kind PracticeKind, ownerID string, r PracticeRecord, now time.Time) (PracticeRecord, error)
```

- 一覧・1 件は `kind` と `ownerId` で絞る。他の kind の `id` は無いものとして `ErrNotFound`。
- `Add` は今と同じ upsert（同じ `id` を同じ持ち主が送れば何も変えずに返す）。`kind` が違う同じ `id` も「変えずに返す」のではなく、`ownerId` の条件と同じく `ErrNotFound`（ブラウザが作る UUID が kind をまたいで重なることは無いので、どちらでも実害は無いが、条件を 1 つにまとめる）。

### 6.3 ハンドラ（`services/api/httpapi/practice_handlers.go`）

`preposition_handlers.go` を改名し、`PracticeRecords` インターフェースと `listPracticeRecords(rs, kind)`・`getPracticeRecord(rs, kind)`・`putPracticeRecord(rs, kind, now)` にする。検証（50 問・ミス 3 件・答え 10 字・見出し 40 字・句 100 字・24 時間）とエラーの文言は共通。

ルート：

| ルート                             | kind        |
| ---------------------------------- | ----------- |
| `GET /v1/preposition-records`      | preposition |
| `GET /v1/preposition-records/{id}` | preposition |
| `PUT /v1/preposition-records/{id}` | preposition |
| `GET /v1/complement-records`       | complement  |
| `GET /v1/complement-records/{id}`  | complement  |
| `PUT /v1/complement-records/{id}`  | complement  |

6 つとも会員・admin。応答の JSON は今と同じ形で、`questions[].noun` が `questions[].headword` になる。`Dependencies.PrepositionRecords` は `PracticeRecords` に改名する。

## 7. Web の画面

### 7.1 ページ（`src/app/practice/[kind]/`）

今の `prepositions/` の木をそのまま `[kind]/` に移す。

- `[kind]/(quiz)/page.tsx`・`loading.tsx`
- `[kind]/records/page.tsx`・`loading.tsx`・`layout.tsx`
- `[kind]/records/[id]/page.tsx`・`loading.tsx`

各ページは `params.kind` を `kindFromSlug` で引き、無ければ `notFound()`。あとは設定（5.3）から文言・パス・問題データを取る。サインイン後の戻り先（`callbackUrl`）も設定の `path` から作る。`dynamic = "force-dynamic"` は今のまま。

### 7.2 部品（`src/presentation/components/practice/`）

`preposition-practice.tsx`・`preposition-answer-list.tsx`・`preposition-stats.tsx` を `practice.tsx`・`practice-answer-list.tsx`・`practice-stats.tsx` にし、`kind`（または設定）を props で受け取る。見た目は変えない。

- `aria-label`（「介詞を選ぶ」「選んだ介詞: …」）と見出し（「ミスした問題」など）は `wordLabel` から作る。
- 「もう一度」の出し直しは `buildQuiz` を kind の設定で呼ぶ。

### 7.3 ゲートウェイ・アクション・DI

- `src/infrastructure/go-api/practice-record-gateway.ts`：`createPracticeRecordGateway(kind, call)`。パスは設定の `apiPath`。
- `src/composition/practice-container.ts`：`practiceRecords(kind)`。
- `src/presentation/actions/practice-record-actions.ts`：`savePracticeRoundAction(kind, input)`。`kind` も zod で確かめる。
- `src/presentation/guards/practice-guard.ts` は変えない。

### 7.4 入口

ヘッダー（`app-header.tsx`）の「介詞練習」の隣に「補語練習」を足す。リンクが 1 つ増えるので、ラベルを文字で出す幅の境（今は会員・管理者で `xl`）を実機で確かめ、必要なら `2xl` にする。

## 8. ドキュメント

- `README.md`：「介詞の練習」の節を「介詞・補語の練習」にし、補語の URL・ヘッダーの入口・`/v1/complement-records`・マイグレーション名と、本番ビルドが当てること（v0.21.0 と同じ書き方）を書く。
- `docs-site/reference/practice.md`：「介詞・補語の練習の記録」とし、ルートの表に `/v1/complement-records` を足し、`noun` を `headword` にする。`docs-site/reference/README.md` の一覧にも 3 行足す。
- `docs/api-deployment.md`：触らない（表を足すだけで、「4. 本番の DB の確認」の制約どおり）。
- `docs/releases/v0.22.0.md`：リリースノート。`package.json` の version を `0.22.0` にする。

## 9. テスト

### 9.1 Web の unit（`tests/`）

- `practice-quiz.test.ts`：今の介詞のテストを共通の型で動かす。加えて補語について、生成した句が動詞と補語を含むこと、補語が 30 種以上あること、`wrongChoicesFor` が 5.2 の 3 条件を満たすこと、`buildQuiz(25)` が 25 問で補語が重ならないこと。
- `practice-record.test.ts`：今のまま（名前だけ変える）。
- `go-api-practice-record-gateway.test.ts`：kind ごとにパスが変わること。
- `practice-kind.test.ts`：`kindFromSlug`。

### 9.2 Go

- `store/practice_records_test.go`：今のテストを kind 付きで回し、他の kind の `id` が `ErrNotFound` になること、一覧が kind で分かれることを足す。
- `httpapi/practice_handlers_test.go`：今のテストを 2 つのルートで回す。偽のストアは kind を記録する。

### 9.3 e2e（`e2e/practice.spec.ts`）

`prepositions.spec.ts` を、`[prepositions, complements]` で回す 1 つの spec にする（`test.describe` をループ）。表の名前は `PracticeRecord`、`kind` で絞って数える。

## 10. 本番に出す手順

1. main にマージすると、Web の本番ビルドがマイグレーションを当てる（`scripts/vercel-build.sh`）。表を足すだけなので、動いている Go API は今までどおり古い表に書く。新しい Web に切り替わってから Go API を出すまでは、介詞・補語とも記録の保存が失敗する（古い Go API は `questions[].headword` を受け付けず `400`。練習はできる）。
2. マージ後、Go API の Vercel プロジェクトへ main を手でデプロイする。
3. 本番で `/practice/complements` を 1 回解き、記録が残ることを確かめる。`/practice/prepositions/records` で以前の記録が見えることも確かめる。
4. マイグレーションが当たってから新しい Web に切り替わるまでに、古い Web が古い表へ保存した記録があれば（`PrepositionPracticeRecord` の `createdAt` がマイグレーションの後の行）、次のリリースで古い表を消すマイグレーションの前に、同じ `INSERT … SELECT` で写す。
