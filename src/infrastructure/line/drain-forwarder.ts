// LINE runs on Cloud Run, but the schedule lives in Vercel Cron, which can only
// call its own deployment. With LINE disabled there, Vercel's /api/line/drain
// passes the call on to the service named by LINE_DRAIN_FORWARD_URL.
// Under the Vercel route's 60s maxDuration; the remote drain stops at ~50s.
const FORWARD_TIMEOUT_MS = 55_000;
const MIN_SECRET_LENGTH = 32;

const NO_STORE = { "Cache-Control": "no-store" };

export type DrainForwardConfig = { drainUrl: string; secret: string };

export function getDrainForwardConfig(
  env: Record<string, string | undefined> = process.env,
): DrainForwardConfig | null {
  const base = env.LINE_DRAIN_FORWARD_URL?.trim();
  if (!base) return null;
  const secret = env.CRON_SECRET?.trim();
  let drainUrl: URL | null = null;
  try {
    drainUrl = new URL("/api/line/drain", base);
  } catch {}
  if (
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    drainUrl?.protocol !== "https:"
  ) {
    // Fixed code only. The drain answers 503 as if nothing were configured.
    console.error("LINE_DRAIN_FORWARD_MISCONFIGURED");
    return null;
  }
  return { drainUrl: drainUrl.href, secret };
}

export class DrainForwarder {
  constructor(
    private readonly config: DrainForwardConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = FORWARD_TIMEOUT_MS,
  ) {}

  // Never throws. Only the processed count is passed back.
  async forward(): Promise<Response> {
    try {
      const response = await this.fetcher(this.config.drainUrl, {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${this.config.secret}` },
      });
      const body = (await response.json().catch(() => null)) as {
        processed?: unknown;
      } | null;
      if (response.ok && typeof body?.processed === "number")
        return Response.json(
          { processed: body.processed },
          { headers: NO_STORE },
        );
      // Fixed code and the status only: the remote body is not ours to log.
      console.error("LINE_DRAIN_FORWARD_FAILED", response.status);
    } catch {
      console.error("LINE_DRAIN_FORWARD_FAILED");
    }
    return Response.json(
      { error: "LINE_DRAIN_FORWARD_FAILED" },
      { status: 503, headers: NO_STORE },
    );
  }
}
