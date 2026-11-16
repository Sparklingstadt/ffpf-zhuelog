import assert from "node:assert/strict";
import { test } from "node:test";

import type { Asker } from "../src/application/chat/question-notes";
import { handleQuickQuestion } from "../src/presentation/controllers/quick-question-controller";

const body = JSON.stringify({ messages: [{ role: "user", text: " 你好 " }] });

function request(
  init: { origin?: string; contentType?: string; body?: string } = {},
) {
  return new Request("http://app.test/api/quick-question", {
    method: "POST",
    headers: {
      host: "app.test",
      origin: init.origin ?? "http://app.test",
      "content-type": init.contentType ?? "application/json",
    },
    body: init.body ?? body,
  });
}

type AskerResult =
  | { ok: true; asker: Asker }
  | {
      ok: false;
      reason: "signed-out" | "forbidden" | "demo" | "unavailable";
    };

function fakeAsker(
  answer: (
    text: string,
    signal: AbortSignal,
  ) => AsyncIterable<string> = async function* () {
    yield "你";
  },
) {
  const asked: { text: string; signal: AbortSignal }[] = [];
  const asker: Asker = {
    ask(text, signal) {
      asked.push({ text, signal });
      return answer(text, signal);
    },
  };
  return {
    asked,
    deps: { asker: async (): Promise<AskerResult> => ({ ok: true, asker }) },
  };
}

function refused(reason: "signed-out" | "forbidden" | "demo" | "unavailable") {
  return { asker: async (): Promise<AskerResult> => ({ ok: false, reason }) };
}

async function expectJson(response: Response, status: number, json: unknown) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), json);
}

const invalid = {
  error: {
    code: "invalid_request",
    message: "会話内容が上限を超えているか、形式が不正です。",
  },
};

test("a request from another page is refused first", async () => {
  let checked = false;
  // Even a guest gets the relay's own message, before the user is read.
  await expectJson(
    await handleQuickQuestion(request({ origin: "http://evil.test" }), {
      asker: async () => {
        checked = true;
        return { ok: false, reason: "forbidden" };
      },
    }),
    403,
    { error: "この画面から送信してください。" },
  );
  assert.equal(checked, false);
});

test("a body that is not JSON is 415", async () => {
  await expectJson(
    await handleQuickQuestion(
      request({ contentType: "text/plain" }),
      refused("signed-out"),
    ),
    415,
    { error: "JSON形式で送信してください。" },
  );
});

test("who may ask is checked before the body", async () => {
  const bad = request({ body: "not json" });
  await expectJson(await handleQuickQuestion(bad, refused("signed-out")), 401, {
    error: { code: "unauthorized", message: "認証が必要です。" },
  });
  await expectJson(
    await handleQuickQuestion(request({ body: "x" }), refused("forbidden")),
    403,
    {
      error: { code: "forbidden", message: "このアカウントは利用できません。" },
    },
  );
  await expectJson(
    await handleQuickQuestion(request({ body: "x" }), refused("demo")),
    403,
    { error: { code: "forbidden", message: "デモでは使えません。" } },
  );
  await expectJson(
    await handleQuickQuestion(request({ body: "x" }), refused("unavailable")),
    404,
    { error: { code: "not_found", message: "見つかりません。" } },
  );
});

test("a body over 256 KiB is 413", async () => {
  const { deps, asked } = fakeAsker();
  await expectJson(
    await handleQuickQuestion(request({ body: "a".repeat(262_144 + 1) }), deps),
    413,
    { error: "会話が大きすぎます。" },
  );
  assert.equal(asked.length, 0);
});

test("a body that cannot be read is 400", async () => {
  const { deps } = fakeAsker();
  const broken = new Request("http://app.test/api/quick-question", {
    method: "POST",
    headers: {
      host: "app.test",
      origin: "http://app.test",
      "content-type": "application/json",
    },
    body: new ReadableStream({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    }),
    duplex: "half",
  } as RequestInit);
  await expectJson(await handleQuickQuestion(broken, deps), 400, {
    error: "リクエストを読み取れませんでした。",
  });
});

test("a question of the wrong shape is 400", async () => {
  const { deps, asked } = fakeAsker();
  for (const bad of [
    "not json",
    "[]",
    JSON.stringify({ messages: [] }),
    JSON.stringify({ messages: [{ role: "user", text: "   " }] }),
    JSON.stringify({ messages: [{ role: "assistant", text: "你好" }] }),
    JSON.stringify({ messages: [{ role: "user", text: "你好" }], extra: 1 }),
    JSON.stringify({ messages: [{ role: "user", text: "好".repeat(4001) }] }),
  ])
    await expectJson(
      await handleQuickQuestion(request({ body: bad }), deps),
      400,
      invalid,
    );
  assert.equal(asked.length, 0);
});

test("a good question streams the answer of the untrimmed text", async () => {
  const { deps, asked } = fakeAsker();
  const req = request();
  const response = await handleQuickQuestion(req, deps);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/x-ndjson; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    await response.text(),
    '{"type":"delta","text":"你"}\n{"type":"done"}\n',
  );
  assert.equal(asked.length, 1);
  assert.equal(asked[0].text, " 你好 ");
  assert.equal(asked[0].signal, req.signal);
});

test("an answer failing before any text is 502", async () => {
  const { deps } = fakeAsker(async function* () {
    throw new Error("OPENAI_TIMEOUT");
  });
  await expectJson(await handleQuickQuestion(request(), deps), 502, {
    error: {
      code: "chat_failed",
      message: "ChatGPTから応答を受信できませんでした。",
    },
  });
});
