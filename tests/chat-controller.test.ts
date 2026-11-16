import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AskRefusal,
  Chatter,
} from "../src/application/chat/conversation-notes";
import type { ChatTurn } from "../src/domain/chat/conversation";
import { handleChat } from "../src/presentation/controllers/chat-controller";

const turns: ChatTurn[] = [
  { role: "user", text: " 你好 " },
  { role: "assistant", text: "你好！" },
  { role: "user", text: "谢谢\n" },
];
const body = JSON.stringify({ messages: turns });

function request(
  init: { origin?: string; contentType?: string; body?: string } = {},
) {
  return new Request("http://app.test/api/chat", {
    method: "POST",
    headers: {
      host: "app.test",
      origin: init.origin ?? "http://app.test",
      "content-type": init.contentType ?? "application/json",
    },
    body: init.body ?? body,
  });
}

type ChatterResult =
  { ok: true; asker: Chatter } | { ok: false; reason: AskRefusal };

function fakeChatter(
  answer: (
    turns: readonly ChatTurn[],
    signal: AbortSignal,
  ) => AsyncIterable<string> = async function* () {
    yield "你";
  },
) {
  const asked: { turns: readonly ChatTurn[]; signal: AbortSignal }[] = [];
  const asker: Chatter = {
    ask(sent, signal) {
      asked.push({ turns: sent, signal });
      return answer(sent, signal);
    },
  };
  return {
    asked,
    deps: {
      chatter: async (): Promise<ChatterResult> => ({ ok: true, asker }),
    },
  };
}

function refused(reason: AskRefusal) {
  return {
    chatter: async (): Promise<ChatterResult> => ({ ok: false, reason }),
  };
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

test("a chat from another page is refused before the user is read", async () => {
  let checked = false;
  await expectJson(
    await handleChat(request({ origin: "http://evil.test" }), {
      chatter: async () => {
        checked = true;
        return { ok: false, reason: "forbidden" };
      },
    }),
    403,
    { error: "この画面から送信してください。" },
  );
  assert.equal(checked, false);
});

test("a chat body that is not JSON is 415", async () => {
  await expectJson(
    await handleChat(
      request({ contentType: "text/plain" }),
      refused("signed-out"),
    ),
    415,
    { error: "JSON形式で送信してください。" },
  );
});

test("who may chat is checked before the body", async () => {
  await expectJson(
    await handleChat(request({ body: "x" }), refused("signed-out")),
    401,
    { error: { code: "unauthorized", message: "認証が必要です。" } },
  );
  await expectJson(
    await handleChat(request({ body: "x" }), refused("forbidden")),
    403,
    {
      error: { code: "forbidden", message: "このアカウントは利用できません。" },
    },
  );
  // The demo with a bad body still hears it may not chat.
  await expectJson(
    await handleChat(request({ body: "x" }), refused("demo")),
    403,
    { error: { code: "forbidden", message: "デモでは使えません。" } },
  );
  await expectJson(
    await handleChat(request({ body: "x" }), refused("unavailable")),
    404,
    { error: { code: "not_found", message: "見つかりません。" } },
  );
});

test("a chat body over 256 KiB is 413", async () => {
  const { deps, asked } = fakeChatter();
  await expectJson(
    await handleChat(request({ body: "a".repeat(262_144 + 1) }), deps),
    413,
    { error: "会話が大きすぎます。" },
  );
  assert.equal(asked.length, 0);
});

test("a chat body that cannot be read is 400", async () => {
  const { deps } = fakeChatter();
  const broken = new Request("http://app.test/api/chat", {
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
  await expectJson(await handleChat(broken, deps), 400, {
    error: "リクエストを読み取れませんでした。",
  });
});

test("a chat of the wrong shape is 400", async () => {
  const { deps, asked } = fakeChatter();
  for (const bad of [
    "not json",
    "[]",
    JSON.stringify({ messages: [] }),
    JSON.stringify({ messages: [{ role: "user", text: "   " }] }),
    JSON.stringify({ messages: [{ role: "assistant", text: "你好" }] }),
    JSON.stringify({ messages: [{ role: "user", text: "你好" }], extra: 1 }),
    JSON.stringify({
      messages: [{ role: "user", text: "你好", id: "m1" }],
    }),
    JSON.stringify({ messages: [{ role: "user", text: "好".repeat(40_001) }] }),
  ])
    await expectJson(
      await handleChat(request({ body: bad }), deps),
      400,
      invalid,
    );
  assert.equal(asked.length, 0);
});

test("a good chat streams the answer of the untrimmed turns", async () => {
  const { deps, asked } = fakeChatter();
  const req = request();
  const response = await handleChat(req, deps);
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
  assert.deepEqual(asked[0].turns, turns);
  assert.equal(asked[0].signal, req.signal);
});

test("a chat answer cut at the token limit still ends with done", async () => {
  // streamAnswer with requireComplete: false returns normally on
  // response.incomplete, so the answer simply ends.
  const { deps } = fakeChatter(async function* () {
    yield "你好，";
  });
  const response = await handleChat(request(), deps);
  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    '{"type":"delta","text":"你好，"}\n{"type":"done"}\n',
  );
});

test("a chat answer failing before any text is 502", async () => {
  const { deps } = fakeChatter(async function* () {
    throw new Error("OPENAI_TIMEOUT");
  });
  await expectJson(await handleChat(request(), deps), 502, {
    error: {
      code: "chat_failed",
      message: "ChatGPTから応答を受信できませんでした。",
    },
  });
});
