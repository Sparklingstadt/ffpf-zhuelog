// The LINE Messaging API: replies, pushes and the month's push allowance.
// Errors never contain the access token, the reply token, the recipient or
// the text.

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

// One call may take 10 s.
const REQUEST_TIMEOUT_MS = 10_000;
// The most of an answer that is read: 1 MiB.
const MAX_BODY_BYTES = 1 << 20;
// The Messaging API's limit of messages in one call.
const MAX_MESSAGES_PER_CALL = 5;

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

  // Posts 1 to 5 texts as messages to a reply or push path.
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

  // GETs a JSON answer: its top-level object, or [] for a JSON null (every
  // field then reads as absent).
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
    reply: (replyToken, texts) =>
      send("/v2/bot/message/reply", { replyToken }, texts),
    push: (to, texts) => send("/v2/bot/message/push", { to }, texts),
    // The month's limit minus what was used; never below 0.
    async pushQuota() {
      const limit = await get("/v2/bot/message/quota");
      const type = stringField(limit, "type");
      if (type === "none") return { unlimited: true };
      if (type !== "limited") throw new LineApiError(null);
      // The limit is 0 when absent or null.
      const value = intField(limit, "value", false) ?? 0;
      // The usage must be there: absent or null is an error.
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

// An integer field: the last value, null when there is none, and an error
// when any value is not an integer. A JSON null resets a nullable field to
// null and leaves any other as it was.
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
