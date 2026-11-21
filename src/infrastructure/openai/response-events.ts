import { OpenAiError } from "@/infrastructure/openai/responses";

export type ResponseEvent =
  | { type: "delta"; text: string }
  | {
      type: "end";
      outcome: "completed" | "incomplete" | "failed";
      usage?: { inputTokens: number; outputTokens: number };
    };

const MAX_LINE_BYTES = 1 << 20;

const OUTCOMES: Record<string, "completed" | "incomplete" | "failed"> = {
  "response.completed": "completed",
  "response.incomplete": "incomplete",
  "response.failed": "failed",
  error: "failed",
};

// Reads the Responses API's server-sent events. Throws OpenAiError
// ("OPENAI_INVALID_RESPONSE") for a line over maxLineBytes or bad JSON in a
// data line; read errors are rethrown as they are (the caller maps them).
// Go: chat/openai.go Streamer.Stream (the scanner loop).
export async function* readResponseEvents(
  body: ReadableStream<Uint8Array>,
  maxLineBytes: number = MAX_LINE_BYTES,
): AsyncGenerator<ResponseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const event = parseLine(line, maxLineBytes);
        if (!event) continue;
        yield event;
        if (event.type === "end") return;
      }
      // A line still without its end may not grow past the limit either.
      if (Buffer.byteLength(pending) > maxLineBytes)
        throw new OpenAiError("OPENAI_INVALID_RESPONSE");
      if (done) break;
    }
    // Like Go's scanner, a last line without a line end is still read.
    const event = parseLine(pending, maxLineBytes);
    if (event) yield event;
  } finally {
    // Stops the body when the caller leaves early or the stream ended.
    await reader.cancel().catch(() => {});
  }
}

// One line's event, or undefined for event names, comments, blank lines and
// event types that do not matter.
function parseLine(
  raw: string,
  maxLineBytes: number,
): ResponseEvent | undefined {
  if (Buffer.byteLength(raw) > maxLineBytes)
    throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (!line.startsWith("data:")) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line.slice("data:".length).trim());
  } catch {
    throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  }
  // Go decoded into a struct: a number, a string or an array was an error.
  if (typeof event !== "object" || Array.isArray(event))
    throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  const { type, delta, response } = (event ?? {}) as {
    type?: unknown;
    delta?: unknown;
    response?: unknown;
  };
  if (typeof type !== "string") return undefined;
  if (type === "response.output_text.delta") {
    return typeof delta === "string" && delta !== ""
      ? { type: "delta", text: delta }
      : undefined;
  }
  const outcome = OUTCOMES[type];
  if (!outcome) return undefined;
  const usage = usageOf(response);
  return usage ? { type: "end", outcome, usage } : { type: "end", outcome };
}

// The token counts of a final event's response; none without a response or
// usage. Negative counts are 0, as Go's aiusage did.
function usageOf(
  response: unknown,
): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (response as { usage?: unknown } | null | undefined)?.usage as
    { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  if (!usage || typeof usage !== "object") return undefined;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { inputTokens: Math.max(0, input), outputTokens: Math.max(0, output) };
}
