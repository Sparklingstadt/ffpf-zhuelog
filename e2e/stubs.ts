import { createServer, type Server } from "node:http";
import { openaiStubPort, lineStubPort } from "./environment";

// Local stand-ins for OpenAI and LINE. The app reaches them only through the
// loopback-only OPENAI_API_BASE_URL / LINE_API_BASE_URL overrides, so the E2E
// never contacts the real services.

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    // Fail loudly: a busy port could mean the app talks to someone else's server.
    server.once("error", (error) =>
      reject(new Error(`E2E stub port ${port} is unavailable: ${error}`)),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
}

function readBody(request: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function responsesBody(output: unknown) {
  // The Responses API shape read by src/infrastructure/openai/responses.ts.
  return JSON.stringify({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
  });
}

export async function startStubs() {
  const pushes: unknown[] = [];

  const openai = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    let body: { input?: unknown; text?: { format?: { name?: unknown } } };
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (typeof body.input === "string" && body.input.includes("失敗")) {
      response.writeHead(500).end();
      return;
    }
    const output =
      body.text?.format?.name === "japanese_to_chinese_translation"
        ? {
            translatedText: "今天我很忙。",
            pinyin: "Jīntiān wǒ hěn máng.",
            hints: ["「忙しい」は「忙」で表します"],
          }
        : {
            correctedText: "今天我很忙。",
            pinyin: "Jīntiān wǒ hěn máng.",
            hints: ["「busy」は中国語の「忙」にします"],
          };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(responsesBody(output));
  });

  const line = createServer(async (request, response) => {
    if (request.url === "/__pushes" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(pushes));
      return;
    }
    if (request.url === "/__pushes" && request.method === "DELETE") {
      pushes.length = 0;
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/v2/bot/message/push" && request.method === "POST") {
      try {
        pushes.push(JSON.parse(await readBody(request)));
      } catch {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(404).end();
  });

  await listen(openai, openaiStubPort);
  try {
    await listen(line, lineStubPort);
  } catch (error) {
    openai.close();
    throw error;
  }

  const close = (server: Server) =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  return {
    openaiUrl: `http://127.0.0.1:${openaiStubPort}`,
    lineUrl: `http://127.0.0.1:${lineStubPort}`,
    close: async () => {
      await Promise.all([close(openai), close(line)]);
    },
  };
}
