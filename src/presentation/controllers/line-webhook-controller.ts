import { LINE_TIMING, type LineEvent } from "@/domain/line/line-message";
import { verifyLineSignature } from "@/infrastructure/line/line-signature";
import { parseLineWebhook } from "@/infrastructure/line/line-webhook";
import { BodyTooLarge, readLimitedBody } from "../http/limited-body";

// The most bytes a webhook body may have (1 MiB).
export const LINE_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

const noStore = { "Cache-Control": "no-store" };

// The JSON error body: {"error": {"code", "message"}}.
const jsonError = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: noStore });

// LINE's webhook. The body is read under the 1 MiB limit, its signature
// checked on the raw bytes, then every message event is handled inline, one
// after another, before the answer: each gets the same delivery deadline
// (start + 45 s), and none is started once 55 s have passed. The request's
// signal is not passed on: LINE dropping the connection must not stop the
// work. An event's failure is logged by its id only, and the answer is 200
// whatever happened, so LINE never redelivers.
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
): Promise<Response> {
  const { channelSecret, bot } = deps;
  if (!bot || !channelSecret)
    return jsonError("not_found", "見つかりません。", 404);
  const start = deps.now().getTime();

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, LINE_WEBHOOK_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return jsonError("too_large", "リクエストが大きすぎます。", 413);
    return jsonError("invalid_request", "リクエストが不正です。", 400);
  }

  if (
    !verifyLineSignature(
      channelSecret,
      body,
      request.headers.get("x-line-signature"),
    )
  )
    return jsonError("unauthorized", "認証が必要です。", 401);

  const events = parseLineWebhook(body);
  if (events === null)
    return jsonError("invalid_request", "リクエストが不正です。", 400);

  const deadline = new Date(start + LINE_TIMING.webhookDeliveryBudgetMs);
  for (const [index, event] of events.entries()) {
    if (deps.now().getTime() - start >= LINE_TIMING.webhookEventsTimeoutMs) {
      deps.log("LINE_EVENTS_TIMED_OUT", { count: events.length - index });
      break;
    }
    try {
      await bot.handleEvent(event, deadline);
    } catch {
      // Never the error itself: it can carry message text or ids.
      deps.log("LINE_EVENT_FAILED", { eventId: event.webhookEventId });
    }
  }
  return Response.json({}, { headers: noStore });
}
