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
