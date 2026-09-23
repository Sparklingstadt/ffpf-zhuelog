import assert from "node:assert/strict";
import { test } from "node:test";
import { CorrectPersonalText } from "../src/application/practice/use-cases/correct-personal-text";
import {
  correctionErrors,
  PersonalCorrectionError,
} from "../src/domain/practice/personal-correction";
import { OpenAiPersonalCorrectionGateway } from "../src/infrastructure/practice/openai-personal-correction-gateway";
import { PersonalRequestLimiter } from "../src/infrastructure/practice/personal-request-limiter";
import {
  clearPracticeHistory,
  PRACTICE_HISTORY_KEY,
  readPracticeHistory,
  writePracticeHistory,
} from "../src/infrastructure/practice/browser-practice-history";
import { handlePersonalCorrection } from "../src/presentation/controllers/personal-correction-controller";

const key = "sk-test-only-never-a-real-key-123456";
const input = { apiKey: key, originalText: "今天我很busy。", consent: true };
const correction = {
  correctedText: "今天我很忙。",
  pinyin: "Jīntiān wǒ hěn máng.",
  hints: ["忙=忙しい"],
};
const upstream = (value: unknown = correction) =>
  Response.json({
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
const request = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/corrections", {
    method: "POST",
    headers: {
      origin: "https://example.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const signal = () => new AbortController().signal;

test("BYOK calls only OpenAI with the supplied key, fixed model and no storage/retry", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "owner-key-must-not-be-used";
  let calls = 0;
  try {
    const gateway = new OpenAiPersonalCorrectionGateway(
      async (url, options) => {
        calls++;
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(
          new Headers(options?.headers).get("authorization"),
          `Bearer ${key}`,
        );
        assert.equal(options?.redirect, "error");
        assert.equal(options?.cache, "no-store");
        const body = JSON.parse(String(options?.body));
        assert.equal(body.model, "gpt-5-mini");
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 4000);
        assert.equal(body.input, input.originalText);
        assert.equal(body.text.format.strict, true);
        assert.equal(body.tools, undefined);
        assert.equal(body.previous_response_id, undefined);
        assert.ok(!String(options?.body).includes(key));
        return upstream();
      },
    );
    const result = await new CorrectPersonalText(gateway).execute(
      input,
      signal(),
    );
    assert.deepEqual(result, {
      originalText: input.originalText,
      ...correction,
    });
    assert.equal(calls, 1);
    for (const bad of [
      { ...input, apiKey: "" },
      { ...input, apiKey: undefined },
      { ...input, consent: false },
      { ...input, originalText: "x".repeat(501) },
      { ...input, originalText: key },
      { ...input, model: "gpt-6" },
      { ...input, originalText: " " },
      { ...input, apiKey: `${key}\r\nheader: injection` },
    ])
      await assert.rejects(
        new CorrectPersonalText(gateway).execute(bad, signal()),
        { code: "invalid" },
      );
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("provider errors and malformed/refused/incomplete results never expose secrets or retry", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const gateway = new OpenAiPersonalCorrectionGateway(async () => {
      calls++;
      return Response.json({ error: { message: `SECRET ${key}` } }, { status });
    });
    const code =
      status === 401 || status === 403
        ? "key"
        : status === 429
          ? "limited"
          : "unavailable";
    await assert.rejects(
      gateway.correct(input.originalText, key, signal()),
      (error: unknown) => {
        assert.ok(error instanceof PersonalCorrectionError);
        assert.equal(error.code, code);
        assert.equal(error.message, correctionErrors[code]);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  for (const response of [
    upstream({ ...correction, hints: [] }),
    upstream({ ...correction, extra: key }),
    upstream({ ...correction, correctedText: key }),
    Response.json({ status: "incomplete", output: [] }),
    Response.json({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: key }] },
      ],
    }),
    new Response("not-json"),
  ]) {
    await assert.rejects(
      new OpenAiPersonalCorrectionGateway(async () => response).correct(
        input.originalText,
        key,
        signal(),
      ),
      { code: "unavailable" },
    );
  }
});

test("controller, use case and isolated OpenAI adapter return only the correction fields", async () => {
  const gateway = new OpenAiPersonalCorrectionGateway(async () => upstream());
  const response = await handlePersonalCorrection(request(), {
    isAuthenticated: async () => true,
    correctText: new CorrectPersonalText(gateway),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    originalText: input.originalText,
    ...correction,
  });
});

test("timeouts and cancellation release the in-memory concurrency lock", async () => {
  const limiter = new PersonalRequestLimiter();
  const gateway = new OpenAiPersonalCorrectionGateway(
    async (_url, options) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        const abort = () => {
          clearTimeout(timer);
          reject(new Error(key));
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener("abort", abort, { once: true });
      });
      return upstream();
    },
    limiter,
    5,
  );
  await assert.rejects(gateway.correct(input.originalText, key, signal()), {
    code: "timeout",
  });
  const release = limiter.acquire(key);
  release();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    gateway.correct(input.originalText, key, aborted.signal),
    { code: "timeout" },
  );
});

