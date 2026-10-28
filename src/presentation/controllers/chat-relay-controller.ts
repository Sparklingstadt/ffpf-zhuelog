import { isSameOriginRequest } from "../http/same-origin";

// Go checks the same limit; reading it here keeps a large body off the wire.
const MAX_BODY_BYTES = 256 * 1024;
const FAILURE = "ChatGPTから応答を受信できませんでした。";

export type ChatRelayDeps = {
  accessToken: string | undefined;
  // Calls the Go API at path; the route passes request.signal along so a
  // stopped answer stops Go and OpenAI too.
  fetchGo: (path: string, init: RequestInit) => Promise<Response>;
  upstreamPath?: "/v1/chat" | "/v1/quick-question";
};

const json = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

class BodyTooLarge extends Error {}

// Reads the body, giving up as soon as it passes maxBytes.
async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// POST /api/chat: hands the conversation to Go's POST /v1/chat as the
// signed-in user and streams Go's answer (NDJSON, or a JSON error) back as is.
// Go decides who may chat (admins) and validates the messages.
export async function handleChatRelay(
  request: Request,
  deps: ChatRelayDeps,
): Promise<Response> {
  if (!isSameOriginRequest(request))
    return json("この画面から送信してください。", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return json("JSON形式で送信してください。", 415);
  if (!deps.accessToken) return json("認証が必要です。", 401);

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return json("会話が大きすぎます。", 413);
    return json("リクエストを読み取れませんでした。", 400);
  }

  let upstream: Response;
  try {
    upstream = await deps.fetchGo(deps.upstreamPath ?? "/v1/chat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.accessToken}`,
        "content-type": "application/json",
      },
      body: body as BodyInit,
    });
  } catch {
    return json(FAILURE, 502);
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}
