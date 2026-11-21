import { lineBot } from "@/composition/line-container";
import { LINE_TIMING } from "@/domain/line/line-message";
import { cronSecret } from "@/infrastructure/config/environment";
import { handleCronRequest } from "@/presentation/controllers/cron-controller";

export const dynamic = "force-dynamic";
// The pass stops at 50 s (Go: drainBudget); 60 is Go's lineWriteTimeout.
export const maxDuration = 60;

// The daily LINE pass (Go: GET /v1/line/drain): late results, then the
// morning review message. Registered in vercel.json as a Vercel Cron
// (0 21 * * * UTC = 06:00 JST).
export async function GET(request: Request): Promise<Response> {
  // Without LINE the route does not exist, before the secret (as Go).
  if (!lineBot)
    return Response.json(
      { error: { code: "not_found", message: "見つかりません。" } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  const bot = lineBot;
  return handleCronRequest(request, {
    secret: cronSecret(),
    run: () =>
      bot.runDailyPass(new Date(Date.now() + LINE_TIMING.drainBudgetMs)),
    failureCode: "LINE_DRAIN_FAILED",
  });
}
