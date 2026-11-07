import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { siteUrl } from "../src/infrastructure/config/environment";

const saved = {
  AUTH_URL: process.env.AUTH_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
};
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("siteUrl is AUTH_URL's origin, without its path or trailing slash", () => {
  process.env.AUTH_URL = " https://zhuelog.example/api/auth/ ";
  assert.equal(siteUrl(), "https://zhuelog.example");
  process.env.AUTH_URL = "http://localhost:3000/";
  assert.equal(siteUrl(), "http://localhost:3000");
});

test("siteUrl falls back to Vercel's production domain, then localhost", () => {
  delete process.env.AUTH_URL;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "ffpf-zhuelog.vercel.app";
  assert.equal(siteUrl(), "https://ffpf-zhuelog.vercel.app");

  for (const value of ["", "   ", "not a url", "javascript:alert(1)"]) {
    process.env.AUTH_URL = value;
    assert.equal(siteUrl(), "https://ffpf-zhuelog.vercel.app", value);
  }

  delete process.env.AUTH_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  assert.equal(siteUrl(), "http://localhost:3000");
});
