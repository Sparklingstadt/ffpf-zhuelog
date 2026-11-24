const FAILURE = "ChatGPTから応答を受信できませんでした。";

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "X-Accel-Buffering": "no",
  "Cache-Control": "no-store",
};

const encoder = new TextEncoder();
const line = (value: object) => encoder.encode(`${JSON.stringify(value)}\n`);

// The browser's NDJSON answer: {"type":"delta","text"} lines, then
// {"type":"done"}, or {"type":"error","message"} when the answer fails after
// some text. It waits for the first piece before it sends the headers: a
// failure before it is a 502 JSON error instead. An answer without pieces is
// a 200 with only "done". Cancelling the body (the browser went away) returns
// the iterator, but an async generator handles that only after the piece it
// is waiting for: the caller stops OpenAI sooner by passing the request's
// signal to the pieces (e2e "stopping an answer stops the request to
// OpenAI").
export async function answerStreamResponse(
  pieces: AsyncIterable<string>,
): Promise<Response> {
  const iterator = pieces[Symbol.asyncIterator]();
  let pending: IteratorResult<string> | null;
  try {
    pending = await iterator.next();
  } catch {
    return Response.json(
      { error: { code: "chat_failed", message: FAILURE } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let chunk: Uint8Array;
        let last = false;
        try {
          const result = pending ?? (await iterator.next());
          pending = null;
          if (result.done) {
            chunk = line({ type: "done" });
            last = true;
          } else {
            chunk = line({ type: "delta", text: result.value });
          }
        } catch {
          chunk = line({ type: "error", message: FAILURE });
          last = true;
        }
        if (cancelled) return;
        controller.enqueue(chunk);
        if (last) controller.close();
      },
      async cancel() {
        cancelled = true;
        await iterator.return?.();
      },
    },
    // Pull only when the response is read, never ahead of it.
    { highWaterMark: 0 },
  );
  return new Response(stream, { status: 200, headers: NDJSON_HEADERS });
}
