import { createServer } from "node:http";

// A stand-in for the OpenAI Responses API with stream: true. It answers every
// POST /v1/responses with an echo of the last user message, split into three
// text deltas, then response.completed. Nothing leaves this machine.
export function startOpenAiStub(
  port: number,
): Promise<{ close(): Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const input = (
        JSON.parse(body) as {
          input: { role: string; content: string }[];
        }
      ).input;
      const last = input.findLast((item) => item.role === "user")?.content;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (payload: object) =>
        response.write(
          `event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      send({ type: "response.created", response: { status: "in_progress" } });
      for (const delta of ["你好！", `「${last}」`, "ですね。"])
        send({ type: "response.output_text.delta", delta });
      send({ type: "response.completed", response: { status: "completed" } });
      response.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}
