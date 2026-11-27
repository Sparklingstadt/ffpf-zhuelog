import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  cronSecret,
  demoConfig,
  demoLoginId,
  sidConfig,
  lineConfig,
} from "../src/infrastructure/config/environment";

const saved = {
  demo: process.env.DEMO_LOGIN_ID,
  demoPassword: process.env.DEMO_PASSWORD,
};

const LINE_KEYS = [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_API_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_BASE_URL",
  "CRON_SECRET",
  "SID_ISSUER",
  "SID_CLIENT_ID",
  "SID_CLIENT_SECRET",
  "FFPF_ID_ISSUER",
  "FFPF_ID_CLIENT_ID",
  "FFPF_ID_CLIENT_SECRET",
] as const;
const savedLine = Object.fromEntries(
  LINE_KEYS.map((key) => [key, process.env[key]]),
);

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("DEMO_LOGIN_ID", saved.demo);
  restore("DEMO_PASSWORD", saved.demoPassword);
  for (const key of LINE_KEYS) restore(key, savedLine[key]);
});

// The demo needs both: without either the sign-in page has no demo button
// and /api/cron/demo-reset answers 404.
test("demoConfig needs DEMO_LOGIN_ID and DEMO_PASSWORD", () => {
  process.env.DEMO_LOGIN_ID = "demo";
  process.env.DEMO_PASSWORD = " demo-pass ";
  assert.deepEqual(demoConfig(), { loginId: "demo", password: "demo-pass" });
  process.env.DEMO_PASSWORD = " ";
  assert.equal(demoConfig(), undefined);
  delete process.env.DEMO_PASSWORD;
  assert.equal(demoConfig(), undefined);
  process.env.DEMO_PASSWORD = "demo-pass";
  delete process.env.DEMO_LOGIN_ID;
  assert.equal(demoConfig(), undefined);
});

test("demoLoginId is undefined when blank", () => {
  process.env.DEMO_LOGIN_ID = "  ";
  assert.equal(demoLoginId(), undefined);
});

test("demoLoginId is trimmed", () => {
  process.env.DEMO_LOGIN_ID = " demo ";
  assert.equal(demoLoginId(), "demo");
});

test("demoLoginId must already be a login id", () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    for (const id of ["demo", " demo ", "demo.user_1-x"]) {
      process.env.DEMO_LOGIN_ID = id;
      assert.equal(demoLoginId(), id.trim(), id);
    }
    assert.deepEqual(logged, []);
    // Upper case, too short, a space inside, a character not allowed, too long.
    for (const id of ["Demo", "ab", "demo user", "demo!", "d".repeat(33)]) {
      process.env.DEMO_LOGIN_ID = id;
      assert.equal(demoLoginId(), undefined, id);
    }
  } finally {
    console.error = original;
  }
  // Said once, by its code only, never with the value.
  assert.deepEqual(logged, [["DEMO_LOGIN_ID_INVALID"]]);
});

