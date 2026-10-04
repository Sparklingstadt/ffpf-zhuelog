import type { LineMessenger } from "@ffpf-zhuelog/core/application/line/ports/line-messenger";
import type { LearningKind } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import { endpointOverride } from "../config/test-endpoint";
import { formatLineLearningReply } from "./line-reply-formatter";

export class LinePushMessenger implements LineMessenger {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = endpointOverride(
      process.env.LINE_API_BASE_URL,
      "https://api.line.me",
    ),
  ) {}

  async push(
    userId: string,
    csv: string,
    kind: LearningKind,
    retryKey: string,
  ) {
    let text: string;
    try {
      text = formatLineLearningReply(csv, kind);
    } catch {
      return "rejected" as const;
    }
    return this.pushText(userId, text, retryKey);
  }

  async pushText(userId: string, text: string, retryKey: string) {
    if (!text.trim() || text.length > 5000) return "rejected" as const;
    try {
      const result = await this.fetcher(`${this.baseUrl}/v2/bot/message/push`, {
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
      });
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
