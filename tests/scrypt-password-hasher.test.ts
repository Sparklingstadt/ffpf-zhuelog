import assert from "node:assert/strict";
import { test } from "node:test";
import { ScryptPasswordHasher } from "../scripts/lib/scrypt-password-hasher";

// The Go API verifies these hashes (services/api/auth/password.go); Node only
// writes them, for the e2e fixtures and the local seed.
const hasher = new ScryptPasswordHasher();

test("hash uses the documented format and a fresh salt every time", async () => {
  const first = await hasher.hash("correct horse battery");
  const second = await hasher.hash("correct horse battery");
  assert.match(first, /^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/);
  assert.notEqual(first, second);
});
