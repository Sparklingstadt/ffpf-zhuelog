import { z } from "zod";
import type { LineJobRepository } from "@/application/line/ports/line-job-repository";
import {
  readLimitedBody,
  verifyLineSignature,
} from "@/infrastructure/line/security";
import type { getLineConfig } from "@/infrastructure/line/config";

const envelopeSchema = z.object({
  destination: z.string(),
  events: z.array(z.unknown()).max(100),
});
const eventSchema = z.object({
  type: z.literal("message"),
  mode: z.literal("active"),
  webhookEventId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  timestamp: z.number().int().nonnegative(),
  source: z.object({ type: z.literal("user"), userId: z.string() }),
  message: z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(500),
  }),
});

export async function handleLineWebhook(
  request: Request,
  config: ReturnType<typeof getLineConfig>,
  jobs: LineJobRepository,
) {
  if (!config)
    return Response.json({ error: "LINE_DISABLED" }, { status: 503 });
  let body: Buffer;
  try {
    body = await readLimitedBody(request);
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 413 });
  }
  if (
    !verifyLineSignature(
      body,
      request.headers.get("x-line-signature"),
      config.secret,
    )
  ) {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(body.toString("utf8")));
  } catch {
    return Response.json({ error: "INVALID_EVENT" }, { status: 400 });
  }
  if (envelope.destination !== config.botId)
    return Response.json({ error: "WRONG_DESTINATION" }, { status: 403 });
  const inputs = envelope.events.flatMap((event) => {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success || parsed.data.source.userId !== config.userId)
      return [];
    const data = parsed.data;
    if (
      !/\p{Script=Han}/u.test(data.message.text) ||
      data.timestamp > Date.now() + 60_000 ||
      Date.now() - data.timestamp > 7 * 86400_000
    )
      return [];
    return [
      {
        eventId: data.webhookEventId,
        userId: data.source.userId,
        originalText: data.message.text,
        receivedAt: new Date(data.timestamp),
      },
    ];
  });
  try {
    await jobs.enqueue(inputs);
  } catch {
    return Response.json({ error: "QUEUE_UNAVAILABLE" }, { status: 503 });
  }
  return Response.json({ ok: true });
}
