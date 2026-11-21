import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  allowedGitHubIds,
  cronSecret,
  demoLoginId,
  lineConfig,
} from "../src/infrastructure/config/environment";

const saved = {
  ids: process.env.AUTH_ALLOWED_GITHUB_IDS,
  demo: process.env.DEMO_LOGIN_ID,
};

const LINE_KEYS = [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_API_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_API_BASE_URL",
  "CRON_SECRET",
] as const;
const savedLine = Object.fromEntries(
  LINE_KEYS.map((key) => [key, process.env[key]]),
);

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("AUTH_ALLOWED_GITHUB_IDS", saved.ids);
  restore("DEMO_LOGIN_ID", saved.demo);
  for (const key of LINE_KEYS) restore(key, savedLine[key]);
});

test("allowedGitHubIds keeps only numeric ids", () => {
  process.env.AUTH_ALLOWED_GITHUB_IDS = " 10001, abc ,2002,,";
  assert.deepEqual([...allowedGitHubIds()].sort(), ["10001", "2002"]);
});

test("allowedGitHubIds is empty when unset", () => {
  delete process.env.AUTH_ALLOWED_GITHUB_IDS;
  assert.equal(allowedGitHubIds().size, 0);
});

test("demoLoginId is undefined when blank", () => {
  process.env.DEMO_LOGIN_ID = "  ";
  assert.equal(demoLoginId(), undefined);
});

test("demoLoginId is trimmed", () => {
  process.env.DEMO_LOGIN_ID = " demo ";
  assert.equal(demoLoginId(), "demo");
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

test("lineConfig trims as Go's strings.TrimSpace does", () => {
  // Go strips U+0085 and keeps U+FEFF; String.prototype.trim does the opposite.
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
