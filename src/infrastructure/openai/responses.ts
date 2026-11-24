import type { OpenAiUsage } from "@/domain/vocabulary/vocabulary-entry";
import type { OpenAiConfig } from "@/infrastructure/config/environment";

export type OpenAiErrorCode =
  | "OPENAI_REQUEST_FAILED"
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_TIMEOUT"
  | "OPENAI_INVALID_RESPONSE"
  // A streamed answer cut short (the token limit) where a whole one is needed.
  | "OPENAI_INCOMPLETE_RESPONSE";

// A failed call. The message is only the code, so it never carries the API
// key, the input or the response body. retryable says a later attempt may
// work (a transport failure or a 5xx).
export class OpenAiError extends Error {
  constructor(
    readonly code: OpenAiErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "OpenAiError";
  }
}

export type JsonRequest = {
  instructions: string;
  schemaName: string;
  schema: object;
  input: string;
};

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 1 << 20;

// Asks the Responses API for a strict JSON answer and returns the model's JSON
// text. Tokens are reported even when the answer turns out unusable.
export async function respondJson(
  config: OpenAiConfig,
  request: JsonRequest,
  onUsage: (usage: OpenAiUsage) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${config.baseUrl.replace(/\/+$/, "")}/v1/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        // The request carries the API key: never follow a redirect.
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: config.learningModel,
          instructions: request.instructions,
          input: request.input,
          store: false,
          max_output_tokens: 4000,
          reasoning: { effort: "minimal" },
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
        }),
      },
    );
  } catch (error) {
    throw transportError(error);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      throw new OpenAiError("OPENAI_AUTH_FAILED");
    if (response.status === 429) throw new OpenAiError("OPENAI_RATE_LIMITED");
    throw new OpenAiError("OPENAI_REQUEST_FAILED", response.status >= 500);
  }
  const text = await readCapped(response);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  }
  const usage = usageOf(payload, config.learningModel);
  if (usage) onUsage(usage);
  const out = outputText(payload);
  if (out === undefined) throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  return out;
}

// A request that could not be sent or read: a timeout or abort is
// OPENAI_TIMEOUT, anything else OPENAI_REQUEST_FAILED. Both may be retried.
export function transportError(error: unknown): OpenAiError {
  const name = error instanceof Error ? error.name : "";
  return new OpenAiError(
    name === "AbortError" || name === "TimeoutError"
      ? "OPENAI_TIMEOUT"
      : "OPENAI_REQUEST_FAILED",
    true,
  );
}

// Reads the body, giving up as soon as it passes the cap.
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new OpenAiError("OPENAI_INVALID_RESPONSE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OpenAiError) throw error;
    throw transportError(error);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function usageOf(payload: unknown, model: string): OpenAiUsage | undefined {
  const usage = (payload as { usage?: unknown } | null)?.usage as
    { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  if (!usage || typeof usage !== "object") return undefined;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { model, inputTokens: input, outputTokens: output };
}

// Concatenates the output_text parts of a completed body. A refusal, an
// incomplete status or no text at all is undefined.
function outputText(payload: unknown): string | undefined {
  const body = payload as {
    status?: unknown;
    output?: {
      type?: unknown;
      content?: { type?: unknown; text?: unknown }[];
    }[];
  } | null;
  if (!body || body.status !== "completed" || !Array.isArray(body.output))
    return undefined;
  let out = "";
  for (const item of body.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "refusal") return undefined;
      if (part?.type === "output_text" && typeof part.text === "string")
        out += part.text;
    }
  }
  return out.length > 0 ? out : undefined;
}
