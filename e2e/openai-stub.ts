import { createServer } from "node:http";

// A stand-in for the OpenAI Responses API. A vocabulary draft (the
// "vocabulary_card_draft" JSON format) gets a completed JSON answer built from
// the word; every other POST /v1/responses is streamed: an echo of the last
// user message, split into three text deltas, then response.completed.
// Nothing leaves this machine.
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
      const parsed = JSON.parse(body) as {
        input: unknown;
        text?: { format?: { name?: string } };
      };
      if (parsed.text?.format?.name === "vocabulary_card_draft") {
        const { word } = JSON.parse(parsed.input as string) as {
          word: string;
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(vocabularyDraft(word)));
        return;
      }
      const input = parsed.input as { role: string; content: string }[];
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

// A completed Responses API body whose output text is the draft of word.
function vocabularyDraft(word: string) {
  const draft = { pinyin: "e2e pīnyīn", meaning: `「${word}」の下書き` };
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
  };
}
