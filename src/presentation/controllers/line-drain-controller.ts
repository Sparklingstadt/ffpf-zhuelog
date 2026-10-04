import type { DrainLineJobs } from "@ffpf-zhuelog/core/application/line/use-cases/drain-line-jobs";
import { verifyBearerToken } from "@/infrastructure/line/security";

// Leaves room under the route's 60s maxDuration.
export const LINE_DRAIN_BUDGET_MS = 50_000;

const NO_STORE = { "Cache-Control": "no-store" };

export async function handleLineDrain(
  request: Request,
  secret: string | undefined,
  drain: Pick<DrainLineJobs, "execute"> | null,
) {
  if (!verifyBearerToken(request.headers.get("authorization"), secret))
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: NO_STORE },
    );
  if (!drain)
    return Response.json(
      { error: "LINE_DISABLED" },
      { status: 503, headers: NO_STORE },
    );
  try {
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
