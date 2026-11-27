import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isSecureRequest } from "../src/infrastructure/auth/secure-request";

const originalAuthUrl = process.env.AUTH_URL;
afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = originalAuthUrl;
});

test("cookies are secure when the request came over HTTPS", () => {
  delete process.env.AUTH_URL;
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "https" })),
    true,
  );
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "https,http" })),
    true,
  );
  assert.equal(
    isSecureRequest(new Headers({ "x-forwarded-proto": "http" })),
    false,
  );
  assert.equal(isSecureRequest(new Headers()), false);
});

test("an https AUTH_URL makes cookies secure", () => {
  process.env.AUTH_URL = "https://example.com";
  assert.equal(isSecureRequest(new Headers()), true);
  process.env.AUTH_URL = "http://localhost:3000";
  assert.equal(isSecureRequest(new Headers()), false);
});
