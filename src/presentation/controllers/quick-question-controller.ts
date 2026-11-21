import type {
  AskRefusal,
  QuestionNotes,
} from "@/application/chat/question-notes";
import { quickQuestionText } from "@/domain/chat/question";
import { answerStreamResponse } from "../http/answer-stream-response";
import { BodyTooLarge, readLimitedBody } from "../http/limited-body";
import { isSameOriginRequest } from "../http/same-origin";

// Go's limit on a chat body (httpapi maxChatBodyBytes).
const MAX_BODY_BYTES = 262_144;

const noStore = { "Cache-Control": "no-store" };

// The errors the old relay made itself: {"error": message}.
const relayError = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: noStore });

// The errors Go made: {"error": {"code", "message"}}. The browser and the
// demo e2e read error.message.
const goError = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: noStore });

const refusals: Record<AskRefusal, () => Response> = {
  "signed-out": () => goError("unauthorized", "認証が必要です。", 401),
  forbidden: () =>
    goError("forbidden", "このアカウントは利用できません。", 403),
  demo: () => goError("forbidden", "デモでは使えません。", 403),
  unavailable: () => goError("not_found", "見つかりません。", 404),
};

const invalidQuestion = () =>
  goError(
    "invalid_request",
    "会話内容が上限を超えているか、形式が不正です。",
    400,
  );

// POST /api/quick-question: one question to OpenAI, the answer streamed
// back as NDJSON. Checked in the order the relay and Go checked it: the
// page, JSON, who may ask, the body's size, the question.
export async function handleQuickQuestion(
  request: Request,
  deps: { asker: () => ReturnType<QuestionNotes["asker"]> },
): Promise<Response> {
  if (!isSameOriginRequest(request))
    return relayError("この画面から送信してください。", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return relayError("JSON形式で送信してください。", 415);

  const found = await deps.asker();
  if (!found.ok) return refusals[found.reason]();

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return relayError("会話が大きすぎます。", 413);
    return relayError("リクエストを読み取れませんでした。", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return invalidQuestion();
  }
  const text = quickQuestionText(parsed);
  if (text === null) return invalidQuestion();

  // request.signal stops OpenAI when the browser stops reading.
  return answerStreamResponse(found.asker.ask(text, request.signal));
}
