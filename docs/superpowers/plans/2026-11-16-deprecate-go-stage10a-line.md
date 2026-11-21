# Go 廃止 段階 10a（LINE を Web で受ける）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LINE の webhook・連携の画面のデータ・拾い直しと復習のお知らせを、Go API から Next.js に移す。Web が LINE の署名を確かめ、OpenAI で添削・翻訳し、Prisma で `LineLink`・`LineLinkCode`・`LineMessage` を読み書きし、LINE に reply・push する。`/account/line` は Go を呼ばなくなる。拾い直しの Route Handler（`GET /api/cron/line-drain`）は作るが、**Cron には登録しない**（段階 10c）。Go のコードは 1 行も変えない（段階 10b で消す）。

**Architecture:** 段階 6〜9b と同じ形にする。

- LINE の決まり（文の振り分け・連携コードの形・返信の文言・時間の決まり）は、I/O の無い純粋な関数と定数として `src/domain/line/` に置く。
- LINE と OpenAI とのやりとり（署名・webhook の読み取り・Messaging API・添削と翻訳の指示）は `src/infrastructure/line/` と `src/infrastructure/openai/line-learning.ts`。
- DB は `src/infrastructure/prisma/line-link-store.ts`・`line-message-store.ts`（どちらも新規）。Go の文と同じ意味で書き、Go と Web が同じ表を並んで使っても壊れないようにする（参照 §20）。
- 流れ（webhook の 1 件・拾い直し・お知らせ）は `src/application/line/line-bot.ts`、連携の画面のだれが何をできるかは `src/application/line/line-link.ts`。
- 入口は Route Handler の `src/app/api/line/webhook/route.ts`（`POST`）と `src/app/api/cron/line-drain/route.ts`（`GET`）。中身は `src/presentation/controllers/` に置く。
- 入れ物は `src/composition/line-container.ts`（`lineLink`・`lineBot`）。Go のゲートウェイ `src/infrastructure/go-api/line-link-gateway.ts` は消す。
- 画面と文言は変えない。

**Tech Stack:** Next.js 16.4（Route Handler、route segment config の `maxDuration`・`dynamic`、Server Actions、`redirect`、`revalidatePath`）、TypeScript、Prisma 7（`$queryRaw`・`$executeRaw`・`Prisma.sql`、interactive transaction）、`node:crypto`（HMAC-SHA256・SHA-256・`randomBytes`・`timingSafeEqual`）、`fetch`、`node:test` + `tsx`、Playwright（偽の LINE API と OpenAI のスタブ）。依存は増やさない。

**Spec:** `docs/superpowers/specs/2026-11-16-deprecate-go-backend-design.md`（段階 10、「動いている Go の止め方」の段階 10 の 4 つの手順、決めたこと 5〜11）

