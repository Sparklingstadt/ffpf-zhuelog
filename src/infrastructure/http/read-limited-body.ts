export class BodyLimitError extends Error {}

export async function readLimitedBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes = 64 * 1024,
  timeoutMs = 10_000,
) {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new BodyLimitError("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BodyLimitError("BODY_TIMEOUT"));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new BodyLimitError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
