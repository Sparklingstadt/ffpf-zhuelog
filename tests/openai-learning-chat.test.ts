import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAiLearningChatGateway } from "../src/infrastructure/chat/openai-learning-chat-gateway";

test("API chat streams with GPT-6.1 Sol, medium reasoning and storage disabled", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENAI_MODEL;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.reasoning.effort, "medium");
    assert.equal(body.store, false);
    const events = [
      {
        type: "response.created",
        response: { id: "resp_test", created_at: 0, model: body.model },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_test" },
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_test",
        output_index: 0,
        delta: "你好！",
      },
      { type: "response.completed", response: {} },
    ];
    return new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    const response = new OpenAiLearningChatGateway().stream({
      messages: [{ role: "user", text: "你好" }],
      systemPrompt: "Help with Chinese conversation.",
      maxOutputTokens: 4000,
    });
    const stream = await response.text();
    assert.equal(calls, 1);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(stream.includes("你好！"));
    assert.ok(!stream.includes('"type":"error"'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});
