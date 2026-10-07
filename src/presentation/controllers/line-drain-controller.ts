import type { DrainLineJobs } from "@ffpf-zhuelog/core/application/line/use-cases/drain-line-jobs";
import { verifyBearerToken } from "@/infrastructure/line/security";

// Leaves room under the route's 60s maxDuration.
export const LINE_DRAIN_BUDGET_MS = 50_000;

const NO_STORE = { "Cache-Control": "no-store" };

// `openssl rand -hex 32` makes 64 characters; anything under 32 is too guessable
// for a public endpoint and is treated as not configured.
export const MIN_CRON_SECRET_LENGTH = 32;

export async function handleLineDrain(
  request: Request,
  secret: string | undefined,
  createDrain: () => Pick<DrainLineJobs, "execute"> | null,
  createForwarder: () => { forward(): Promise<Response> } | null = () => null,
) {
  if (
    !secret ||
    secret.length < MIN_CRON_SECRET_LENGTH ||
    !verifyBearerToken(request.headers.get("authorization"), secret)
  )
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: NO_STORE },
    );
  try {
    const drain = createDrain();
    if (!drain) {
      const forwarder = createForwarder();
      if (forwarder) return await forwarder.forward();
      return Response.json(
        { error: "LINE_DISABLED" },
        { status: 503, headers: NO_STORE },
      );
    }
    const processed = await drain.execute(Date.now() + LINE_DRAIN_BUDGET_MS);
    return Response.json({ processed }, { headers: NO_STORE });
  } catch {
    // Fixed code only: errors from the database may contain row data.
    console.error("LINE_DRAIN_FAILED");
    return Response.json(
      { error: "LINE_DRAIN_FAILED" },
      { status: 503, headers: NO_STORE },
    );
  }
}
