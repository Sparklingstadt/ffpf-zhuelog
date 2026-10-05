// On Cloud Run with request-based billing the CPU is throttled as soon as the
// webhook has answered, so work in after() stalls. Instead the webhook asks
// Cloud Tasks to call /api/line/drain, which then runs in a request of its own.
const QUEUE_NAME =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/queues\/[A-Za-z0-9-]{1,100}$/;
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
// LINE gives the whole webhook 2 seconds to answer.
const ENQUEUE_TIMEOUT_MS = 1_000;
// Longer than the drain's 50s budget, so Cloud Tasks waits for its answer.
const DISPATCH_DEADLINE = "120s";
const MIN_SECRET_LENGTH = 32;

export type DrainTasksConfig = {
  queue: string;
  drainUrl: string;
  secret: string;
};

export function getDrainTasksConfig(
  env: Record<string, string | undefined> = process.env,
): DrainTasksConfig | null {
  const queue = env.LINE_DRAIN_TASKS_QUEUE?.trim();
  if (!queue) return null;
  const secret = env.CRON_SECRET?.trim();
  let drainUrl: URL | null = null;
  try {
    drainUrl = new URL("/api/line/drain", env.AUTH_URL?.trim());
  } catch {}
  if (
    !QUEUE_NAME.test(queue) ||
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    drainUrl?.protocol !== "https:"
  ) {
    // Fixed code only. The webhook falls back to after() and the scheduler.
    console.error("LINE_DRAIN_TASKS_MISCONFIGURED");
    return null;
  }
  return { queue, drainUrl: drainUrl.href, secret };
}

export class CloudTasksDrainTrigger {
  constructor(
    private readonly config: DrainTasksConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = ENQUEUE_TIMEOUT_MS,
  ) {}

  // Never throws: false means the caller must drain some other way.
  async enqueue(): Promise<boolean> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const token = await this.fetcher(METADATA_TOKEN_URL, {
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal,
      });
      if (!token.ok) return false;
      const { access_token: accessToken } = (await token.json()) as {
        access_token?: unknown;
      };
      if (typeof accessToken !== "string" || !accessToken) return false;
      const response = await this.fetcher(
        `https://cloudtasks.googleapis.com/v2/${this.config.queue}/tasks`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task: {
              dispatchDeadline: DISPATCH_DEADLINE,
              httpRequest: {
                httpMethod: "GET",
                url: this.config.drainUrl,
                headers: { Authorization: `Bearer ${this.config.secret}` },
              },
            },
          }),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
