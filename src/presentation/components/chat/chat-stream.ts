// Reads the NDJSON answer: {"type":"delta","text"} lines, then
// {"type":"done"}, or {"type":"error","message"} when the answer failed
// halfway. An answer that ends without either was cut off.
export type ChatStreamResult = "done" | "cut" | { error: string };

export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<ChatStreamResult> {
  const reader = body.getReader();
  // stream: true keeps a character split across chunks for the next read.
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return "cut";
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event: { type?: unknown; text?: unknown; message?: unknown };
        try {
          event = JSON.parse(line);
        } catch {
          return "cut";
        }
        if (event.type === "delta" && typeof event.text === "string")
          onDelta(event.text);
        else if (event.type === "done") return "done";
        else if (event.type === "error")
          return {
            error:
              typeof event.message === "string" && event.message
                ? event.message
                : "応答が途中で切れました。",
          };
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

// Reads the error text of a failed chat relay response: the relay's
// {error: string} or Go's {error: {message}}. Anything else gives fallback.
export async function readFailureText(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string };
    };
    const error = body.error;
    if (typeof error === "string" && error) return error;
    if (typeof error === "object" && error?.message) return error.message;
  } catch {
    // Not JSON.
  }
  return fallback;
}

export type ChatStreamTexts = {
  // Nothing usable came back (a network error, a body that is not JSON).
  failure: string;
  // The answer stopped before "done".
  cut: string;
  // The user pressed stop.
  stopped: string;
};

export type StreamChatResult =
  | { ok: true; text: string }
  // `text` is what arrived before the answer failed, for showing dimmed.
  | { ok: false; text: string; message: string };

// Sends the conversation to a chat relay route and reads the answer as it
// streams in, calling onText with the answer so far. Never throws: every
// failure becomes a message for the user, the server's own when it gave one.
export async function streamChat({
  endpoint,
  messages,
  signal,
  onText,
  texts,
  fetchFn = fetch,
}: {
  endpoint: string;
  messages: readonly { role: string; text: string }[];
  signal: AbortSignal;
  onText: (text: string) => void;
  texts: ChatStreamTexts;
  fetchFn?: typeof fetch;
}): Promise<StreamChatResult> {
  let received = "";
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
    if (!response.ok || !response.body)
      return {
        ok: false,
        text: "",
        message: await readFailureText(response, texts.failure),
      };
    const result = await readChatStream(response.body, (delta) => {
      received += delta;
      onText(received);
    });
    if (result === "done" && received.trim())
      return { ok: true, text: received };
    return {
      ok: false,
      text: received,
      message: typeof result === "object" ? result.error : texts.cut,
    };
  } catch {
    return {
      ok: false,
      text: received,
      message: signal.aborted ? texts.stopped : texts.failure,
    };
  }
}

// Enter sends the form; Shift+Enter and Enter while composing (IME) do not.
export function submitOnEnter(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
  currentTarget: { form: HTMLFormElement | null };
  preventDefault: () => void;
}) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
    return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}
