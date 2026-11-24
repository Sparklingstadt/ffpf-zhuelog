// The LINE Messaging API: replies, pushes and the month's push allowance.
// Errors never contain the access token, the reply token, the recipient or
// the text (Go: line/client.go).

import type { LinePushQuota } from "@/domain/line/line-message";
import {
  fieldValues,
  stringField,
  isJsonObject,
  type JsonObject,
} from "@/infrastructure/line/json-fields";

// A failed call. status is the HTTP status LINE answered with; null when the
// request was not sent, not answered, or its answer could not be read. The
// message is only that status, never the request or the response body.
export class LineApiError extends Error {
  override name = "LineApiError" as const;

  constructor(readonly status: number | null) {
    super(
      status === null
        ? "LINE request failed"
        : `LINE API returned status ${status}`,
    );
  }
}

export type LineMessaging = {
  reply(replyToken: string, texts: string[]): Promise<void>;
  push(to: string, texts: string[]): Promise<void>;
  pushQuota(): Promise<LinePushQuota>;
};

// Go: main.go's LINE client, 10 s and no redirects.
const REQUEST_TIMEOUT_MS = 10_000;
// Go: maxBody (line/client.go:17).
const MAX_BODY_BYTES = 1 << 20;
// Go: maxMessagesPerCall (line/client.go:19), the Messaging API's limit.
const MAX_MESSAGES_PER_CALL = 5;

// Go: line.Client (line/client.go, line/quota.go).
export function createLineMessaging(
  config: { accessToken: string; apiBaseUrl: string },
  fetchImpl: typeof fetch = fetch,
): LineMessaging {
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  const authorization = `Bearer ${config.accessToken}`;

  async function call(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        // The request carries the access token: never follow a redirect.
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The cause is dropped on purpose: it can embed request details.
      throw new LineApiError(null);
    }
    if (response.status < 200 || response.status > 299) {
      await response.body?.cancel().catch(() => {});
      throw new LineApiError(response.status);
    }
    return response;
  }

  // Go: Client.send (line/client.go:46-89).
  async function send(
    path: string,
    fields: Record<string, string>,
    texts: string[],
  ): Promise<void> {
    if (texts.length === 0 || texts.length > MAX_MESSAGES_PER_CALL)
      throw new LineApiError(null);
    const response = await call(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        ...fields,
        messages: texts.map((text) => ({ type: "text", text })),
      }),
    });
    // The answer is never read.
    await response.body?.cancel().catch(() => {});
  }

  // Go: Client.get (line/quota.go:51-80). The answer's top-level object, or
  // [] for a JSON null (Go leaves the struct zero).
  async function get(path: string): Promise<JsonObject[]> {
    const response = await call(path, {
      method: "GET",
      headers: { Authorization: authorization },
    });
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { ignoreBOM: true }).decode(
          await readCapped(response),
        ),
      );
    } catch {
      throw new LineApiError(null);
    }
    if (payload === null) return [];
    if (!isJsonObject(payload)) throw new LineApiError(null);
    return [payload];
  }

  return {
    // Go: Client.Reply (line/client.go:37-39).
    reply: (replyToken, texts) =>
      send("/v2/bot/message/reply", { replyToken }, texts),
    // Go: Client.Push (line/client.go:42-44).
    push: (to, texts) => send("/v2/bot/message/push", { to }, texts),
    // Go: Client.PushQuota (line/quota.go:23-48).
    async pushQuota() {
      const limit = await get("/v2/bot/message/quota");
      const type = stringField(limit, "type");
      if (type === "none") return { unlimited: true };
      if (type !== "limited") throw new LineApiError(null);
      // Go: Value int, 0 when absent; a null leaves it as it was.
      const value = intField(limit, "value", false) ?? 0;
      // Go: TotalUsage *int, an error when absent; a null makes it nil.
      const used = intField(
        await get("/v2/bot/message/quota/consumption"),
        "totalUsage",
        true,
      );
      if (used === null) throw new LineApiError(null);
      return { unlimited: false, remaining: Math.max(value - used, 0) };
    },
  };
}

// An int field (or *int when nullable): the last value, null when there is
// none, and a decode error when any value is not an integer. A JSON null
// makes a pointer nil and leaves an int as it was.
function intField(
  objects: readonly JsonObject[],
  name: string,
  nullable: boolean,
): number | null {
  let out: number | null = null;
  for (const value of fieldValues(objects, name)) {
    if (value === null) {
      if (nullable) out = null;
    } else if (typeof value === "number" && Number.isSafeInteger(value))
      out = value;
    else throw new LineApiError(null);
  }
  return out;
}

// Reads the body, giving up as soon as it passes the cap.
async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new LineApiError(null);
      }
      chunks.push(value);
    }
  } catch {
    throw new LineApiError(null);
  }
  return Buffer.concat(chunks);
}
