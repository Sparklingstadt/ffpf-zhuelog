import { lineBot } from "@/composition/line-container";
import { lineConfig } from "@/infrastructure/config/environment";
import { handleLineWebhook } from "@/presentation/controllers/line-webhook-controller";

export const dynamic = "force-dynamic";
// Events stop starting after 55 s (LINE_TIMING.webhookEventsTimeoutMs); 60
// leaves room for the last one and the answer.
export const maxDuration = 60;

const channelSecret = lineConfig()?.channelSecret;

// LINE's webhook: answered after the events are handled.
export async function POST(request: Request): Promise<Response> {
  return handleLineWebhook(request, {
    channelSecret,
    bot: lineBot,
    now: () => new Date(),
    // A failed or timed-out event: a fixed code and an event id or a count.
    log: (code, fields) => console.error(code, fields ?? {}),
  });
}
