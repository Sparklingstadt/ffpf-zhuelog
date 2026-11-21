import { createServer } from "node:http";

// A stand-in for the OpenAI Responses API. Nothing leaves this machine.
//
// - A vocabulary draft (the "vocabulary_card_draft" JSON format) gets a
//   completed JSON answer built from the word.
// - A LINE correction ("chinese_correction") gets {"correctedText": "<the
//   input>（添削）", "pinyin": "e2e pīnyīn", "hints": ["e2e のヒント 1",
//   "e2e のヒント 2"]}, a LINE translation ("japanese_to_chinese_translation")
//   {"translatedText": "e2e 的翻译", "pinyin": "e2e pīnyīn", "hints":
//   ["e2e のヒント"]}, both completed with usage (15 input and 25 output
//   tokens). An input containing "[fail]" is a 500 instead (a failure the
//   web may try again).
// - Every other POST /v1/responses is streamed: an echo of the last user
//   message, split into three text deltas, then response.completed with
//   usage (21 input and 43 output tokens). Markers in the last user message
//   change that:
//   - "[incomplete]": one delta ("你好！"), then response.incomplete with
//     the same usage.
//   - "[fail]": 500 before any event, so no usage.
//   - "[hang]": one delta ("你好！"), then nothing until the caller closes
//     the connection (or 30 s pass, then response.completed). How it ended
//     is answered by GET /e2e/streams?message=<the last user message>:
//     {"state": "open" | "closed" | "completed" | "unknown"}.
export function startOpenAiStub(
  port: number,
): Promise<{ close(): Promise<void> }> {
  const hangs = new Map<string, "open" | "closed" | "completed">();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    if (request.method === "GET" && url.pathname === "/e2e/streams") {
      const state = hangs.get(url.searchParams.get("message") ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ state: state ?? "unknown" }));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/responses") {
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
      const lineFormat = parsed.text?.format?.name;
      if (
        lineFormat === "chinese_correction" ||
        lineFormat === "japanese_to_chinese_translation"
      ) {
        const text = parsed.input as string;
        if (text.includes("[fail]")) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "e2e failure" } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(lineLearning(lineFormat, text)));
        return;
      }
      const input = parsed.input as { role: string; content: string }[];
      const last = input.findLast((item) => item.role === "user")?.content;
      if (last?.includes("[fail]")) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "e2e failure" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (payload: object) =>
        response.write(
          `event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      const usage = { input_tokens: 21, output_tokens: 43, total_tokens: 64 };
      send({ type: "response.created", response: { status: "in_progress" } });
      if (last?.includes("[incomplete]")) {
        send({ type: "response.output_text.delta", delta: "你好！" });
        send({
          type: "response.incomplete",
          response: { status: "incomplete", usage },
        });
        response.end();
        return;
      }
      if (last?.includes("[hang]")) {
        send({ type: "response.output_text.delta", delta: "你好！" });
        hangs.set(last, "open");
        const timer = setTimeout(() => {
          hangs.set(last, "completed");
          send({
            type: "response.completed",
            response: { status: "completed", usage },
          });
          response.end();
        }, 30_000);
        // "close" before the end: the caller went away mid-answer.
        response.on("close", () => {
          clearTimeout(timer);
          if (!response.writableFinished) hangs.set(last, "closed");
        });
        return;
      }
      for (const delta of ["你好！", `「${last}」`, "ですね。"])
        send({ type: "response.output_text.delta", delta });
      send({
        type: "response.completed",
        response: { status: "completed", usage },
      });
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

// A completed Responses API body with a LINE correction of text, or a
// translation.
function lineLearning(
  format: "chinese_correction" | "japanese_to_chinese_translation",
  text: string,
) {
  const answer =
    format === "chinese_correction"
      ? {
          correctedText: `${text}（添削）`,
          pinyin: "e2e pīnyīn",
          hints: ["e2e のヒント 1", "e2e のヒント 2"],
        }
      : {
          translatedText: "e2e 的翻译",
          pinyin: "e2e pīnyīn",
          hints: ["e2e のヒント"],
        };
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(answer) }],
      },
    ],
    usage: { input_tokens: 15, output_tokens: 25, total_tokens: 40 },
  };
}
