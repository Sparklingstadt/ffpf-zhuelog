import assert from "node:assert/strict";
import { test } from "node:test";
import { LearningChatError } from "@ffpf-zhuelog/core/domain/chat/learning-chat-error";
import { StreamLearningChat } from "@ffpf-zhuelog/core/application/chat/use-cases/stream-learning-chat";
import { OpenAiLearningChatGateway } from "../src/infrastructure/chat/openai-learning-chat-gateway";
import { handleChatRequest } from "../src/presentation/controllers/chat-controller";

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
    let text = "";
    for await (const piece of new OpenAiLearningChatGateway().stream({
      messages: [{ role: "user", text: "你好" }],
      systemPrompt: "Help with Chinese conversation.",
      maxOutputTokens: 4000,
    }))
      text += piece;
    assert.equal(calls, 1);
    assert.equal(text, "你好！");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});

test("API chat failures surface only a safe message", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalError = console.error;
  process.env.OPENAI_API_KEY = "test-key";
  console.error = () => {};
  globalThis.fetch = async () =>
    Response.json({ error: { message: "SECRET upstream" } }, { status: 500 });
  try {
    await assert.rejects(
      async () => {
        for await (const piece of new OpenAiLearningChatGateway().stream({
          messages: [{ role: "user", text: "你好" }],
          systemPrompt: "test",
          maxOutputTokens: 100,
        }))
          void piece;
      },
      (error: unknown) => {
        assert.ok(error instanceof LearningChatError);
        assert.equal(error.message, "ChatGPTから応答を受信できませんでした。");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("the chat route streams the OpenAI answer to useChat end to end", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      [
        {
          type: "response.created",
          response: { id: "r", created_at: 0, model: "gpt-6.1-sol" },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: "m" },
        },
        {
          type: "response.output_text.delta",
          item_id: "m",
          output_index: 0,
          delta: "你好！",
        },
        { type: "response.completed", response: {} },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  try {
    const response = await handleChatRequest(
      new Request("https://app.example/api/chat", {
        method: "POST",
        headers: {
          Origin: "https://app.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "你好" }] },
          ],
        }),
      }),
      new StreamLearningChat(new OpenAiLearningChatGateway()),
    );
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /"type":"text-delta","id":"answer","delta":"你好！"/);
    assert.doesNotMatch(body, /"type":"error"/);
    assert.match(body, /\[DONE\]/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