**Go の今の動きの参照（必読）：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage10-go-reference.md`（以下「参照」）。この計画で使うのは §0〜§12、§14〜§17、§19、§20。

**前の計画：** `docs/superpowers/plans/2026-11-16-deprecate-go-stage9b-accounts.md`。この計画は 9b の PR の上に重ねた、別の PR にする。**後の計画：** `…-stage10b-go-line-removal.md`（デモのリセットを Web に移し、Go の LINE と cron を消す）、`…-stage10c-web-cron.md`（Web の `vercel.json` に cron を足す）。

## 設計者の判断（コントローラーが確かめること）

1. **段階 10 は 3 つの PR に分ける：10a（Web が LINE を受ける）→ 10b（デモのリセットを Web に移し、Go の LINE と cron を消す）→ 10c（Web の `vercel.json` に cron を足す）。** 設計の 4 つの手順のそれぞれの時点で、マージした PR が安全であるようにするため。
   - 10a をマージして出す ＝ 手順 1。Web に LINE の Route Handler があるが、LINE はまだ Go の URL に送り、cron も Go が動かす。Web と Go は同じ表を同じ意味で使うので（参照 §20）、Web の画面で出した連携コードを Go の webhook が使え、Web で切り替えたお知らせの設定を Go の cron が読む。
   - 利用者が LINE Developers の webhook の URL を Web に変える ＝ 手順 2。
   - 10b をマージし、Go を出し直す ＝ 手順 3。10b は手順 2 のあとでしかマージしない（先に出すと LINE が Go の消えたルートに届いて失われる）。
   - 10c をマージして出す ＝ 手順 4。cron の登録を 10b と同じ PR にすると、マージで Web が自動でデプロイされた時点で Web の cron が登録され、Go を出し直す前に 2 つの cron が並ぶことがある。別の PR にすれば順番が PR の順そのものになる。10c は `vercel.json` と文書だけの小さな PR。
   - デモのリセットを 10a に入れないのは、10a を LINE だけに絞り、webhook の切り替えで確かめることを少なくするため。10b で Go のリセットを消すのと同じ PR で Web に移す。
2. **webhook は Go と同じく、リクエストの中で処理してから 200 を返す（`after()` は使わない）。** Go は本番でこの形で動いており、LINE の reply token（約 1 分）の中で返事ができている。`after()` にすると、返事と処理のあいだにもう 1 つの寿命（応答のあとの `waitUntil`）を考えることになり、読むところが増える。同じ配信の重複は `LineMessage.webhookEventId` の一意で防ぐ（Go と同じ）。`deliveryContext.isRedelivery` は読まない（Go と同じ。読まなくても重複は起きない）。
   - 時間の決まりは Go と同じ：配信の開始から 45 秒を過ぎたら新しい生成を始めない（残りが 30 秒を切った文は保存だけして「時間がかかっています」と返す）、1 回の配信は 55 秒まで、関数は `maxDuration = 60`。
   - LINE や Vercel の edge が接続を切っても処理は続ける（Go の `context.WithoutCancel`）。`request.signal` をどこにも渡さない。
3. **署名は、生のバイトで確かめる。** `readLimitedBody(request, 1_048_576)` でバイト列を読み（`request.text()` は使わない。UTF-8 の解釈で中身が変わり得るため）、`createHmac("sha256", secret).update(body).digest("base64")` を作り、ヘッダーと**文字列のまま** SHA-256 にしてから `timingSafeEqual` で比べる（長さに関係なく同じ時間）。Go は Base64 を復号してから比べるが、正しい署名は正規の Base64 なので答えは同じ（参照 §2）。Node の Base64 の復号は不正な文字を読み飛ばすので、復号してから比べる形にはしない。
4. **Web と Go は同じ表を同じ意味で使う。** 文と値は Go のまま：コードは大文字 8 文字の SHA-256（小文字 16 進）、`LineMessage` の状態は `pending`/`done`/`failed`、試行は 2 回まで、終わったら `text` を `NULL`、試行回数の鍵は `line-link:<LINE のユーザー ID>`（5 回／1 時間）、`AiUsage.feature` は `line`。切り替えのあいだ、Go の webhook・拾い直し・お知らせが Web の書いた行を、Web が Go の書いた行を、そのまま扱えるようにするため（参照 §20）。
5. **だれが連携を使えるかは Go と同じにし、断られた人は `/` に戻す。** 会員と管理者（`role` が `member`・`admin`）で、会員として操作中でなく（`actingAs` が無い）、デモでない人。ゲスト・未ログイン・`revoked`・デモ・操作中の管理者は `LineLinkForbiddenError`。
   - `/account/line` は、今はデモと操作中の管理者で Go の 403 がエラーの画面になる。9a（`/follow`）・9b（`/account/password`）と同じく `redirect("/")` にする。
   - アクションは、今と同じく「この操作を行う権限がありません。再度ログインしてください。」（`accountForbiddenMessage`）。
6. **LINE が使えるかどうかは、Go と同じく 3 つの値がそろっているかで決める。** `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN` と OpenAI の設定（`openAiConfig()`）。そろわないときは、画面は「LINE 連携は今は使えません。」（Go の 404 と同じ）、webhook と拾い直しは `404 not_found`（Go のルートが無いのと同じ。資格の確かめより先）。Go はそろわない設定で起動しなかったが、Web は 1 つの機能のために全体を止めない。`LINE_API_BASE_URL` はテスト専用で、ループバックの URL だけ（Go と同じ。ほかの値なら使えない扱い）。
7. **cron の確かめは Go の `bearerMatches` と同じ。** `Authorization` を最初の空白で分け、方式は大文字小文字を区別せず `Bearer`、トークンが空でなく、`sha256(CRON_SECRET)` と `sha256(token)` を `timingSafeEqual`。`CRON_SECRET` が無ければいつも 401。Vercel は Cron の呼び出しにこのヘッダーを付ける。
8. **webhook と cron のパスを、proxy の公開ルートに足す。** proxy の門（`src/infrastructure/go-api/go-proxy.ts` の `gate`）は、Cookie の無い `/api/*` に 401 を返す（参照 §15）。LINE と Vercel Cron は Cookie を持たないので、`/api/line/webhook` と `/api/cron/` で始まるパスを `isPublicRoute` に足す。どちらも自分で資格（署名・cron の秘密）を確かめる。
9. **OpenAI の失敗に「もう一度試せるか」を足す。** `OpenAiError` に `retryable`（既定 `false`）を足し、Go と同じく、送れなかった・読めなかった（`transportError`）と 5xx だけを `true` にする。LINE は、もう一度試せる失敗の行を `pending` のまま残し、拾い直しに回す（参照 §6・§7）。ほかの機能は `code` しか見ないので変わらない。
10. **添削と翻訳の指示は、Go の文を 1 文字も変えずに写す。** 参照 §7.1 の 2 つ。テストに全文を書き、長さと SHA-256 も比べる（段階 6・7 と同じやり方）。モデルの答えの確かめ（3 つのキー、trim、1000・1600・200 コードポイント、ヒント 1〜5 個）も Go と同じ。
11. **AI の利用量は、生成が答えたあとに、答えが使えなくても記録する。** `respondJson` の `onUsage` で受け取った量を、生成のあとで `recordWithin(…, RECORD_TIMEOUT_MS, …)` で `AiUsage`（`feature: "line"`、持ち主は連携の持ち主。拾い直しでは行の持ち主）に書く。失敗はログだけ。
12. **文字の数え方と trim は JavaScript で書く。** 長さはコードポイント（`[...s].length`）、ひらがな・カタカナ・漢字は `\p{Script=…}`、コードの正規化は `normalize("NFKC")`・`trim()`・`toUpperCase()`。Go の `strings.TrimSpace` と JS の `trim()` は、U+0085 と U+FEFF だけ扱いが違う（Go は U+0085 を消し U+FEFF を残す。JS は逆）。LINE の文でこの 2 つが端に来ることはまず無いので、読みやすさを取る。
13. **ログは決まったコードと、イベントの ID・メッセージの ID・OpenAI のコード・件数だけ。** 本文・生成結果・鍵・LINE のユーザー ID・reply token・連携コード・持ち主の ID は出さない（Go と同じ。参照 §2・§6）。application はログを書かず、`log(code, fields)` を受け取る。
14. **DB を使う確かめは e2e で行う。** 偽の LINE API（`e2e/line-stub.ts`、`127.0.0.1:3111`）を、OpenAI のスタブと同じく `e2e/server.ts` の中で動かし、Web の `LINE_API_BASE_URL` をそこに向ける。テストは署名した webhook を Web に送り、スタブが受けた reply・push と DB を確かめる。

## Global Constraints

- コードを書く前に、`node_modules/next/dist/docs/` で、使う Next.js の API を確かめる（`AGENTS.md`）：`01-app/03-api-reference/03-file-conventions/route.md`（Route Handler、Webhooks の節）、`01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`、`01-app/03-api-reference/04-functions/redirect.md`・`revalidatePath.md`・`unstable_rethrow.md`。
- コメントは英語。画面と LINE の文言は変えない（LINE の文言は参照 §9 のまま）。依存を増やさない。
- Prisma を import してよいのは `src/infrastructure/prisma/` だけ。`node:crypto` は `src/infrastructure/` だけ。`src/application/` は domain だけを import し、`console` を使わない。`src/domain/` は domain のほかを import しない（`TextDecoder`・`String.prototype.normalize` のような JS の組み込みは使ってよい）。
- SQL はタグ付きテンプレート（`$queryRaw\`…\``・`$executeRaw\`…\``・`Prisma.sql\`…\``）だけ。`$queryRawUnsafe`と文字列の連結は使わない。時刻は`CAST(${now} AS TIMESTAMP(3))`、日付は `CAST(${day} AS DATE)`で渡す。持ち主のある書き込みは、WHERE に持ち主か状態を書き、変わった行の数で決める。interactive transaction は、いつも`{ maxWait, timeout }` を明示する。
- 時間の決まり（参照 §2・§6・§10・§11。`src/domain/line/line-message.ts` の `LINE_TIMING`）：配信の予算 45_000 ms、1 回の配信 55_000 ms、拾い直しの予算 50_000 ms、生成 20_000 ms ＋ 余白 10_000 ms ＝ 生成を始める最小の残り 30_000 ms、拾い直しの対象は 5 分（300_000 ms）より前の `pending`、1 回 20 行、お知らせは 1 回 100 件・月の残りから 30 通を残す・残り 3_000 ms を切ったら止める、終わった行は 7 日で消す。
- 応答（Go と同じ。`Cache-Control: no-store`、JSON の誤りは `{"error":{"code","message"}}`）：
  - webhook：LINE が使えない → `404 not_found`「見つかりません。」。1 MiB を超える → `413 too_large`「リクエストが大きすぎます。」。署名が違う → `401 unauthorized`「認証が必要です。」。読めない → `400 invalid_request`「リクエストが不正です。」。それ以外は、各イベントがどうなっても `200 {}`。
  - cron：使えない → `404 not_found`。秘密が違う → `401 unauthorized`。失敗 → `500 internal`「サーバーでエラーが発生しました。」。成功 → `204`。
- ログ（判断 13）：`LINE_EVENT_FAILED`・`LINE_EVENTS_TIMED_OUT`・`LINE_EVENT_WITHOUT_ID`・`LINE_REPLY_FAILED`・`LINE_PUSH_FAILED`・`LINE_MESSAGE_DEFERRED`・`LINE_MESSAGE_SETTLED`・`LINE_GENERATION_RETRY`・`LINE_MESSAGE_FAILED`・`LINE_THROTTLE_RESET_FAILED`・`LINE_REVIEW_NOTIFY_QUOTA_UNKNOWN`・`LINE_REVIEW_NOTIFY_LIMITED`・`LINE_REVIEW_NOTIFY_PUSH_FAILED`・`LINE_REVIEW_NOTIFY_SENT`・`LINE_DRAIN_FAILED`・`AI_USAGE_NOT_RECORDED`。値として出してよいのは `eventId`・`messageId`・`code`・`count`・`wanted`・`allowed`・エラーの名前だけ。
- テスト：`node --import tsx --test tests/<name>.test.ts`。全体は `pnpm test:regression`。e2e は 1 度に 1 本だけ（先に `docker ps`）。Go は変えないので、Go のテストは走らせなくてよい（e2e が Go をビルドする）。
- `git commit` と `git push` は、サンドボックスの外で行う。

## Review Focus

1. **署名を生のバイトで、一定の時間で確かめているか。** 1 バイト違う本文・違う秘密・空のヘッダー・Base64 でない・切れた署名・空の秘密を断る。→ Task 2 の `the signature is Go's HMAC over the raw bytes`、Task 5 の e2e `an unsigned or wrongly signed webhook is refused before anything is read`。
2. **同じ配信を 2 回処理しないか。** 同じ `webhookEventId` は、状態がどうであれ何も送らず何も作らない。→ Task 3 の `insertLineMessageSql ignores a second delivery`、Task 4 の `a redelivered event sends nothing`、Task 5 の e2e。
3. **Go と同じ表の意味か（切り替えのあいだ壊れないか）。** コードのハッシュ、状態と試行、`text` を消すこと、試行回数の鍵、`AiUsage.feature`。→ Task 1 の `link codes are read and hashed as Go does`、Task 3 の SQL のテスト、Task 5 の e2e `a code issued on the web page links through the webhook`。
4. **時間の決まりが Go と同じか。** 45 秒・30 秒・55 秒・50 秒・5 分・3 秒。→ Task 4 の `too little time left saves the text for the drain`、`the drain skips rows it cannot finish in time but still fails exhausted ones`、Task 5 の `the webhook stops starting events after 55 seconds`。
5. **指示と返信の文言が Go と 1 文字も違わないか。** → Task 1 の `the instructions are Go's, byte for byte` と `the reply copy is Go's`。
6. **だれが使えるか。** 会員と管理者だけ、デモと操作中の管理者は不可で `/` に戻る。→ Task 4 の `only members and admins who are themselves may link`、Task 5 の e2e。
7. **proxy が webhook と cron を通すか。** → Task 5 の `the LINE webhook and the cron routes are public` と e2e。
8. **秘密と本文がログに出ないか。** → Task 4 の `logs never carry text, ids or codes`。

---

### Task 1: LINE の決まり・返信の文言・添削と翻訳の指示

**Files:**

- Create: `src/domain/line/line-text.ts`、`src/domain/line/link-code.ts`、`src/domain/line/line-replies.ts`、`src/domain/line/line-message.ts`、`src/infrastructure/openai/line-learning.ts`
- Modify: `src/infrastructure/openai/responses.ts`（`OpenAiError` に `retryable`）
- Test: `tests/line-text.test.ts`、`tests/line-link-code.test.ts`、`tests/line-replies.test.ts`、`tests/line-learning.test.ts`（すべて新規）、`tests/openai-responses.test.ts`（足す）

**Interfaces:**

```ts
// src/domain/line/line-text.ts
// Go: line.MaxTextRunes. Counted in code points (an emoji is one).
export const LINE_TEXT_MAX_CODE_POINTS = 500;
export type LineLearningKind = "correction" | "translation";
export type LineTextRoute = LineLearningKind | "too-long" | "unsupported";
// Go: line.Classify. Length first; any Hiragana or Katakana means
// translation; otherwise any Han means correction.
export function classifyLineText(text: string): LineTextRoute;

// src/domain/line/link-code.ts
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 600_000;
// Go: throttleLimit per throttleWindow on "line-link:<LINE user id>".
export const LINK_REDEEM_THROTTLE: ThrottleRule; // { limit: 5, windowMs: 3_600_000 }
export function lineLinkThrottleKey(lineUserId: string): string; // "line-link:" + id
// Go: IssueCode. Each of the 8 bytes picks ALPHABET[byte % 32].
export function linkCodeFromBytes(bytes: Uint8Array): string; // throws RangeError unless 8 bytes
// Go: codeShape. NFKC, trim, upper case; the code when it is exactly 8
// characters of the alphabet, else null.
export function readLinkCode(text: string): string | null;

// src/domain/line/line-replies.ts (the copy is reference §9, verbatim)
export const LINE_REPLY: {
  readonly linked: string; readonly relinked: string; readonly badCode: string;
  readonly throttled: string; readonly notLinked: string; readonly linkGone: string;
  readonly tooLong: string; readonly usage: string; readonly slow: string;
};
export const LINE_MESSAGE_MAX_CODE_POINTS = 5000;
export type LineGeneration = { text: string; pinyin: string; hints: string[] };
// Go: FormatResult.
export function formatLineResult(kind: LineLearningKind, original: string, generation: LineGeneration): string;
// Go: FormatFailure.
export function formatLineFailure(kind: LineLearningKind, code: string): string;
// Go: FormatReviewReminder.
export function formatReviewReminder(due: number): string;

// src/domain/line/line-message.ts
export type LineMessageStatus = "pending" | "done" | "failed";
export type LineMessage = {
  id: string; webhookEventId: string; lineUserId: string; ownerId: string;
  kind: LineLearningKind; text: string; // "" once done or failed
  status: LineMessageStatus; attempts: number; createdAt: Date;
};
export type LineLink = { lineUserId: string; ownerId: string; role: string; createdAt: Date };
export type LineEvent = {
  webhookEventId: string; replyToken: string; userId: string;
  text: string; // "" unless isText
  isText: boolean; fromUser: boolean;
};
export type ReviewNotifyTarget = { lineUserId: string; ownerId: string; role: string; due: number };
export type LinePushQuota = { unlimited: true } | { unlimited: false; remaining: number };
// A failed generation: the OpenAI code, and whether a later attempt may work.
export type GenerationFailure = { code: string; retryable: boolean };
export const LINE_MAX_ATTEMPTS = 2;
export const LINE_DRAIN_BATCH = 20;
export const LINE_RETENTION_MS = 604_800_000;
export const LINE_EXHAUSTED_CODE = "OPENAI_TIMEOUT";
export const LINE_LINK_GONE_CODE = "LINK_GONE";
export const REVIEW_NOTIFY_BATCH = 100;
export const REVIEW_NOTIFY_PUSH_RESERVE = 30;
export const LINE_TIMING: {
  readonly webhookDeliveryBudgetMs: 45_000; readonly webhookEventsTimeoutMs: 55_000;
  readonly drainBudgetMs: 50_000; readonly minTimeLeftMs: 30_000;
  readonly staleAfterMs: 300_000; readonly pushMarginMs: 3_000;
};
// Go: NotifyDueReviews' budget. min(targets, remaining - 30) when limited,
// never below 0.
export function reviewNotifyBudget(targets: number, quota: LinePushQuota): number;

// src/infrastructure/openai/responses.ts
export class OpenAiError extends Error {
  constructor(readonly code: OpenAiErrorCode, readonly retryable = false);
}

// src/infrastructure/openai/line-learning.ts
export const LINE_CORRECTION_INSTRUCTIONS: string; // reference §7.1, verbatim
export const LINE_TRANSLATION_INSTRUCTIONS: string; // reference §7.1, verbatim
// Go: specs[kind] + jsonSchema(): schemaName, strict schema, instructions.
export function lineLearningRequest(kind: LineLearningKind, text: string): JsonRequest;
// Go: kindSpec.parse. null when the model's JSON is not exactly the three
// fields within the limits.
export function parseLineLearning(kind: LineLearningKind, raw: string): LineGeneration | null;
// Asks for the correction or translation of text; OPENAI_INVALID_RESPONSE
// when the answer does not parse.
export async function generateLineLearning(
  respond: (request: JsonRequest) => Promise<string>,
  kind: LineLearningKind,
  text: string,
): Promise<LineGeneration>;
```

`ThrottleRule` は `src/domain/identity/sign-in-throttle.ts` のもの。`lineLearningRequest` の `schemaName` は `chinese_correction`／`japanese_to_chinese_translation`、`schema` は参照 §7 のもの（`textKey` は `correctedText`／`translatedText`）、`input` は `text`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/line-text.test.ts`：`the route is Go's Classify`：`"我喜欢学习"` → `correction`、`"今日は雨"`・`"カタカナ"`・`"漢字カナ"` → `translation`、`"hello"`・`""`・`"123 !?"` → `unsupported`、`"漢".repeat(499) + "😀"` → `correction`、それに `"字"` を足す → `too-long`、`"a".repeat(501)`・`"あ".repeat(501)` → `too-long`。`LINE_TEXT_MAX_CODE_POINTS === 500`。
  - `tests/line-link-code.test.ts`：
    - `link codes are read and hashed as Go does`：`readLinkCode` が `"ABCD2345"`・`" abcd2345 "`・`"ＡＢＣＤ２３４５"`・`"　ａｂｃｄ２３４５　"` → `"ABCD2345"`。`"ABCD234"`・`"ABCD23456"`・`"ABCD2340"`・`"ABCD2341"`・`"ABCDO345"`・`"ABCDI345"`・`"ABCD 345"`・`"你好你好你好你好"`・`""` → `null`。
    - `a code is one alphabet letter per byte`：`linkCodeFromBytes(Uint8Array.from([0, 31, 32, 255, 8, 23, 24, 63]))` → `"A9A9JZ29"`（`byte % 32`）。7 バイトと 9 バイトは `RangeError`。
    - `the redeem throttle is Go's`：`LINK_REDEEM_THROTTLE` が `{ limit: 5, windowMs: 3600000 }`、`lineLinkThrottleKey("U1") === "line-link:U1"`、`LINK_CODE_TTL_MS === 600000`。
  - `tests/line-replies.test.ts`：
    - `the reply copy is Go's`：`LINE_REPLY` の 9 つが参照 §9 の表と同じ（テストに全文を書く）。
    - `a result reads like Go's FormatResult`：`formatLineResult("correction", "我去了学校", { text: "我去学校了", pinyin: "wǒ qù xuéxiào le", hints: ["了の位置", "語順"] })` が `"【元の文】\n我去了学校\n\n【添削後】\n我去学校了\n\n【ピンイン】\nwǒ qù xuéxiào le\n\n【ヒント】\n・了の位置\n・語順\n\n学習ノートに保存しました"`。`translation` は見出しが `【中国語訳】`。`pinyin: ""` と `hints: []` の節は出さない（`"【元の文】\nx\n\n【添削後】\ny\n\n学習ノートに保存しました"`）。
    - `an oversized result is cut to one LINE message`：本文 `"字".repeat(6000)` → 全体が 5000 コードポイントで、`"\n\n学習ノートに保存しました"` で終わる。`"😀".repeat(6000)` でも 5000 コードポイント（サロゲートの途中で切らない）。
    - `failures name the reason and the code`：`formatLineFailure("correction", "OPENAI_RATE_LIMITED")` が `"添削できませんでした。AI の利用が混み合っています。しばらくしてからもう一度送ってください。\n（コード: OPENAI_RATE_LIMITED）"`、`("translation", "OPENAI_TIMEOUT")` が `"翻訳できませんでした。AI の返事が間に合いませんでした。しばらくしてからもう一度送ってください。\n（コード: OPENAI_TIMEOUT）"`、`OPENAI_INVALID_RESPONSE`・`OPENAI_AUTH_FAILED` は参照 §9 の理由、`"LINK_GONE"` と `"OPENAI_REQUEST_FAILED"` は「うまく処理できませんでした。しばらくしてからもう一度送ってください。」。
    - `the review reminder is Go's`：`formatReviewReminder(3)` が `"今日の復習が 3 問あります。Web の「今日の復習」（/review）で答えましょう。\n\nこのお知らせは、Web のアカウント画面（/account/line）で止められます。"`。
    - `the push budget keeps 30 for late corrections`：`reviewNotifyBudget(5, { unlimited: true }) === 5`、`(5, { unlimited: false, remaining: 200 }) === 5`、`(5, { unlimited: false, remaining: 32 }) === 2`、`(5, { unlimited: false, remaining: 10 }) === 0`。
  - `tests/line-learning.test.ts`：
    - `the instructions are Go's, byte for byte`：テストに参照 §7.1 の 2 つの全文を `"…\n" +` でつないで書き、`assert.equal`。加えて `length` が 244 と 246、`createHash("sha256")` の 16 進が `cf761871f2e23d3542a4d3c7380841a2f150a36c7233825f49a961fb036c77f0` と `45b941a768e028089ca14f16ef892b4d1c5c2128dbea2a1c3c3dbfe889211446`。
    - `the request is Go's`：`lineLearningRequest("correction", "我去了")` が `{ instructions: LINE_CORRECTION_INSTRUCTIONS, schemaName: "chinese_correction", schema: { type: "object", properties: { correctedText: { type: "string" }, pinyin: { type: "string" }, hints: { type: "array", items: { type: "string" } } }, required: ["correctedText", "pinyin", "hints"], additionalProperties: false }, input: "我去了" }` と `deepEqual`。翻訳は `japanese_to_chinese_translation`・`translatedText`。
    - `the model's answer is checked as Go checked it`（`parseLineLearning`）：`{"correctedText":" 我去学校了 ","pinyin":"wǒ","hints":[" a "]}` → `{ text: "我去学校了", pinyin: "wǒ", hints: ["a"] }`。`null`：JSON でない、4 つのキー、2 つのキー、`correctedText` が数・`null`・空白だけ、`translatedText` のキー（correction のとき）、ヒント 0 個・6 個・`null`・数を含む、`"字".repeat(1001)` の本文、`"a".repeat(1601)` のピンイン、`"あ".repeat(201)` のヒント。境界 `"字".repeat(1000)`・`"a".repeat(1600)`・`"あ".repeat(200)`・ヒント 5 個は通る。
    - `an unusable answer is OPENAI_INVALID_RESPONSE`：`generateLineLearning(async () => "{}", "correction", "x")` が `OpenAiError` で `code === "OPENAI_INVALID_RESPONSE"`、`retryable === false`。
  - `tests/openai-responses.test.ts` に足す：`only transport failures and 5xx may be retried`：500・503 → `OPENAI_REQUEST_FAILED` で `retryable === true`。400・404 → `retryable === false`。401・403・429 → `false`。`fetch` が投げる → `true`（`TypeError` は `OPENAI_REQUEST_FAILED`、`TimeoutError` は `OPENAI_TIMEOUT`）。1 MiB を超える本文 → `OPENAI_INVALID_RESPONSE` で `false`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/line-text.test.ts tests/line-link-code.test.ts tests/line-replies.test.ts tests/line-learning.test.ts tests/openai-responses.test.ts` → FAIL。
- [ ] **Step 3: 実装する。**
  - `classifyLineText`：`[...text].length > 500` → `too-long`。`/[\p{Script=Hiragana}\p{Script=Katakana}]/u` → `translation`。`/\p{Script=Han}/u` → `correction`。それ以外 `unsupported`。
  - `readLinkCode`：`text.normalize("NFKC").trim().toUpperCase()`。`[...n].length === 8` で、すべて `LINK_CODE_ALPHABET` に含まれれば `n`。
  - `formatLineResult`：Go と同じ節の組み立て。本文を `[...body]` で数え、`5000 - [...suffix].length` を超えたら `[...body].slice(0, limit).join("")`。
  - `OpenAiError`：`constructor(readonly code: OpenAiErrorCode, readonly retryable = false)`。`respondJson` の 5xx を `new OpenAiError("OPENAI_REQUEST_FAILED", response.status >= 500)`、`transportError` の 2 つを `retryable` 付きに。`answer-stream.ts` の呼び出しはそのまま（`retryable` を見ない）。
  - `parseLineLearning`：`JSON.parse` が投げる・プレーンなオブジェクトでない・`Object.keys(...).length !== 3` → `null`。本文とピンインは `typeof === "string"`、ヒントは文字列の配列。`trim()` してコードポイントで数える（`vocabulary-draft.ts` の `clean` と同じ形）。
  - 各関数の上に、Go のどの関数か（ファイルと行）を英語のコメントで 1 行書く。指示の定数は、行頭に空白を入れないテンプレート文字列（`quick-question.ts` と同じ）。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): LINE の決まりと添削・翻訳の指示を Go から写す`

### Task 2: LINE とのやりとり（署名・webhook・Messaging API）と設定

**Files:**

- Create: `src/infrastructure/line/line-signature.ts`、`src/infrastructure/line/line-webhook.ts`、`src/infrastructure/line/line-messaging.ts`、`src/infrastructure/line/link-code-crypto.ts`、`src/infrastructure/security/bearer-secret.ts`
- Modify: `src/infrastructure/config/environment.ts`
- Test: `tests/line-signature.test.ts`、`tests/line-webhook.test.ts`、`tests/line-messaging.test.ts`、`tests/bearer-secret.test.ts`（すべて新規）、`tests/identity-environment.test.ts`（足す。環境変数のテストがここにある。無ければ `tests/line-environment.test.ts` を新規）

**Interfaces:**

```ts
// src/infrastructure/line/line-signature.ts
// Go: line.VerifySignature. signature is the X-Line-Signature header.
export function verifyLineSignature(secret: string, body: Uint8Array, signature: string | null): boolean;

// src/infrastructure/line/line-webhook.ts
// Go: line.ParseWebhook. The message events of a delivery; null when Go's
// json.Unmarshal would have refused the body.
export function parseLineWebhook(body: Uint8Array): LineEvent[] | null;

// src/infrastructure/line/line-messaging.ts
export class LineApiError extends Error {
  // null: the request was not sent or not answered. Never carries the
  // token, the reply token, the recipient or the text.
  constructor(readonly status: number | null);
  override name: "LineApiError";
}
export function createLineMessaging(
  config: { accessToken: string; apiBaseUrl: string },
  fetchImpl?: typeof fetch,
): {
  reply(replyToken: string, texts: string[]): Promise<void>;
  push(to: string, texts: string[]): Promise<void>;
  pushQuota(): Promise<LinePushQuota>;
};

// src/infrastructure/line/link-code-crypto.ts
export function newLinkCode(): string; // linkCodeFromBytes(randomBytes(8))
export function hashLinkCode(code: string): string; // SHA-256, lowercase hex

// src/infrastructure/security/bearer-secret.ts
// Go: bearerMatches. Whether header is "Bearer <secret>"; a missing secret
// never matches; constant time whatever the token's length.
export function bearerMatches(header: string | null, secret: string | undefined): boolean;

// src/infrastructure/config/environment.ts
export type LineConfig = { channelSecret: string; accessToken: string; apiBaseUrl: string };
// LINE works only with both LINE values and OpenAI configured (Go's
// LineEnabled with LoadConfig's all-or-nothing rule). LINE_API_BASE_URL is
// for tests: an http(s) loopback URL, anything else means not configured.
export function lineConfig(): LineConfig | undefined;
// The secret Vercel Cron presents; undefined when unset (every cron call is
// then refused).
export function cronSecret(): string | undefined;
```

決まり：

- `verifyLineSignature`：`secret === ""`・`signature` が `null` か `""` → `false`。`expected = createHmac("sha256", secret).update(body).digest("base64")`、`timingSafeEqual(sha256(expected), sha256(signature))`（判断 3）。
- `parseLineWebhook`：`new TextDecoder().decode(body)` を `JSON.parse`（投げたら `null`）。Go の `json.Unmarshal` に合わせる：トップが `null` → `[]`、オブジェクトでない → `null`。`events` が無い・`null` → `[]`、配列でない → `null`。要素が `null` → 読み飛ばす（Go では種類 `""` になり捨てられる）、オブジェクトでない → `null`。`type`・`webhookEventId`・`replyToken`・`source.type`・`source.userId`・`message.type`・`message.text` は、無い・`null` なら `""`、文字列でなければ `null`。`source`・`message` は、無い・`null` なら空、オブジェクトでなければ `null`。残すのは `type === "message"` だけ。`text` は `isText` のときだけ。
- `createLineMessaging`：`POST ${base}/v2/bot/message/reply` に `{"replyToken", "messages": [{"type":"text","text"}…]}`、`POST …/push` に `{"to", "messages"}`。ヘッダー `Content-Type: application/json`、`Authorization: Bearer <token>`。`redirect: "manual"`、`signal: AbortSignal.timeout(10_000)`。`texts` が 0 個か 6 個以上なら、送らずに `LineApiError(null)`。2xx 以外 → 本文を捨てて `LineApiError(status)`、送れない → `LineApiError(null)`。`base` の末尾の `/` は除く。`pushQuota`：`GET …/v2/bot/message/quota`（`Authorization` だけ）、`{"type":"none"}` → `{ unlimited: true }`、`{"type":"limited","value":N}` → `GET …/v2/bot/message/quota/consumption` の `totalUsage`（数でなければ `LineApiError(null)`）→ `{ unlimited: false, remaining: Math.max(N - U, 0) }`、ほかの `type` → `LineApiError(null)`。本文は 1 MiB まで読む（超えたら `LineApiError(null)`）。
- `bearerMatches`：`secret` が無いか `""` → `false`。最初の `" "` で分け、方式を `toLowerCase() === "bearer"`、トークンが空でない、`timingSafeEqual(sha256(secret), sha256(token))`。
- `lineConfig`：`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN` を `trim()` してどちらも空でなく、`openAiConfig()` があるときだけ。`LINE_API_BASE_URL` は空なら `https://api.line.me`、あれば `isLoopbackHttpUrl`（今のもの）に合うときだけ、合わなければ `undefined`。`cronSecret`：`CRON_SECRET?.trim()`、空なら `undefined`。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/line-signature.test.ts`：`the signature is Go's HMAC over the raw bytes`：秘密 `"channel-secret"`、本文 `{"events":[]}` のバイト、署名は `createHmac` の Base64 → `true`。`false`：本文 `{"events":[ ]}`、秘密 `"other"`、署名 `null`・`""`、`"!!!not-base64!!!"`、最後の 4 文字を切った署名、秘密 `""`（空の秘密で作った署名でも）、正しい署名の末尾に `"!"` を足したもの（Node の Base64 の緩さに頼らない）。本文に UTF-8 でないバイト（`0xff`）を含んでも、そのバイト列の HMAC なら `true`。
  - `tests/line-webhook.test.ts`：`deliveries are read as Go's ParseWebhook reads them`：
    - `{"events":[]}`・`{}`・`null`・`{"events":null}` → `[]`。
    - テキスト：`{"events":[{"type":"message","webhookEventId":"E1","replyToken":"r1","source":{"type":"user","userId":"U1"},"message":{"type":"text","text":"你好"}}]}` → `[{ webhookEventId: "E1", replyToken: "r1", userId: "U1", text: "你好", isText: true, fromUser: true }]`。
    - `source.type` が `group`・`room` → `fromUser: false`（`userId` はそのまま）。`message.type` が `sticker` → `isText: false`、`text: ""`（本文に `text` があっても）。
    - `follow`・`unfollow` のイベントは捨て、間の `message` は残る。要素の `null` は捨てる。知らないフィールドは無視。
    - `null`：`not json`、`[]`、`"x"`、`{"events":{}}`、`{"events":[1]}`、`{"events":[{"type":5}]}`、`{"events":[{"type":"message","source":"x"}]}`、`{"events":[{"type":"message","message":{"text":7}}]}`。
  - `tests/line-messaging.test.ts`（`fetch` の偽物で URL・ヘッダー・本文・`redirect`・`signal` を記録する）：
    - `replies and pushes are Go's requests`：`reply("tok", ["a", "b"])` が `POST http://127.0.0.1:1/v2/bot/message/reply`（`apiBaseUrl` が `http://127.0.0.1:1/`）、ヘッダー 2 つ、本文の `JSON.parse` が `{ replyToken: "tok", messages: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }`、`redirect: "manual"`、`signal` がある。`push("U1", ["c"])` は `…/push` に `{ to: "U1", messages: [{ type: "text", text: "c" }] }`。
    - `message counts outside 1 to 5 are refused before sending`：0 個と 6 個は `LineApiError`（`status === null`）、`fetch` は呼ばれない。
    - `errors never carry secrets`：500 → `LineApiError` で `status === 500`、`fetch` が投げる → `status === null`。どちらも `String(error)` と `error.message` にトークン `"secret-token"`・reply token・宛先・本文が含まれない。302 → `status === 302`。
    - `the push quota is Go's PushQuota`：`{"type":"none"}` → `{ unlimited: true }`（2 つ目の `GET` は無い）。`{"type":"limited","value":200}` と `{"totalUsage":170}` → `{ unlimited: false, remaining: 30 }`、`totalUsage: 250` → `remaining: 0`。`{"type":"other"}`、`totalUsage` が無い、200 以外、JSON でない → `LineApiError`。
  - `tests/bearer-secret.test.ts`：`only "Bearer <CRON_SECRET>" passes`：秘密 `"cron-secret-value"`。`true`：`"Bearer cron-secret-value"`、`"bearer cron-secret-value"`、`"BEARER cron-secret-value"`。`false`：`null`、`""`、`"Bearer"`、`"Bearer "`、`"Basic cron-secret-value"`、`"Bearer wrong"`、`"Bearer cron-secret-value "`（末尾の空白もトークンの一部）、`"cron-secret-value"`。秘密が `undefined`・`""` なら `"Bearer "` + 何でも `false`。
  - 環境変数のテスト（`process.env` を書き換えて戻す、今のテストと同じ形）：`lineConfig needs both LINE values and OpenAI`：3 つそろう → `{ channelSecret, accessToken, apiBaseUrl: "https://api.line.me" }`、前後の空白は除く。どれか 1 つ欠ける → `undefined`。`LINE_API_BASE_URL="http://127.0.0.1:3111"` → その URL、`"https://example.com"` → `undefined`。`cronSecret`：`" s "` → `"s"`、`""`・無し → `undefined`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/line-signature.test.ts tests/line-webhook.test.ts tests/line-messaging.test.ts tests/bearer-secret.test.ts tests/identity-environment.test.ts` → FAIL。
- [ ] **Step 3: 実装する。** 上の決まりのとおり。各関数の上に、Go のどの関数か（参照の節）を英語のコメントで書く。`line-messaging.ts` の先頭に「errors never contain the access token, the reply token, the recipient or the text (Go: line/client.go)」と書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): LINE の署名・webhook・Messaging API を Web で扱う`

### Task 3: LINE の表を Prisma で読み書きする

**Files:**

- Create: `src/infrastructure/prisma/line-link-store.ts`、`src/infrastructure/prisma/line-message-store.ts`
- Test: `tests/line-link-store.test.ts`、`tests/line-message-store.test.ts`（どちらも新規。DB は使わない。`Prisma.Sql` の `sql`（空白をつぶす）と `values` を見る。`tests/sign-in-throttle-store.test.ts` と同じ形）

**Interfaces:**

```ts
// src/infrastructure/prisma/line-link-store.ts
// Pure: Go's PutLineLinkCode (replaces the owner's previous code).
export function putLinkCodeSql(
  ownerId: string,
  role: string,
  codeHash: string,
  expiresAt: Date,
): Prisma.Sql;
// Pure: Go's ListReviewNotifyTargets; japanDay is now's JST date (YYYY-MM-DD).
export function reviewNotifyTargetsSql(
  now: Date,
  japanDay: string,
  limit: number,
): Prisma.Sql;
// Pure: Go's ClaimReviewNotify.
export function claimReviewNotifySql(
  lineUserId: string,
  japanDay: string,
): Prisma.Sql;
export const LINE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };
export function createLineLinkStore(db: () => PrismaClient): {
  find(lineUserId: string): Promise<LineLink | null>;
  status(ownerId: string): Promise<{ linked: boolean; reviewNotify: boolean }>;
  // false: no LINE account is linked.
  setReviewNotify(ownerId: string, on: boolean): Promise<boolean>;
  unlinkOwner(ownerId: string): Promise<void>;
  unlinkLineUser(lineUserId: string): Promise<void>;
  putCode(
    ownerId: string,
    role: "member" | "admin",
    codeHash: string,
    expiresAt: Date,
  ): Promise<void>;
  // null: unknown or expired. relinked: this LINE account was linked before.
  redeemCode(
    codeHash: string,
    lineUserId: string,
    now: Date,
  ): Promise<{ ownerId: string; role: string; relinked: boolean } | null>;
  reviewNotifyTargets(now: Date, limit: number): Promise<ReviewNotifyTarget[]>;
  claimReviewNotify(lineUserId: string, now: Date): Promise<boolean>;
  // Go: store.MemberExists ("password:<id>" or "ffpf:<id>").
  memberExists(ownerId: string): Promise<boolean>;
};

// src/infrastructure/prisma/line-message-store.ts
// Pure: Go's InsertLineMessage insert (no row back on a second delivery).
export function insertLineMessageSql(
  id: string,
  message: {
    webhookEventId: string;
    lineUserId: string;
    ownerId: string;
    kind: LineLearningKind;
    text: string;
  },
  now: Date,
): Prisma.Sql;
// Pure: Go's StartLineMessageAttempt.
export function startAttemptSql(id: string, now: Date): Prisma.Sql;
export function createLineMessageStore(
  db: () => PrismaClient,
  newRowId?: () => string,
): {
  // created false: the event was delivered before; the stored row comes back.
  insert(
    message: {
      webhookEventId: string;
      lineUserId: string;
      ownerId: string;
      kind: LineLearningKind;
      text: string;
    },
    now: Date,
  ): Promise<{ message: LineMessage; created: boolean }>;
  // null: unknown, no longer pending, or out of attempts.
  startAttempt(id: string, now: Date): Promise<LineMessage | null>;
  // Saves the note (a "LINE" import batch) and marks the message done, in
  // one transaction. false (nothing saved): not the owner's pending message.
  complete(
    id: string,
    ownerId: string,
    note: {
      kind: LineLearningKind;
      originalText: string;
      generation: LineGeneration;
    },
    now: Date,
  ): Promise<boolean>;
  fail(id: string, now: Date): Promise<void>;
  listStale(createdBefore: Date, limit: number): Promise<LineMessage[]>;
  // Done and failed messages older than 7 days, and expired codes.
  prune(now: Date): Promise<void>;
};
```

SQL（参照 §12 の Go の文と同じ。`<cols>` は `"id", "webhookEventId", "lineUserId", "ownerId", "kind", COALESCE("text", '') AS "text", "status", "attempts", "createdAt"`）：

```sql
-- putLinkCodeSql
INSERT INTO "LineLinkCode" ("codeHash", "ownerId", "role", "expiresAt")
VALUES (${codeHash}, ${ownerId}, ${role}, CAST(${expiresAt} AS TIMESTAMP(3)))
ON CONFLICT ("ownerId") DO UPDATE SET
  "codeHash" = EXCLUDED."codeHash", "role" = EXCLUDED."role", "expiresAt" = EXCLUDED."expiresAt"

-- redeemCode, in one interactive transaction (LINE_TRANSACTION_OPTIONS)
DELETE FROM "LineLinkCode" WHERE "codeHash" = ${codeHash} AND "expiresAt" > CAST(${now} AS TIMESTAMP(3)) RETURNING "ownerId", "role"
DELETE FROM "LineLink" WHERE "ownerId" = ${ownerId} OR "lineUserId" = ${lineUserId} RETURNING "lineUserId"
INSERT INTO "LineLink" ("lineUserId", "ownerId", "role", "createdAt") VALUES (${lineUserId}, ${ownerId}, ${role}, CAST(${now} AS TIMESTAMP(3)))

-- reviewNotifyTargetsSql
SELECT l."lineUserId", l."ownerId", l."role", d."due"
FROM "LineLink" l
CROSS JOIN LATERAL (
  SELECT count(*) AS "due" FROM "ReviewItem"
  WHERE "ReviewItem"."ownerId" = l."ownerId" AND "ReviewItem"."due" <= CAST(${now} AS TIMESTAMP(3))
    AND NOT EXISTS (SELECT 1 FROM "LearningEntry" e
      WHERE "ReviewItem"."kind" = 'entry' AND e."id" = "ReviewItem"."targetId"
        AND e."ownerId" = "ReviewItem"."ownerId" AND e."deletedAt" IS NOT NULL)
) d
WHERE l."reviewNotify" AND (l."reviewNotifiedOn" IS NULL OR l."reviewNotifiedOn" < CAST(${japanDay} AS DATE)) AND d."due" > 0
ORDER BY l."createdAt", l."lineUserId"
LIMIT ${limit}

-- claimReviewNotifySql
UPDATE "LineLink" SET "reviewNotifiedOn" = CAST(${japanDay} AS DATE)
WHERE "lineUserId" = ${lineUserId} AND "reviewNotify"
  AND ("reviewNotifiedOn" IS NULL OR "reviewNotifiedOn" < CAST(${japanDay} AS DATE))

-- insertLineMessageSql
INSERT INTO "LineMessage" ("id", "webhookEventId", "lineUserId", "ownerId", "kind", "text", "status", "attempts", "createdAt", "updatedAt")
VALUES (${id}, ${webhookEventId}, ${lineUserId}, ${ownerId}, ${kind}, ${text}, 'pending', 0, CAST(${now} AS TIMESTAMP(3)), CAST(${now} AS TIMESTAMP(3)))
ON CONFLICT ("webhookEventId") DO NOTHING
RETURNING <cols>

-- startAttemptSql
UPDATE "LineMessage" SET "attempts" = "attempts" + 1, "updatedAt" = CAST(${now} AS TIMESTAMP(3))
WHERE "id" = ${id} AND "status" = 'pending' AND "attempts" < ${LINE_MAX_ATTEMPTS}
RETURNING <cols>
```

ほかは Prisma のクエリで書く：

- `find`：`lineLink.findUnique({ where: { lineUserId }, select: { lineUserId, ownerId, role, createdAt } })`。
- `status`：`lineLink.findUnique({ where: { ownerId }, select: { reviewNotify: true } })` → 無ければ `{ linked: false, reviewNotify: false }`（Go の 2 つの副問い合わせと同じ答え）。
- `setReviewNotify`：`lineLink.updateMany({ where: { ownerId }, data: { reviewNotify: on } })`、`count > 0`。
- `unlinkOwner`／`unlinkLineUser`：`deleteMany`。
- `redeemCode`：上の 3 つの文を `db().$transaction(async (tx) => …, LINE_TRANSACTION_OPTIONS)` で。1 つ目が 0 行なら `null` を返す（何も書いていないので、そのまま終えてよい）。`relinked` は 2 つ目が返した `lineUserId` に、この LINE のユーザーがあるか。
- `reviewNotifyTargets`：`$queryRaw<{ lineUserId; ownerId; role; due: bigint }[]>`、`due` は `Number(due)`。`japanDay` は `japanDate(now)`（`src/domain/review/review-days.ts`）。
- `claimReviewNotify`：`$executeRaw(claimReviewNotifySql(…)) === 1`。
- `memberExists`：`password:` → `passwordAccount.count({ where: { id } }) > 0`、`ffpf:` → `ffpfAccount` の同じもの、ほか → `false`（DB を読まない）。
- `insert`：`$queryRaw(insertLineMessageSql(newRowId(), …))`。1 行なら `created: true`。0 行なら `lineMessage.findUnique({ where: { webhookEventId } })` を `LineMessage` にして `created: false`。Go は 2 つの文を 1 つのトランザクションにしていたが、`ON CONFLICT DO NOTHING` は先の行の確定を待ち、READ COMMITTED の次の SELECT はその行を見るので、トランザクションは要らない（コメントに書く）。
- `startAttempt`：`$queryRaw(startAttemptSql(…))` の 1 行目か `null`。
- `complete`：`db().$transaction(async (tx) => { … }, LINE_TRANSACTION_OPTIONS)`。`importBatch.create({ data: { id, fileName: "LINE", rowCount: 1, importedAt: now } })`、`learningEntry.create({ data: { id, kind, originalText, correctedText: generation.text, pinyin: generation.pinyin, createdAt: now, ownerId, batchId } })`、`hint.createMany({ data: hints.map((content, position) => ({ id: newId(), content, position, learningEntryId })) })`（ヒントが 0 個なら呼ばない）、`lineMessage.updateMany({ where: { id, ownerId, status: "pending" }, data: { status: "done", entryId, text: null, updatedAt: now } })`。`count === 0` なら、このファイルだけの `NotPendingError` を投げて巻き戻し、外で `false` にする。
- `fail`：`lineMessage.updateMany({ where: { id, status: "pending" }, data: { status: "failed", text: null, updatedAt: now } })`。
- `listStale`：`findMany({ where: { status: "pending", createdAt: { lt: createdBefore } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit })`。
- `prune`：`lineMessage.deleteMany({ where: { status: { in: ["done", "failed"] }, updatedAt: { lt: new Date(now.getTime() - LINE_RETENTION_MS) } } })` のあと `lineLinkCode.deleteMany({ where: { expiresAt: { lte: now } } })`。
- `now` は呼ぶ側が 1 度だけ読み、ミリ秒に切ったものを渡す。行の `kind` は `"correction" | "translation"`（CHECK で守られている）として読む。

- [ ] **Step 1: 失敗するテストを書く。**（`now = new Date("2026-11-17T21:00:00.000Z")`、`japanDay = "2026-11-18"`）
  - `tests/line-link-store.test.ts`：
    - `putLinkCodeSql replaces the owner's code as Go did`：文が `INSERT INTO "LineLinkCode"`、`CAST($4 AS TIMESTAMP(3))`、`ON CONFLICT ("ownerId") DO UPDATE SET "codeHash" = EXCLUDED."codeHash", "role" = EXCLUDED."role", "expiresAt" = EXCLUDED."expiresAt"` を含み、値は `["h", "password:c1", "member", expiresAt]`。
    - `reviewNotifyTargetsSql counts due items but not trashed notes`：文が `CROSS JOIN LATERAL`、`"ReviewItem"."due" <= CAST($1 AS TIMESTAMP(3))`、`"ReviewItem"."kind" = 'entry'`、`e."deletedAt" IS NOT NULL`、`"reviewNotifiedOn" < CAST($2 AS DATE)`、`d."due" > 0`、`ORDER BY l."createdAt", l."lineUserId"`、`LIMIT $3` を含み、値は `[now, "2026-11-18", 100]`。
    - `claimReviewNotifySql claims the JST day once`：文が `SET "reviewNotifiedOn" = CAST($1 AS DATE)`、`AND "reviewNotify"`、`"reviewNotifiedOn" < CAST($3 AS DATE)` を含み、値は `["2026-11-18", "U1", "2026-11-18"]`。
    - `memberExists reads only member prefixes`：偽の `db` で、`"password:c1"` は `passwordAccount.count({ where: { id: "c1" } })`、`"ffpf:s1"` は `ffpfAccount.count({ where: { id: "s1" } })`、`"10001"`・`"guest"` は DB を読まず `false`。
    - `redeemCode moves both links in one transaction`：偽の `tx` で、1 つ目の DELETE が 0 行 → `null`、ほかの文は流れない。1 行 `{ ownerId: "password:c1", role: "member" }`、2 つ目が `[{ lineUserId: "U1" }]` → `{ ownerId: "password:c1", role: "member", relinked: true }`、`[{ lineUserId: "U9" }]` や `[]` → `relinked: false`。3 つ目は `lineLink.create` に `{ lineUserId: "U1", ownerId: "password:c1", role: "member", createdAt: now }`。`$transaction` に `{ maxWait: 5000, timeout: 15000 }` が渡る。
  - `tests/line-message-store.test.ts`：
    - `insertLineMessageSql ignores a second delivery`：文が `'pending', 0, CAST($7 AS TIMESTAMP(3)), CAST($8 AS TIMESTAMP(3))`、`ON CONFLICT ("webhookEventId") DO NOTHING`、`RETURNING`、`COALESCE("text", '')` を含み、値は `["cid", "E1", "U1", "password:c1", "correction", "你好", now, now]`。
    - `startAttemptSql allows two attempts`：文が `"attempts" = "attempts" + 1`、`"status" = 'pending' AND "attempts" < $3` を含み、値は `[now, "cid", 2]`。
    - `complete saves the note and settles the message together`：偽の `tx` で、`importBatch.create` の `fileName === "LINE"`・`rowCount === 1`・`importedAt === now`、`learningEntry.create` の `correctedText`・`pinyin`・`createdAt === now`・`batchId`、`hint.createMany` の `position` が 0, 1、`lineMessage.updateMany` の `where` が `{ id: "cid", ownerId: "password:c1", status: "pending" }`・`data` が `{ status: "done", entryId, text: null, updatedAt: now }`。`count: 1` → `true`。`count: 0` → `false` で、`$transaction` のコールバックが投げている（巻き戻る）。
    - `a second delivery returns the stored row`：`$queryRaw` が `[]`、`findUnique` が `{ … text: null … }` → `{ created: false }`、`message.text === ""`。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/line-link-store.test.ts tests/line-message-store.test.ts` → FAIL。
- [ ] **Step 3: 実装する。** 上のとおり。ファイルの先頭のコメントに、Go のどの文と同じか（参照 §12）と、Go と同じ意味で書くわけ（判断 4）を書く。
- [ ] **Step 4: 通ることを確かめる。** 同じコマンド、`pnpm typecheck`、`pnpm lint` → PASS。
- [ ] **Step 5: コミット。** `feat(web): LINE の連携とメッセージを Prisma で読み書きする`

### Task 4: LINE の流れと連携の画面（application・container・page・actions）

**Files:**

- Create: `src/application/line/line-bot.ts`、`src/application/line/line-link.ts`
- Modify: `src/composition/line-container.ts`（書き直す）、`src/app/account/line/page.tsx`、`src/presentation/actions/line-link-actions.ts`、`src/presentation/controllers/action-state.ts`（`isForbidden` に `LineLinkForbiddenError`）
- Delete: `src/infrastructure/go-api/line-link-gateway.ts`、`tests/go-api-line-link-gateway.test.ts`
- Test: `tests/line-bot.test.ts`、`tests/line-link.test.ts`（どちらも新規）

**Interfaces:**

```ts
// src/application/line/line-bot.ts
export type GenerationOutcome =
  | { ok: true; generation: LineGeneration }
  | { ok: false; failure: GenerationFailure };
export type LineBotDeps = {
  links: {
    find(lineUserId: string): Promise<LineLink | null>;
    unlinkLineUser(lineUserId: string): Promise<void>;
    redeemCode(
      codeHash: string,
      lineUserId: string,
      now: Date,
    ): Promise<{ ownerId: string; role: string; relinked: boolean } | null>;
    reviewNotifyTargets(
      now: Date,
      limit: number,
    ): Promise<ReviewNotifyTarget[]>;
    claimReviewNotify(lineUserId: string, now: Date): Promise<boolean>;
  };
  messages: {
    insert(
      message: {
        webhookEventId: string;
        lineUserId: string;
        ownerId: string;
        kind: LineLearningKind;
        text: string;
      },
      now: Date,
    ): Promise<{ message: LineMessage; created: boolean }>;
    startAttempt(id: string, now: Date): Promise<LineMessage | null>;
    complete(
      id: string,
      ownerId: string,
      note: {
        kind: LineLearningKind;
        originalText: string;
        generation: LineGeneration;
      },
      now: Date,
    ): Promise<boolean>;
    fail(id: string, now: Date): Promise<void>;
    listStale(createdBefore: Date, limit: number): Promise<LineMessage[]>;
    prune(now: Date): Promise<void>;
  };
  throttle: {
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  // One OpenAI call; usage is reported (also for an unusable answer) before
  // it settles.
  generate(
    kind: LineLearningKind,
    text: string,
    onUsage: (usage: OpenAiUsage) => void,
  ): Promise<GenerationOutcome>;
  // Never throws (recordWithin).
  recordUsage(ownerId: string, usage: OpenAiUsage): Promise<void>;
  messenger: {
    reply(replyToken: string, texts: string[]): Promise<void>;
    push(to: string, texts: string[]): Promise<void>;
  };
  quota: { pushQuota(): Promise<LinePushQuota> };
  ownerValid(ownerId: string, role: string): Promise<boolean>;
  hashCode(code: string): string;
  now(): Date;
  log(code: string, fields?: Record<string, string | number>): void;
};
export function createLineBot(deps: LineBotDeps): {
  // Go: HandleEvent. Throws a store failure, or a reply failure when nothing
  // else failed; the caller logs the event id and goes on.
  handleEvent(event: LineEvent, deadline: Date): Promise<void>;
  // Go: Drain, then NotifyDueReviews even when the drain failed. Throws an
  // AggregateError of what failed, after both passes.
  runDailyPass(deadline: Date): Promise<void>;
};
// Go: main.go ownerValid. Admins must still be on the allowlist; members
// must still exist; any other role never may.
export function createLineOwnerCheck(deps: {
  adminIds: ReadonlySet<string>;
  memberExists(ownerId: string): Promise<boolean>;
}): (ownerId: string, role: string) => Promise<boolean>;

// src/application/line/line-link.ts
export class LineLinkForbiddenError extends Error {
  override name = "LineLinkForbiddenError";
}
export type LineLinkDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  enabled: boolean;
  store: {
    status(
      ownerId: string,
    ): Promise<{ linked: boolean; reviewNotify: boolean }>;
    setReviewNotify(ownerId: string, on: boolean): Promise<boolean>;
    unlinkOwner(ownerId: string): Promise<void>;
    putCode(
      ownerId: string,
      role: "member" | "admin",
      codeHash: string,
      expiresAt: Date,
    ): Promise<void>;
  };
  newCode: () => string;
  hashCode: (code: string) => string;
  now: () => Date;
};
export function createLineLink(deps: LineLinkDeps): {
  status(): Promise<{
    available: boolean;
    linked: boolean;
    reviewNotify: boolean;
  }>;
  issueCode(): Promise<{ code: string; expiresAt: Date }>;
  unlink(): Promise<void>;
  // false: LINE is not linked (or not available here).
  setReviewNotify(on: boolean): Promise<boolean>;
};
```

決まり：

- `handleEvent`（参照 §3・§4・§6。`now()` はその場で読む）：
  1. `!fromUser || userId === ""` → 何もしない。
  2. `text = event.text.trim()`。`isText` で `readLinkCode(text)` があれば redeem：`throttle.consume(lineLinkThrottleKey(userId), LINK_REDEEM_THROTTLE, now)` が `false` → reply `throttled`。`links.redeemCode(hashCode(code), userId, now)` が `null` → reply `badCode`。あれば `throttle.reset(key)`（失敗は `LINE_THROTTLE_RESET_FAILED` を `eventId` 付きでログし続ける）→ reply `relinked` か `linked`。
  3. `links.find(userId)` が `null` → reply `notLinked`。
  4. `ownerValid(ownerId, role)` が `false` → `links.unlinkLineUser(userId)` → reply `linkGone`。
  5. `!isText` → reply `usage`。`classifyLineText(text)`：`too-long` → reply `tooLong`、`unsupported` → reply `usage`。
  6. `webhookEventId === ""` → `log("LINE_EVENT_WITHOUT_ID")`、何も送らない。
  7. `messages.insert({ webhookEventId, lineUserId: userId, ownerId: link.ownerId, kind, text }, now)`、`created === false` → 何もしない。
  8. `deadline - now() < LINE_TIMING.minTimeLeftMs` → `log("LINE_MESSAGE_DEFERRED", { messageId })` → reply `slow`。
  9. `messages.startAttempt(id, now())` が `null` → 何もしない。
  10. 生成と保存（拾い直しと共通の `generateAndSave(id, ownerId, kind, text)`）：`generate` の `onUsage` で受けた量を、答えのあとで `recordUsage(ownerId, usage)`。成功なら `messages.complete(…)`。結果：
      - `complete` が投げた → reply `slow`（その失敗は無視）して、`complete` の失敗を投げ直す。
      - `complete` が `false` → `log("LINE_MESSAGE_SETTLED", { messageId })`、何も送らない。
      - 失敗で `retryable` → `log("LINE_GENERATION_RETRY", { messageId, code })` → reply `slow`。
      - ほかの失敗 → `messages.fail(id, now())`（投げたら reply しない）→ `log("LINE_MESSAGE_FAILED", { messageId, code })` → reply `formatLineFailure(kind, code)`。
      - 成功 → reply `formatLineResult(kind, text, generation)`。
  - reply は `messenger.reply(event.replyToken, [text])`。失敗は `log("LINE_REPLY_FAILED", { eventId })` して投げる。先に店の失敗があれば、それが勝つ（reply の失敗は投げない）。
- `runDailyPass(deadline)`（参照 §10・§11）：
  - drain：`messages.prune(now)`（失敗は覚えて続ける）→ `messages.listStale(now - 300_000, 20)`（失敗は覚えて drain を終える）→ 行ごとに、`now() >= deadline` なら止める。`attempts < 2` で残りが 30_000 ms を切っていれば飛ばす（次の行へ）。`drainRow`：
    - `links.find(lineUserId)` が `null` か持ち主が違う → `messages.fail` → `log("LINE_MESSAGE_FAILED", { messageId, code: "LINK_GONE" })`、push しない。
    - `ownerValid` が `false` → `links.unlinkLineUser` → fail（`LINK_GONE`）→ push `linkGone`。
    - `startAttempt` が `null`：`row.attempts < 2` → 何もしない。そうでなければ fail（`OPENAI_TIMEOUT`）→ push `formatLineFailure(kind, "OPENAI_TIMEOUT")`。
    - 生成と保存：`complete` が `false` → `LINE_MESSAGE_SETTLED`。投げた → 覚える。失敗（もう一度試せるものも）→ fail → push `formatLineFailure`。成功 → push `formatLineResult(kind, started.text, generation)`。
    - push は `messenger.push(lineUserId, [text])`、失敗は `log("LINE_PUSH_FAILED", { messageId })` して覚え、次の行へ。
  - notify：`links.reviewNotifyTargets(now, 100)`（失敗は覚えて終える）→ 0 件なら終える（割り当てを聞かない）→ `quota.pushQuota()` が投げた → `log("LINE_REVIEW_NOTIFY_QUOTA_UNKNOWN")`、覚えて終える → `budget = reviewNotifyBudget(n, quota)`、`budget < n` なら `log("LINE_REVIEW_NOTIFY_LIMITED", { wanted: n, allowed: budget })` → 1 件ずつ：`sent >= budget` か残りが 3_000 ms を切ったら止める。`ownerValid` が投げた → 覚えて次へ、`false` → 次へ。`claimReviewNotify` が投げた → 覚えて次へ、`false` → 次へ。push `formatReviewReminder(due)`、失敗は `log("LINE_REVIEW_NOTIFY_PUSH_FAILED")` して覚える（その日は送り直さない）。最後に `log("LINE_REVIEW_NOTIFY_SENT", { count: sent })`。
  - 覚えた失敗があれば、両方のあとで `new AggregateError(errors, "LINE_DAILY_PASS_FAILED")` を投げる。
- `createLineOwnerCheck`：`admin` → `adminIds.has(ownerId)`、`member` → `memberExists(ownerId)`、ほか → `false`。
- `line-link`（判断 5・6）：どのメソッドも最初に、`user` が `null`・`role` が `member`/`admin` でない・`user.actingAs` がある・`user.demo === true`・`githubId` が無い → `LineLinkForbiddenError`。持ち主は `user.githubId`、役割は `user.role`。
  - `status`：`enabled` でなければ `{ available: false, linked: false, reviewNotify: false }`（DB を読まない）。あれば `{ available: true, ...store.status(owner) }`。
  - `issueCode`：`enabled` でなければ `LineLinkForbiddenError` ではなく `Error("LINE_UNAVAILABLE")`。`code = newCode()`、`expiresAt = now() + LINK_CODE_TTL_MS`、`store.putCode(owner, role, hashCode(code), expiresAt)` → `{ code, expiresAt }`。
  - `unlink`：`enabled` でなければ何もしない。`store.unlinkOwner(owner)`。
  - `setReviewNotify`：`enabled` でなければ `false`。`store.setReviewNotify(owner, on)`。
- `line-container.ts`：

  ```ts
  const config = lineConfig();
  const openAi = openAiConfig();
  const links = createLineLinkStore(prisma);
  // The /account/line page and its actions, as the signed-in member or admin.
  export const lineLink = createLineLink({
    currentUser: getCachedCurrentUser,
    enabled: config !== undefined,
    store: links,
    newCode: newLinkCode,
    hashCode: hashLinkCode,
    now: () => new Date(),
  });
  // The webhook and the daily pass; undefined when LINE is not configured.
  export const lineBot = config && openAi ? createLineBot({ … }) : undefined;
  ```

  `lineBot` の `generate` は `generateLineLearning((request) => respondJson(openAi, request, onUsage), kind, text)` を包み、`OpenAiError` を `{ ok: false, failure: { code, retryable } }` に、ほかの失敗を `{ code: "OPENAI_REQUEST_FAILED", retryable: false }` にする。`recordUsage` は `recordWithin(() => recordAiUsage(prisma, { ...usage, ownerId, feature: "line" }), RECORD_TIMEOUT_MS, (code, name) => console.error(code, name))`。`messenger`・`quota` は `createLineMessaging(config)`、`throttle` は `createSignInThrottleStore(prisma)`、`ownerValid` は `createLineOwnerCheck({ adminIds: allowedGitHubIds(), memberExists: links.memberExists })`、`now` は `() => new Date(Math.trunc(Date.now()))`、`log` は `(code, fields) => console.info(code, fields ?? {})`（失敗のコードは `console.error`）。

- `/account/line`：`lineLink.getLineLink()` を `lineLink.status()` に。`LineLinkForbiddenError` → `redirect("/")`（`try` の外で `redirect` を呼ぶ。今のゲストの扱いと同じ）。ほかは変えない。
- `line-link-actions.ts`：`getLinkOwner` を消し、use case に任せる。
  - `issueLineLinkCodeAction`：`attemptGo("LINE_LINK_CODE_FAILED", () => lineLink.issueCode())`（`LineLinkForbiddenError` は `isForbidden` で `accountForbiddenMessage`、`LINE_UNAVAILABLE` は今と同じ一般の文言）。
  - `unlinkLineAction`：`try { await lineLink.unlink() } catch (error) { if (error instanceof LineLinkForbiddenError) return; throw error; }` → `revalidatePath("/account/line")`。
  - `setLineReviewNotifyAction`：`lineLink.setReviewNotify(on)`。ほかは今と同じ。
  - 先頭のコメント（「Go API」）を、DB の処理に合わせて直す。

- [ ] **Step 1: 失敗するテストを書く。**（偽物は呼び出しを順に記録する。`now` は `t0 = new Date("2026-11-17T03:00:00.000Z")` から進められる時計。`deadline = t0 + 45 s`。会員の連携 `{ lineUserId: "U1", ownerId: "password:c1", role: "member" }`。生成の偽物は `{ ok: true, generation: { text: "我去学校了", pinyin: "wǒ", hints: ["h"] } }` を返し、`onUsage({ model: "gpt-5-mini", inputTokens: 12, outputTokens: 34 })` を呼ぶ）
  - `tests/line-bot.test.ts`：
    - `group and room events are ignored`：`fromUser: false` と `userId: ""` で、何も呼ばれない。
    - `an unlinked sender is told how to link`：テキストもスタンプも reply `notLinked`、`insert` は呼ばれない。
    - `a code links the account, counted against the hour`：`" abcd2345 "` → `consume("line-link:U1", { limit: 5, windowMs: 3600000 }, t0)`、`redeemCode(sha256hex("ABCD2345"), "U1", t0)`、`reset("line-link:U1")`、reply `linked`。`relinked: true` → `relinked`。`redeemCode` が `null` → `badCode`、`reset` は呼ばれない。`consume` が `false` → `throttled`、`redeemCode` は呼ばれない。連携の持ち主が無効でもコードは先に効く（`find` は呼ばれない）。
    - `an owner who may no longer use LINE loses the link`：`ownerValid` が `false` → `unlinkLineUser("U1")` と reply `linkGone`。`ownerValid` が投げる → そのまま投げ、reply しない。
    - `stickers, other scripts and long texts get the usage or length reply`：`isText: false` → `usage`、`"hello"` → `usage`、`"漢".repeat(501)` → `tooLong`。どれも `insert` は呼ばれない。末尾の空白は数えない（`"漢".repeat(500) + "  "` は保存される）。
    - `a correction is saved and replied`：`"我去了学校"` → `insert({ webhookEventId: "E1", lineUserId: "U1", ownerId: "password:c1", kind: "correction", text: "我去了学校" }, t0)`、`startAttempt`、`generate("correction", "我去了学校", …)`、`recordUsage("password:c1", { model: "gpt-5-mini", inputTokens: 12, outputTokens: 34 })`、`complete("m1", "password:c1", { kind: "correction", originalText: "我去了学校", generation }, …)`、reply `formatLineResult("correction", …)`、token は `"r1"`。`"今日は雨"` は `translation`。
    - `a redelivered event sends nothing`：`insert` が `created: false`（行が `done` でも `pending` でも）→ `startAttempt`・`generate`・reply は無い。
    - `an event without an id is skipped`：`webhookEventId: ""` → `insert` も reply も無く、`LINE_EVENT_WITHOUT_ID`。
    - `too little time left saves the text for the drain`：`deadline - now = 29_999` → `insert` のあと reply `slow`、`startAttempt` は呼ばれない。`30_000` ちょうどなら生成する。
    - `a retryable failure stays pending; others fail the message`：`{ code: "OPENAI_TIMEOUT", retryable: true }` → reply `slow`、`fail` は呼ばれない。`{ code: "OPENAI_RATE_LIMITED", retryable: false }` → `fail("m1", …)` のあと reply `formatLineFailure("correction", "OPENAI_RATE_LIMITED")`。`fail` が投げる → reply しないで投げる。答えが使えなくても `recordUsage` は呼ばれる。
    - `a store failure after generating keeps the row pending`：`complete` が投げる → reply `slow` して投げる。`complete` が `false` → reply しない。
    - `a reply failure is reported but changes nothing`：`reply` が投げる → `handleEvent` が投げ、`LINE_REPLY_FAILED` の `eventId` が `"E1"`、ほかの呼び出しは成功のときと同じ。
    - `the drain finishes stale rows and pushes the result`：`listStale(t0 - 300000, 20)` の前に `prune(t0)`。行 `attempts: 1` → `startAttempt`、`generate`、`complete`、push `("U1", [formatLineResult(…)])`。
    - `the drain fails what it cannot finish`：連携が無い・別の持ち主 → `fail` だけ（push なし）。持ち主が無効 → `unlinkLineUser`、`fail`、push `linkGone`。`startAttempt` が `null` で `attempts: 2` → `fail` と push `formatLineFailure(kind, "OPENAI_TIMEOUT")`、`attempts: 1` → 何もしない。生成がもう一度試せる失敗でも `fail` と push。
    - `the drain skips rows it cannot finish in time but still fails exhausted ones`：残り 29_999 ms で、`attempts: 0` の行は飛ばし、その次の `attempts: 2` の行は fail と push。締め切りを過ぎたら次の行に進まない。
    - `the review message goes once, within the quota`：対象 3 件、`pushQuota` が `{ unlimited: false, remaining: 32 }` → push は 2 件、`LINE_REVIEW_NOTIFY_LIMITED` が `{ wanted: 3, allowed: 2 }`。無効な持ち主は飛ばし、`claimReviewNotify` が `false` なら送らない。対象 0 件なら `pushQuota` を呼ばない。`pushQuota` が投げる → 何も送らず、`runDailyPass` が `AggregateError` を投げる。push の失敗は次の対象へ進み、最後に投げる。
    - `the daily pass sends the review message even when the drain failed`：`listStale` が投げても notify は動き、`runDailyPass` は `AggregateError`（`errors` に 1 つ）。
    - `logs never carry text, ids or codes`：上のすべての流れで、`log` に渡った値に `"我去了学校"`・`"U1"`・`"r1"`・`"ABCD2345"`・`"password:c1"`・生成の本文が無い。
    - `owners are checked as Go's ownerValid did`：`adminIds = new Set(["10001"])`、`("10001", "admin")` → `true`、`("10002", "admin")` → `false`、`("password:c1", "member")` は `memberExists` の答え、`("guest", "guest")` → `false`（`memberExists` を呼ばない）。
  - `tests/line-link.test.ts`：
    - `only members and admins who are themselves may link`：会員 `{ githubId: "password:c1", role: "member" }` と admin `{ githubId: "10001", role: "admin" }` は通る。デモ（`demo: true`）・会員として操作中の admin（`actingAs` あり）・ゲスト・`revoked`・`null` は 4 つのメソッドのどれも `LineLinkForbiddenError`、store は呼ばれない。
    - `a code is issued for ten minutes and only its hash is stored`：`newCode` が `"ABCD2345"` → `putCode("password:c1", "member", "<sha の偽物>", t0 + 600000)`、答えは `{ code: "ABCD2345", expiresAt: t0 + 600000 }`。admin は役割 `"admin"` で持ち主 `"10001"`。
    - `without LINE the page says unavailable and nothing is read`：`enabled: false` → `status` は `{ available: false, linked: false, reviewNotify: false }`、`setReviewNotify` は `false`、`unlink` は何もしない、`issueCode` は投げる。どれも store を呼ばない。
    - `the review message setting needs a link`：`store.setReviewNotify` の `false` がそのまま返る。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/line-bot.test.ts tests/line-link.test.ts` → FAIL。
- [ ] **Step 3: 実装してつなぎ替える。** 上のとおり。`line-link-gateway.ts` とそのテストを `git rm`。
- [ ] **Step 4: 確かめる。**
  - `pnpm typecheck && pnpm lint && node --import tsx --test tests/*.test.ts` → PASS（`tests/architecture.test.ts` を含む）。
  - `grep -rn "line-link-gateway\|createLineLinkGateway\|/v1/line\|getLineLink\|issueLineLinkCode\|unlinkLine\b" src tests` → 何も出ない。
- [ ] **Step 5: コミット。** `refactor(web): LINE の連携と添削の流れを Go に頼まずに行う`

### Task 5: Route Handler・proxy・e2e（偽の LINE API）

**Files:**

- Create: `src/app/api/line/webhook/route.ts`、`src/app/api/cron/line-drain/route.ts`、`src/presentation/controllers/line-webhook-controller.ts`、`src/presentation/controllers/cron-controller.ts`、`e2e/line-stub.ts`
- Modify: `src/infrastructure/go-api/go-proxy.ts`（`isPublicRoute`）、`e2e/environment.ts`、`e2e/server.ts`、`e2e/openai-stub.ts`、`e2e/fixtures.ts`（TRUNCATE に LINE の 3 つの表）、`e2e/line.spec.ts`、`e2e/act-as.spec.ts`、`e2e/demo.spec.ts`
- Test: `tests/line-webhook-controller.test.ts`、`tests/cron-controller.test.ts`（どちらも新規）、`tests/go-proxy.test.ts`（足す）

**Interfaces:**

```ts
// src/presentation/controllers/line-webhook-controller.ts
// Go: httpapi maxBodyBytes.
export const LINE_WEBHOOK_MAX_BODY_BYTES = 1_048_576;
export async function handleLineWebhook(
  request: Request,
  deps: {
    channelSecret: string | undefined; // undefined: LINE is not configured
    bot:
      | { handleEvent(event: LineEvent, deadline: Date): Promise<void> }
      | undefined;
    now: () => Date;
    log: (code: string, fields?: Record<string, string | number>) => void;
  },
): Promise<Response>;

// src/presentation/controllers/cron-controller.ts
// A Vercel Cron call: the secret, then the job; 204 when it worked.
export async function handleCronRequest(
  request: Request,
  deps: {
    secret: string | undefined;
    run: () => Promise<void>;
    failureCode: string;
  },
): Promise<Response>;

// src/app/api/line/webhook/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request): Promise<Response>;

// src/app/api/cron/line-drain/route.ts
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request): Promise<Response>;
```

決まり：

- `handleLineWebhook`：`bot` か `channelSecret` が無い → 404。`start = now()`。`readLimitedBody(request, LINE_WEBHOOK_MAX_BODY_BYTES)`：`BodyTooLarge` → 413、ほかの失敗 → 400。`verifyLineSignature(secret, body, request.headers.get("x-line-signature"))` が `false` → 401（本文は読まない）。`parseLineWebhook` が `null` → 400。`deadline = start + 45_000`。イベントを 1 つずつ：`now() - start >= 55_000` なら残りを始めず `log("LINE_EVENTS_TIMED_OUT", { count: 残りの数 })`。`handleEvent` が投げたら `log("LINE_EVENT_FAILED", { eventId })`（エラーの中身は出さない）して次へ。最後に `Response.json({}, { headers: { "Cache-Control": "no-store" } })`。`request.signal` は使わない（判断 2）。誤りの本文は `answer-request-controller.ts` の `goError` と同じ形（`{"error":{"code","message"}}`、no-store）。
- `handleCronRequest`：`bearerMatches(request.headers.get("authorization"), secret)` が `false` → 401。`run()` が投げたら `console.error(failureCode, errorName(error))` → 500。成功 → `new Response(null, { status: 204, headers: no-store })`。
- `line-drain/route.ts`：`lineBot` が無い → 404（秘密より先。Go と同じ）。あれば `handleCronRequest(request, { secret: cronSecret(), run: () => lineBot.runDailyPass(new Date(Date.now() + LINE_TIMING.drainBudgetMs)), failureCode: "LINE_DRAIN_FAILED" })`。
- `webhook/route.ts`：`handleLineWebhook(request, { channelSecret: lineConfig()?.channelSecret, bot: lineBot, now: () => new Date(), log })`。
- `go-proxy.ts` の `isPublicRoute` に `pathname === "/api/line/webhook" || pathname.startsWith("/api/cron/")` を足し、コメントに「they check their own credential (the LINE signature, the cron secret)」と書く。
- `e2e/line-stub.ts`（`startLineStub(port: number, accessToken: string): Promise<{ close(): Promise<void> }>`）：
  - `Authorization` が `Bearer <accessToken>` でなければ 401。
  - `POST /v2/bot/message/reply`・`/push`：本文を記録し 200 `{}`。`replyToken` か `to` に `"fail"` を含めば 500。
  - `GET /v2/bot/message/quota` → `{"type":"limited","value":200}`、`GET /v2/bot/message/quota/consumption` → `{"totalUsage":0}`。
  - `GET /e2e/line/sent?replyToken=<t>` か `?to=<u>` → `{"sent":[{"kind":"reply"|"push","replyToken"?,"to"?,"texts":[…]}]}`（受けた順）。
  - 先頭のコメントに、何の代わりで、何を記録し、どの印で失敗させるかを書く（`openai-stub.ts` と同じ形）。
- `e2e/openai-stub.ts`：`text.format.name` が `chinese_correction` → 完了した本文で、出力の JSON は `{"correctedText":"<input>（添削）","pinyin":"e2e pīnyīn","hints":["e2e のヒント 1","e2e のヒント 2"]}`。`japanese_to_chinese_translation` → `{"translatedText":"e2e 的翻译","pinyin":"e2e pīnyīn","hints":["e2e のヒント"]}`。どちらも `usage` は `{ input_tokens: 15, output_tokens: 25, total_tokens: 40 }`。`input` に `"[fail]"` を含めば 500（もう一度試せる失敗）。先頭のコメントに足す。
- `e2e/environment.ts`：`lineStubURL = "http://127.0.0.1:3111"`、`lineChannelSecret()`（`deriveSecret("line-channel")`）、`lineAccessToken()`（`deriveSecret("line-access")`）、`goCronSecret` を `cronSecret` に改名（Go と Web で同じ値。コメントを「Guards the cron routes of the web and of the Go API」に）。
- `e2e/server.ts`：`startLineStub(3111, lineAccessToken())` を OpenAI のスタブの隣で起動し、Web の `env` に `LINE_CHANNEL_SECRET: lineChannelSecret()`、`LINE_CHANNEL_ACCESS_TOKEN: lineAccessToken()`、`LINE_API_BASE_URL: lineStubURL`、`CRON_SECRET: cronSecret()` を足す。Go の LINE の値はそのまま（段階 10b で消す）。
- `e2e/fixtures.ts`：最初の TRUNCATE に `"LineLink", "LineLinkCode", "LineMessage"` を足す。

- [ ] **Step 1: 失敗するテストを書く。**
  - `tests/line-webhook-controller.test.ts`（偽の `bot`、時計、署名は `createHmac` で作る）：
    - `without LINE the webhook does not exist`：`bot: undefined` → 404 `{"error":{"code":"not_found","message":"見つかりません。"}}`、本文は読まれない。
    - `an unsigned or wrongly signed webhook is refused before anything is read`：ヘッダー無し・違う署名 → 401 `unauthorized`「認証が必要です。」、`handleEvent` は呼ばれない。
    - `an oversized body is 413 and a malformed one 400`：1_048_577 バイト → 413 `too_large`「リクエストが大きすぎます。」。署名の合う `not json` → 400 `invalid_request`「リクエストが不正です。」。
    - `every event shares one deadline and the answer is 200 whatever happens`：2 つのイベント（参照の `twoEventBody`）→ `handleEvent` が 2 回、`deadline` はどちらも `start + 45000`。1 つ目が投げても 2 つ目は呼ばれ、200 `{}`、`Cache-Control: no-store`、`LINE_EVENT_FAILED` の `eventId` は `"E1"`。`{"events":[]}` → 200 `{}`。
    - `the webhook stops starting events after 55 seconds`：1 つ目の中で時計を 55 秒進める → 2 つ目は呼ばれず、`LINE_EVENTS_TIMED_OUT` の `count` は 1、200。
  - `tests/cron-controller.test.ts`：`only the cron secret runs the job`：ヘッダー無し・`Bearer wrong`・秘密が `undefined` → 401、`run` は呼ばれない。正しい → `run` 1 回、204、本文なし、no-store。`run` が投げる → 500 `{"error":{"code":"internal","message":"サーバーでエラーが発生しました。"}}`。
  - `tests/go-proxy.test.ts` に足す：`the LINE webhook and the cron routes are public`：Cookie なしの `POST /api/line/webhook`・`GET /api/cron/line-drain`・`GET /api/cron/demo-reset` が `x-test-next` で通り、refresh しない。`/api/line/webhooks`・`/api/line/link`・`/api/cronx` は 401 のまま。
- [ ] **Step 2: 失敗を確かめる。** `node --import tsx --test tests/line-webhook-controller.test.ts tests/cron-controller.test.ts tests/go-proxy.test.ts` → FAIL。
- [ ] **Step 3: 実装する。** 上のとおり。route.ts は薄くし、中身は controller に置く。
- [ ] **Step 4: e2e を足す。**（`e2e/line.spec.ts`。webhook を送る小さな関数 `sendLineEvents(events)`：本文を `JSON.stringify({ destination: "x", events })`、`x-line-signature` を `createHmac("sha256", lineChannelSecret())` の Base64 にして `${baseURL}/api/line/webhook` に `POST`。イベントは `textEvent(id, userId, text)` で作る。LINE のユーザー ID と reply token は、テストごとに `randomUUID()` から作る。`sent` はスタブに聞く）
  - `a LINE message becomes a learning note and a reply`：会員を作って連携の行を入れる。`"我昨天去图书馆了。"` を送る → 200 `{}`。スタブの reply が 1 件で、本文が `【元の文】\n我昨天去图书馆了。\n\n【添削後】\n我昨天去图书馆了。（添削）\n\n【ピンイン】\ne2e pīnyīn\n\n【ヒント】\n・e2e のヒント 1\n・e2e のヒント 2\n\n学習ノートに保存しました`。DB：その会員の `LearningEntry` が 1 件（`kind = 'correction'`、`correctedText` が上の値）、その `ImportBatch."fileName" = 'LINE'`、`Hint` が 2 件、`LineMessage` が `status = 'done'`・`text IS NULL`・`attempts = 1`、`AiUsage` が `feature = 'line'`・`inputTokens = 15`・`outputTokens = 25`・`ownerId` が会員。会員で `/logs` を開くと、その文が見える。同じ本文をもう一度送る → 200、reply は 1 件のまま、ノートも 1 件のまま。
  - `a Japanese message is translated`：`"週末は友達と映画を見ます。"` → reply が `【中国語訳】\ne2e 的翻译` を含み、ノートの `kind = 'translation'`。
  - `a code issued on the web page links through the webhook`：会員で `/account/line` の「連携コードを出す」→ 出たコードを小文字にして送る → reply が「連携しました。これから、このトークに送った文を添削・翻訳して学習ノートに保存します。」、ページを読み直さずに「連携を解除」が出る（今のテストと同じ見方）。`LineLinkCode` は 0 件、`LineLink` の `role = 'member'`。同じコードをもう一度 → 「コードが違うか期限が切れています。…」。
  - `an unlinked sender, a sticker and a long text get Go's replies`：連携なしで `"你好"` →「まだ連携していません。…」。連携してスタンプ（`message: { type: "sticker" }`）→「中国語の文を送ると添削します。…」。`"漢".repeat(501)` →「文が長すぎます。500 文字までにして、もう一度送ってください。」。どれも `LineMessage` は 0 件。
  - `a failed generation stays pending and the drain finishes it`：`"[fail]我想去北京。"` を送る → reply「時間がかかっています。結果は翌朝までにこのトークにお送りします。」、`LineMessage` が `pending`・`attempts = 1`。その行の `createdAt` を 10 分前にする。`GET /api/cron/line-drain` を秘密なしで → 401（`{"error":{"code":"unauthorized",…}}`。proxy の `{"error":"認証が必要です。"}` ではない）。秘密付きで → 204。スタブの push（`to` が LINE のユーザー）が「添削できませんでした。うまく処理できませんでした。しばらくしてからもう一度送ってください。\n（コード: OPENAI_REQUEST_FAILED）」、行は `failed`・`attempts = 2`・`text IS NULL`。
  - `the drain pushes late results and the morning review message once`：連携（`reviewNotify = true`）と、10 分前の `pending`・`attempts = 0` の行（`"我想去北京。"`）を DB に入れ、その会員にノートを 1 件作って `ReviewItem`（`kind = 'entry'`、`due` は 1 時間前）を入れる。cron → 204。push が 2 件：`formatLineResult` の本文（`【添削後】\n我想去北京。（添削）` を含む）と「今日の復習が 1 問あります。…」。`LineLink."reviewNotifiedOn"` が日本時間の今日。もう一度 cron → 204、push は 2 件のまま。
  - `members and admins only: the demo and an acting admin are sent home`：`e2e/act-as.spec.ts` の最初のテスト（会員として操作中）に、`/account/line` を開くと `pathname === "/"` を足す。`e2e/demo.spec.ts` の `anyone can try the members' pages in the demo, without AI` に、`/account/line` を開くと `pathname === "/"` を足す（「デモを終える」の前）。
  - 今の 3 本（解除・コードと QR・ゲスト）は、`finally` の後片付けを消して（TRUNCATE が消す）ほかは変えずに通ること。`e2e/demo.spec.ts` の `goCronSecret` は `cronSecret` に（リセットは段階 10b まで Go のまま）。
- [ ] **Step 5: 全体を確かめる。**
  - `docker ps` でほかの e2e がないことを確かめ、`pnpm test:regression` → PASS。終わったら `pnpm test:e2e:stop`。
  - `grep -rn "goCronSecret" e2e` → 何も出ない。
- [ ] **Step 6: コミット。** `feat(web): LINE の webhook と拾い直しを Route Handler で受ける`

### Task 6: ドキュメント

**Files:** `README.md`、`docs/architecture.md`、`docs/features.md`、`docs/roadmap.md`、`docs/api-deployment.md`、`docs/api-local.md`、`.env.example`、`docs-site/README.md`、`docs-site/operations/deploy.md`、`docs-site/reference/line.md`、`docs-site/reference/README.md`

段階 7〜9b の学び：古い「Go が受け持つ」の記述が残りやすい。下の一覧のほかにも、`grep` で探してすべて直す。この段階では Go はまだ LINE のルートと 2 つの cron を持っている（10b で消える）ので、「Go にも残っている」ことは消さない。

- [ ] **Step 1: 直す。**
  - `README.md`：33 行の API の行の Go の受け持ちを「ログイン、定期実行（LINE の拾い直しとデモのリセット。段階 10c で Web に移ります）」にし、括弧に「LINE の webhook と連携」を足す。34 行の DB の行で、Web が読み書きするものに「LINE の連携とメッセージ（`LineLink`・`LineLinkCode`・`LineMessage`）」を足す。
  - `docs/architecture.md`：mermaid（20〜22 行・36〜37 行）の `LINEBOT` と `AI` を Web の側に移し、`LINE -->|Webhook| WEB`、`WEB -->|reply・push| LINE` にする（Go の cron の矢印は 10b まで残す。「Go の Cron（10c で Web へ）」）。43〜44 行の箇条を、Web が webhook を受け、署名を確かめ、OpenAI を呼び、reply する、に直す。§7「LINE」（144〜169 行）のシーケンスの参加者を Web に、`src/app/api/line/webhook/route.ts`・`src/app/api/cron/line-drain/route.ts` と、cron は段階 10c まで Go が `/v1/line/drain` を呼んでいることを書く。174〜178 行の OpenAI を呼ぶところの表で、LINE を Web（`src/infrastructure/openai/line-learning.ts`）に。117 行（会員として操作）に「LINE の連携画面は `/` に戻る」を足す。
  - `docs/features.md`：7 行の「LINE は Go API が記録」を Web に。14 行のデモの箇条の「Go API（LINE 連携）は…」を「LINE 連携の画面は `/` に戻ります」に。79〜89 行の LINE の節：動くところを `/api/line/webhook`（Web）に、設定を「Web に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`（と `OPENAI_API_KEY`）、拾い直しとお知らせの cron は `CRON_SECRET`」に、切り替えの手順は api-deployment.md の「段階10…」へのリンクに。
  - `docs/roadmap.md:28`：「移行中の Go API（ログイン・LINE）」を「移行中の Go API（ログイン・定期実行）」に。
  - `docs/api-deployment.md`：
    - §3 の環境変数の表と注：Go の `LINE_*`・`OPENAI_*`・`CRON_SECRET` の行に「段階 10b のあとは不要（Web に移る）」を足す。
    - §6「Web が実行時に使う DB と秘密」の表に、Web の `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`（Go と同じ値。Production だけ）・`CRON_SECRET`（Production だけ。Vercel が Cron の呼び出しに付ける）・`LINE_API_BASE_URL`（テスト専用）を足す。Preview には入れない（プレビューが本物の LINE に返事をしないように）と書く。
    - §7「LINE 連携」：ルートの表を Web の `POST /api/line/webhook`・`GET /api/cron/line-drain` と、画面（`/account/line`、Server Actions）に。処理の説明（リクエストの中で処理、45 秒・30 秒、拾い直し、push の枠）は Web のファイルで書き直す。`maxDuration` は route の中で 60 秒と決めていること、Web のプロジェクトはすでに 90 秒の route があるので設定は要らないこと。「切り替えの手順」の webhook の URL を Web のものにし、詳しくは下の段階 10 の節へ。
    - §10「デモアカウント」：リセットは段階 10b まで Go、と 1 行足す。
    - 「段階9b…のマージの前と後」のあとに **「段階10（LINE とデモのリセットの cron）のマージの前と後」** を足す。段階 8〜9b と同じ形で、次をすべて書く：
      - はじめの段落：LINE の webhook・連携・拾い直しと、デモのリセットの cron を Web に移す段階で、3 つの PR（10a・10b・10c）に分けたこと。設計の 4 つの手順で、LINE の返信と OpenAI の呼び出しが二重にならないように切り替えること。途中で拾い直しが 1 回飛ぶことと、webhook を変える数分のあいだに LINE が届かないことは許容すること。
      - **手順 1（10a のマージの前と後）**：マージの前に、Web の Vercel プロジェクトの **Production** に `LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`（Go のプロジェクトと同じ値）と `CRON_SECRET`（新しく `openssl rand -hex 32` で作るか Go と同じ値）を入れる。`OPENAI_API_KEY` はすでにある。Go に `OPENAI_LEARNING_MODEL` があれば Web にも同じ値を入れる。マイグレーションは無い。マージのあと：Web の Production のデプロイが Ready → `vercel promote`。確かめ：`curl -s -X POST https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook` が `{"error":{"code":"unauthorized","message":"認証が必要です。"}}`（`404` なら LINE の値が入っていない。`{"error":"認証が必要です。"}` なら古いデプロイ）。`/account/line` に「LINE 連携は今は使えません。」が出ないこと。`curl -s -o /dev/null -w '%{http_code}' https://…/api/cron/line-drain -H "Authorization: Bearer $CRON_SECRET"` は **まだ叩かない**（Go の cron と重なるため。叩くなら 204 が返るが、拾い直しが 2 回になる）。この時点では LINE はまだ Go に届き、cron も Go が動かす。Web の画面で出したコードは Go の webhook で使え、Web で切り替えたお知らせは Go の cron が送る（同じ表を同じ意味で使う）。Go は出し直さない。
      - **手順 2（利用者が行う）**：LINE Developers のコンソールで、Messaging API のチャネルの **Webhook URL** を `https://ffpf-zhuelog-api.vercel.app/v1/line/webhook`（Go）から `https://ffpf-zhuelog.sparklingstadt.com/api/line/webhook`（Web）に変え、「検証」を押して成功（200）を確かめる。「Webhook の利用」はオンのまま、「応答メッセージ」はオフのまま。自分の LINE で添削・翻訳・コードでの連携を 1 回ずつ試し、Web の学習ノートに入ること、`AiUsage` に `line` が増えることを確かめる。変えてから数分のあいだに届いた文は返事が無いことがある（許容）。
      - **手順 3（10b のマージの前と後）**：手順 2 が済んでからマージする。マージのあと、Web を promote し、main から Go を再デプロイする（実行の前に、使う人に確かめる）。Go から LINE のルートと 2 つの cron（`services/api/vercel.json`）が消える。次に 10c を出すまで、拾い直しとデモのリセットは動かない（1 晩飛んでよい。急ぐなら Web の `/api/cron/demo-reset` を手で呼ぶ）。詳しくは 10b の節（10b で書く）。
      - **手順 4（10c のマージの前と後）**：手順 3 で Go を出し直したあとでマージする。Web の `vercel.json` の `crons` が、Production のデプロイで登録される。Vercel のダッシュボードの **Settings → Cron Jobs** に 2 つ（`/api/cron/line-drain` 毎日 21:00 UTC、`/api/cron/demo-reset` 毎日 19:00 UTC）が出ることを確かめる。詳しくは 10c で書く。
      - 戻すとき（10a）：手順 2 の前なら、Web を戻すだけでよい（Go がまだ連携のルートを持っている）。手順 2 のあとで Web を戻すなら、先に LINE Developers の webhook の URL を Go（`https://ffpf-zhuelog-api.vercel.app/v1/line/webhook`）に戻す。戻さないと、古い Web には webhook のルートが無く、LINE の文が失われる。
  - `docs/api-local.md:44-46`：ローカルで LINE を使えないわけを「本物の LINE のチャネルが要るため。e2e は偽の LINE API（`e2e/line-stub.ts`）で確かめます」に。
  - `.env.example`：Web の LINE と cron の値の説明を足す（`LINE_CHANNEL_SECRET`・`LINE_CHANNEL_ACCESS_TOKEN`・`CRON_SECRET`・`LINE_API_BASE_URL` はテスト専用）。Go 用の 55〜60 行には「段階 10b までの Go 用」と書く。
  - `docs-site/`（Go API のドキュメント。`.vuepress/dist` は除く）：`reference/line.md` と `reference/README.md:18-24`・`README.md`・`operations/deploy.md` の LINE の節に、「Web の画面と webhook は段階 10a で Web に移り、Go のこのルートは 10b で消えます」と注を足す（ページはまだ消さない。Go はまだ答える）。
  - 秘密の値は書かない。
- [ ] **Step 2: 古い記述を探す。**
  - `grep -rn "Go API.*LINE\|LINE.*Go API\|/v1/line\|services/api/vercel.json\|ffpf-zhuelog-api.vercel.app/v1/line" README.md docs docs-site .env.example --include='*.md' --include='*.example' | grep -v "docs/superpowers\|docs/releases\|\.vuepress/dist"` の結果を 1 行ずつ読み、Web に移ったことと合わない所が残っていないことを確かめる（Go に 10b まで残るものは、そう書いてあればよい）。
  - 変えたファイルで `node_modules/.bin/prettier --check` が通る。
- [ ] **Step 3: コミット。** `docs: LINE の webhook と連携を Web に移したことと、段階 10 の切り替えの順番を書く`
