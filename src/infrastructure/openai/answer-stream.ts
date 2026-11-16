import type { OpenAiUsage } from "@/domain/vocabulary/vocabulary-entry";
import type { OpenAiConfig } from "@/infrastructure/config/environment";
import { readResponseEvents } from "@/infrastructure/openai/response-events";
import { OpenAiError, transportError } from "@/infrastructure/openai/responses";

export type AnswerTurn = { role: "user" | "assistant"; text: string };

export type AnswerRequest = {
  model: string;
  instructions: string;
  messages: readonly AnswerTurn[];
  // true: response.incomplete is OPENAI_INCOMPLETE_RESPONSE (quick
  // questions); false: it ends the answer (the chat, stage 7).
  requireComplete: boolean;
};

// Go: chat/openai.go requestTimeout, for the whole answer.
const ANSWER_TIMEOUT_MS = 60_000;
// Go: chat/chat.go maxOutputTokens.
const MAX_OUTPUT_TOKENS = 1600;

// Streams the answer's text pieces. Throws OpenAiError; reports usage
// through onUsage before it returns or throws. Cancelling signal, or
// returning early from the iteration, aborts the request.
// Go: chat/openai.go Streamer.Stream. One attempt, no retries.
export async function* streamAnswer(
  config: OpenAiConfig,
  request: AnswerRequest,
  options: {
    signal: AbortSignal;
    onUsage: (usage: OpenAiUsage) => void;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): AsyncGenerator<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? ANSWER_TIMEOUT_MS);
  // Aborted when the caller stops iterating, so OpenAI stops generating.
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, timeout, stop.signal]);

  // A deadline is OPENAI_TIMEOUT; the caller's cancel is a failed request,
  // as Go's TransportError told a deadline from a cancelled context.
  const failure = (error: unknown): OpenAiError => {
    if (error instanceof OpenAiError) return error;
    if (timeout.aborted) return new OpenAiError("OPENAI_TIMEOUT");
    if (signal.aborted) return new OpenAiError("OPENAI_REQUEST_FAILED");
    return transportError(error);
  };

  try {
    let response: Response;
    try {
      response = await fetchImpl(
        `${config.baseUrl.replace(/\/+$/, "")}/v1/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${config.apiKey}`,
          },
          // The request carries the API key: never follow a redirect.
          redirect: "manual",
          signal,
          body: JSON.stringify({
            model: request.model,
            instructions: request.instructions,
            input: request.messages.map((turn) => ({
              role: turn.role,
              content: turn.text,
            })),
            stream: true,
            store: false,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            reasoning: { effort: "medium" },
          }),
        },
      );
    } catch (error) {
      throw failure(error);
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403)
        throw new OpenAiError("OPENAI_AUTH_FAILED");
      if (response.status === 429) throw new OpenAiError("OPENAI_RATE_LIMITED");
      throw new OpenAiError("OPENAI_REQUEST_FAILED");
    }

    try {
      // Leaving the loop early also cancels the body's reader.
      for await (const event of readResponseEvents(response.body)) {
        if (event.type === "delta") {
          yield event.text;
          continue;
        }
        if (event.usage)
          options.onUsage({ model: request.model, ...event.usage });
        if (event.outcome === "completed") return;
        if (event.outcome === "incomplete") {
          if (request.requireComplete)
            throw new OpenAiError("OPENAI_INCOMPLETE_RESPONSE");
          return;
        }
        throw new OpenAiError("OPENAI_INVALID_RESPONSE");
      }
    } catch (error) {
      throw failure(error);
    }
    // The stream ended without saying the answer was complete.
    if (signal.aborted) throw failure(signal.reason);
    throw new OpenAiError("OPENAI_INVALID_RESPONSE");
  } finally {
    stop.abort();
  }
}
