import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  generatePassword,
  hashWithSalt,
  SCRYPT_PARAMS,
  ScryptPasswordHasher,
} from "../src/infrastructure/security/scrypt-password-hasher";

// Written by Go (services/api/auth/password_golden_test.go), which verifies
// the web's hashes at sign-in.
type Golden = {
  params: typeof SCRYPT_PARAMS;
  hashes: { name: string; password: string; salt: string; hash: string }[];
  verify: { name: string; password: string; hash: string; match: boolean }[];
};

const golden: Golden = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "scrypt-golden.json"),
    "utf8",
  ),
);

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

test("hashes and verifies exactly as Go does (golden file)", async () => {
  assert.deepEqual(golden.params, SCRYPT_PARAMS);
  for (const { name, password, salt, hash } of golden.hashes) {
    assert.equal(
      await hashWithSalt(password, Buffer.from(salt, "base64url")),
      hash,
      name,
    );
    assert.equal(await hasher.verify(password, hash), true, name);
  }
  for (const { name, password, hash, match } of golden.verify) {
    assert.equal(await hasher.verify(password, hash), match, name);
  }
});

test("generatePassword is 20 base64url characters", () => {
  const first = generatePassword();
  assert.match(first, /^[A-Za-z0-9_-]{20}$/);
  assert.notEqual(generatePassword(), first);
});

test("simulate costs one scrypt and never throws", async () => {
  assert.equal(await hasher.simulate("x"), undefined);
  assert.equal(await hasher.simulate(""), undefined);
});
