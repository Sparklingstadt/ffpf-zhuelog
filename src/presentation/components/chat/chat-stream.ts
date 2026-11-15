// Reads Go's NDJSON answer: {"type":"delta","text"} lines, then
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
