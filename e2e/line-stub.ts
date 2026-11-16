import { createServer, type ServerResponse } from "node:http";

// A stand-in for the LINE Messaging API. Nothing leaves this machine.
//
// - Every call must carry "Authorization: Bearer <accessToken>", else 401.
// - POST /v2/bot/message/reply and /v2/bot/message/push record the message
//   texts and answer 200 {}. A replyToken or "to" containing "fail" is a 500
//   instead (nothing recorded).
// - GET /v2/bot/message/quota answers {"type":"limited","value":200} and
//   /v2/bot/message/quota/consumption {"totalUsage":0}.
// - What was sent is answered by GET /e2e/line/sent?replyToken=<t> or
//   ?to=<user id> (no token needed): {"sent": [{"kind": "reply" | "push",
//   "replyToken"?, "to"?, "texts": [...]}]}, in the order received.
export type LineSent = {
  kind: "reply" | "push";
  replyToken?: string;
  to?: string;
  texts: string[];
};

export function startLineStub(
  port: number,
  accessToken: string,
): Promise<{ close(): Promise<void> }> {
  const sent: LineSent[] = [];
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    if (request.method === "GET" && url.pathname === "/e2e/line/sent") {
      const replyToken = url.searchParams.get("replyToken");
      const to = url.searchParams.get("to");
      json(response, 200, {
        sent: sent.filter(
          (item) =>
            (replyToken !== null && item.replyToken === replyToken) ||
            (to !== null && item.to === to),
        ),
      });
      return;
    }
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      json(response, 401, { message: "Authentication failed" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v2/bot/message/quota") {
      json(response, 200, { type: "limited", value: 200 });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v2/bot/message/quota/consumption"
    ) {
      json(response, 200, { totalUsage: 0 });
      return;
    }
    const kind =
      url.pathname === "/v2/bot/message/reply"
        ? "reply"
        : url.pathname === "/v2/bot/message/push"
          ? "push"
          : undefined;
    if (request.method !== "POST" || kind === undefined) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        replyToken?: string;
        to?: string;
        messages: { type: string; text: string }[];
      };
      const target = kind === "reply" ? parsed.replyToken : parsed.to;
      if (target?.includes("fail")) {
        json(response, 500, { message: "e2e failure" });
        return;
      }
      sent.push({
        kind,
        ...(kind === "reply"
          ? { replyToken: parsed.replyToken }
          : { to: parsed.to }),
        texts: parsed.messages.map((message) => message.text),
      });
      json(response, 200, {});
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