test("limiter bounds per-key concurrency, per-minute calls, and total concurrency", () => {
  const limiter = new PersonalRequestLimiter();
  const release = limiter.acquire(key, 1);
  assert.throws(() => limiter.acquire(key, 2), { code: "limited" });
  release();
  release();
  for (let i = 0; i < 9; i++) limiter.acquire(key, 3)();
  assert.throws(() => limiter.acquire(key, 4), { code: "limited" });
  limiter.acquire(key, 60_002)();
  const releases = Array.from({ length: 16 }, (_, i) =>
    limiter.acquire(`key-${i}`, 60_003),
  );
  assert.throws(() => limiter.acquire("extra", 60_003), { code: "limited" });
  releases.forEach((done) => done());
});

test("controller checks authentication, origin, JSON and byte limits before generation", async () => {
  let calls = 0;
  const deps = {
    isAuthenticated: async () => true,
    correctText: {
      execute: async () => {
        calls++;
        return { originalText: input.originalText, ...correction };
      },
    },
  };
  assert.equal(
    (
      await handlePersonalCorrection(request(), {
        ...deps,
        isAuthenticated: async () => false,
      })
    ).status,
    401,
  );
  const rejectedHeaders: Record<string, string>[] = [
    { origin: "https://evil.test" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
    { host: "other.test" },
  ];
  for (const headers of rejectedHeaders) {
    assert.equal(
      (await handlePersonalCorrection(request(input, headers), deps)).status,
      403,
    );
  }
  assert.equal(
    (
      await handlePersonalCorrection(
        request(input, { "content-type": "text/plain" }),
        deps,
      )
    ).status,
    400,
  );
  assert.equal(
    (await handlePersonalCorrection(request("中".repeat(4000)), deps)).status,
    413,
  );
  assert.equal(
    (
      await handlePersonalCorrection(
        request(input, { "content-length": "9999" }),
        deps,
      )
    ).status,
    413,
  );
  assert.equal(calls, 0);
  const result = await handlePersonalCorrection(request(), deps);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.equal(calls, 1);
  const failure = await handlePersonalCorrection(request(), {
    ...deps,
    correctText: {
      execute: async () => {
        throw new Error(key);
      },
    },
  });
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes(key));
});

test("browser history validates, caps and excludes credentials; corruption/storage errors are visible to the caller", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
  const record = {
    ...correction,
    originalText: input.originalText,
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date().toISOString(),
  };
  writePracticeHistory(storage, [record]);
  assert.deepEqual(readPracticeHistory(storage), [record]);
  assert.ok(!values.get(PRACTICE_HISTORY_KEY)!.includes(key));
  assert.throws(() =>
    writePracticeHistory(storage, [
      { ...record, apiKey: key } as typeof record,
    ]),
  );
  assert.throws(() => writePracticeHistory(storage, Array(101).fill(record)));
  storage.setItem(PRACTICE_HISTORY_KEY, "broken-json");
  assert.throws(() => readPracticeHistory(storage));
  clearPracticeHistory(storage);
  assert.deepEqual(readPracticeHistory(storage), []);
  assert.throws(() =>
    writePracticeHistory(
      {
        ...storage,
        setItem: () => {
          throw new Error("quota");
        },
      },
      [record],
    ),
  );
});
