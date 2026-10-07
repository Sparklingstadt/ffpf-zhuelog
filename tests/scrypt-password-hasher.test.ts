import assert from "node:assert/strict";
import { test } from "node:test";
import { ScryptPasswordHasher } from "../src/infrastructure/auth/scrypt-password-hasher";

const hasher = new ScryptPasswordHasher();

test("hash uses the documented format and a fresh salt every time", async () => {
  const first = await hasher.hash("correct horse battery");
  const second = await hasher.hash("correct horse battery");
  assert.match(first, /^scrypt:32768:8:1:[\w-]{22}:[\w-]{86}$/);
  assert.notEqual(first, second);
});

test("verify accepts the right password and rejects a wrong one", async () => {
  const stored = await hasher.hash("correct horse battery");
  assert.equal(await hasher.verify("correct horse battery", stored), true);
  assert.equal(await hasher.verify("wrong horse battery", stored), false);
});

test("verify treats malformed hashes as a mismatch without throwing", async () => {
  for (const bad of [
    "scrypt:1:2",
    "",
    "bcrypt$abc",
    "scrypt:x:8:1:AAAA:BBBB",
    "scrypt:32768:8:1:AAAA:BBBB",
    "scrypt:32768:8:1::",
    "scrypt:0:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAA",
    "scrypt:3:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAA",
  ]) {
    assert.equal(await hasher.verify("anything", bad), false, bad);
  }
});

test("verify refuses stored parameters that would exhaust memory", async () => {
  const stored = await hasher.hash("correct horse battery");
  const [, , r, p, salt, key] = stored.split(":");
  const hostile = `scrypt:${2 ** 24}:${r}:${p}:${salt}:${key}`;
  assert.equal(await hasher.verify("correct horse battery", hostile), false);
});

test("generate returns a 20 character url-safe password", () => {
  const password = hasher.generate();
  assert.match(password, /^[\w-]{20}$/);
  assert.notEqual(password, hasher.generate());
});

test("simulateVerify resolves", async () => {
  await assert.doesNotReject(hasher.simulateVerify("x"));
  await assert.doesNotReject(hasher.simulateVerify("y"));
});

test("simulateVerify retries after the cached dummy hash failed", async () => {
  class FailsOnce extends ScryptPasswordHasher {
    calls = 0;
    override async hash(password: string) {
      this.calls += 1;
      if (this.calls === 1) throw new Error("transient");
      return super.hash(password);
    }
  }
  const flaky = new FailsOnce();
  await assert.rejects(flaky.simulateVerify("x"), /transient/);
  await assert.doesNotReject(flaky.simulateVerify("x"));
  assert.equal(flaky.calls, 2);
});
