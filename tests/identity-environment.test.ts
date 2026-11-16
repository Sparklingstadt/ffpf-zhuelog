import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  allowedGitHubIds,
  demoLoginId,
  runtimeDatabaseUrl,
} from "../src/infrastructure/config/environment";

const saved = {
  ids: process.env.AUTH_ALLOWED_GITHUB_IDS,
  demo: process.env.DEMO_LOGIN_ID,
  url: process.env.DATABASE_URL,
  pooled: process.env.DATABASE_POOLED_URL,
};

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("AUTH_ALLOWED_GITHUB_IDS", saved.ids);
  restore("DEMO_LOGIN_ID", saved.demo);
  restore("DATABASE_URL", saved.url);
  restore("DATABASE_POOLED_URL", saved.pooled);
});

test("runtimeDatabaseUrl prefers the pooled URL", () => {
  process.env.DATABASE_URL = "postgresql://direct.example/db";
  process.env.DATABASE_POOLED_URL = " postgresql://pooler.example/db ";
  assert.equal(runtimeDatabaseUrl(), "postgresql://pooler.example/db");
});

test("runtimeDatabaseUrl falls back to DATABASE_URL", () => {
  process.env.DATABASE_URL = "postgresql://direct.example/db";
  process.env.DATABASE_POOLED_URL = "  ";
  assert.equal(runtimeDatabaseUrl(), "postgresql://direct.example/db");
  delete process.env.DATABASE_POOLED_URL;
  assert.equal(runtimeDatabaseUrl(), "postgresql://direct.example/db");
});

test("runtimeDatabaseUrl is undefined when neither is set", () => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_POOLED_URL;
  assert.equal(runtimeDatabaseUrl(), undefined);
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
