#!/usr/bin/env node
// Offline protocol fixture; never invokes a model or reads stored credentials.
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  const result = (value) => send({ id, result: value });
  if (method === "initialize") result({ userAgent: "codex/0.155.0-alpha.9.2" });
  else if (method === "account/read")
    result({ account: { type: "chatgpt", planType: "business" } });
  else if (method === "model/list")
    result({ data: [{ model: "gpt-5.6-sol" }], nextCursor: null });
  else if (method === "config/read")
    result({ config: { mcp_servers: { inherited: { enabled: true } } } });
  else if (method === "thread/start") {
    if (
      params.config["mcp_servers.inherited.enabled"] !== false ||
      !params.ephemeral ||
      params.sandbox !== "read-only"
    )
      process.exit(1);
    result({
      thread: { id: "test" },
      model: params.model,
      sandbox: { type: "readOnly" },
    });
  } else if (method === "turn/start") {
    result({ turn: { id: "turn" } });
    const text = params.input[0].text;
    if (text === "hang") return;
    if (text === "tool")
      return send({ id: 99, method: "item/tool/call", params: {} });
    if (text === "failure")
      return send({
        method: "turn/completed",
        params: { turn: { status: "failed" } },
      });
    if (text === "exit") return process.exit(1);
    if (
      process.env.OPENAI_API_KEY ||
      process.env.DATABASE_URL ||
      process.env.CODEX_ACCESS_TOKEN
    )
      process.exit(1);
    send({
      method: "item/agentMessage/delta",
      params: {
        delta:
          text === "long"
            ? "字".repeat(12_001)
            : text.startsWith('{"originalText":')
              ? JSON.stringify({
                  correctedText: "今天我很忙。",
                  pinyin: "Jīntiān wǒ hěn máng.",
                  hints: ["忙＝忙しい"],
                })
              : "你好（nǐ hǎo）",
      },
    });
    send({
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    });
  }
});
