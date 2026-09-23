import type { LineMessenger } from "@/application/line/ports/line-job-repository";
import { formatLineLearningReply } from "./line-reply-formatter";

export class LinePushMessenger implements LineMessenger {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async push(userId: string, csv: string, retryKey: string) {
    let text: string;
    try {
      text = formatLineLearningReply(csv);
    } catch {
      return "rejected" as const;
    }
    try {
      const result = await this.fetcher(
        "https://api.line.me/v2/bot/message/push",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
            "X-Line-Retry-Key": retryKey,
          },
          body: JSON.stringify({
            to: userId,
            messages: [{ type: "text", text }],
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (
        result.ok ||
        (result.status === 409 &&
          result.headers.has("x-line-accepted-request-id"))
      )
        return "accepted" as const;
      return result.status >= 500 ? ("retry" as const) : ("rejected" as const);
    } catch {
      return "retry" as const;
    }
  }
}