function setLine(values: Partial<Record<(typeof LINE_KEYS)[number], string>>) {
  for (const key of LINE_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

const complete = {
  LINE_CHANNEL_SECRET: " channel-secret ",
  LINE_CHANNEL_ACCESS_TOKEN: "\taccess-token\n",
  OPENAI_API_KEY: "sk-test",
};

test("lineConfig needs both LINE values and OpenAI", () => {
  setLine(complete);
  assert.deepEqual(lineConfig(), {
    channelSecret: "channel-secret",
    accessToken: "access-token",
    apiBaseUrl: "https://api.line.me",
  });

  for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
    setLine({ ...complete, [key]: " " });
    assert.equal(lineConfig(), undefined, `${key} blank`);
    const partial: Partial<typeof complete> = { ...complete };
    delete partial[key];
    setLine(partial);
    assert.equal(lineConfig(), undefined, `${key} missing`);
  }

  // OpenAI with a rejected base URL is not configured, so neither is LINE.
  setLine({ ...complete, OPENAI_API_BASE_URL: "https://example.com" });
  assert.equal(lineConfig(), undefined);
});

test("lineConfig trims Unicode White_Space, not String.prototype.trim's set", () => {
  // White_Space trimming strips U+0085 and keeps U+FEFF; String.prototype.trim
  // does the opposite.
  setLine({ ...complete, LINE_CHANNEL_SECRET: "\u0085secret\u0085" });
  assert.equal(lineConfig()?.channelSecret, "secret");
  setLine({ ...complete, LINE_CHANNEL_ACCESS_TOKEN: "\ufefftoken" });
  assert.equal(lineConfig()?.accessToken, "\ufefftoken");
});

test("LINE_API_BASE_URL is only a loopback URL", () => {
  setLine({ ...complete, LINE_API_BASE_URL: " http://127.0.0.1:3111 " });
  assert.equal(lineConfig()?.apiBaseUrl, "http://127.0.0.1:3111");

  setLine({ ...complete, LINE_API_BASE_URL: "  " });
  assert.equal(lineConfig()?.apiBaseUrl, "https://api.line.me");

  for (const url of [
    "https://example.com",
    "ftp://127.0.0.1",
    "http://user:pass@127.0.0.1:3111",
    "not a url",
  ]) {
    setLine({ ...complete, LINE_API_BASE_URL: url });
    assert.equal(lineConfig(), undefined, url);
  }
});

test("cronSecret is the trimmed CRON_SECRET", () => {
  setLine({ CRON_SECRET: " s " });
  assert.equal(cronSecret(), "s");
  setLine({ CRON_SECRET: "" });
  assert.equal(cronSecret(), undefined);
  setLine({ CRON_SECRET: " \u0085 " });
  assert.equal(cronSecret(), undefined);
  setLine({});
  assert.equal(cronSecret(), undefined);
});

test("sidConfig needs the issuer, the client id and the secret", () => {
  const complete = {
    SID_ISSUER: " https://sid.example/ ",
    SID_CLIENT_ID: " zhuelog ",
    SID_CLIENT_SECRET: " secret ",
  };
  setLine(complete);
  assert.deepEqual(sidConfig(), {
    issuer: "https://sid.example",
    clientId: "zhuelog",
    clientSecret: "secret",
  });
  for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
    setLine({ ...complete, [key]: " " });
    assert.equal(sidConfig(), undefined, `${key} blank`);
  }
  setLine({});
  assert.equal(sidConfig(), undefined);
});

test("sidConfig keeps the https-or-loopback rule for the issuer", () => {
  const rest = { SID_CLIENT_ID: "zhuelog", SID_CLIENT_SECRET: "s" };
  setLine({ ...rest, SID_ISSUER: "http://sid.example" });
  assert.equal(sidConfig(), undefined);
  setLine({ ...rest, SID_ISSUER: "http://127.0.0.1:3110" });
  assert.equal(sidConfig()?.issuer, "http://127.0.0.1:3110");
});

test("sidConfig needs an HTTPS issuer unless its host is localhost or 127.0.0.1", () => {
  const rest = { SID_CLIENT_ID: "zhuelog", SID_CLIENT_SECRET: "s" };
  const cases: [string, boolean][] = [
    ["https://api.test", true],
    ["http://api.test", false],
    ["http://localhost:3108", true],
    ["http://127.0.0.1:3108/", true],
    ["http://localhost.evil.test", false],
    ["http://10.0.0.1:3108", false],
    ["ftp://localhost", false],
    ["not a url", false],
  ];
  for (const [url, want] of cases) {
    setLine({ ...rest, SID_ISSUER: url });
    assert.equal(sidConfig() !== undefined, want, url);
  }
});

test("sidConfig reads SID_*, and the retired FFPF_ID_* alone give nothing", () => {
  setLine({
    SID_ISSUER: "https://id.example/",
    SID_CLIENT_ID: "zhuelog",
    SID_CLIENT_SECRET: "secret",
  });
  assert.deepEqual(sidConfig(), {
    issuer: "https://id.example",
    clientId: "zhuelog",
    clientSecret: "secret",
  });
  setLine({
    FFPF_ID_ISSUER: "https://id.example",
    FFPF_ID_CLIENT_ID: "zhuelog",
    FFPF_ID_CLIENT_SECRET: "secret",
  });
  assert.equal(sidConfig(), undefined);
});
