import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubIdFromAccount,
  githubIdFromToken,
  passwordOwnerId,
} from "../src/infrastructure/auth/github-identity";

test("the GitHub id comes from the provider account, not the random sub", () => {
  // Auth.js sets token.sub to crypto.randomUUID() for OAuth sign-ins.
  assert.equal(
    githubIdFromAccount({ provider: "github", providerAccountId: "583231" }),
    "583231",
  );
  assert.equal(
    githubIdFromAccount({ provider: "guest", providerAccountId: "guest" }),
    undefined,
  );
  assert.equal(
    githubIdFromAccount({ provider: "github", providerAccountId: "abc" }),
    undefined,
  );
  assert.equal(githubIdFromAccount(null), undefined);
  assert.equal(githubIdFromAccount(undefined), undefined);
});

test("only a numeric GitHub id claim is trusted from the token", () => {
  assert.equal(githubIdFromToken("583231"), "583231");
  assert.equal(
    githubIdFromToken("1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
    undefined,
  );
  assert.equal(githubIdFromToken(583231), undefined);
  assert.equal(githubIdFromToken(undefined), undefined);
  assert.equal(githubIdFromToken(""), undefined);
});

test("a password owner id claim is trusted only in its exact shape", () => {
  const ownerId = "password:ckabcdefghijklmnopqrstuvw";
  assert.equal(githubIdFromToken(ownerId), ownerId);
  assert.equal(githubIdFromToken("password:"), undefined);
  assert.equal(githubIdFromToken("password:../x"), undefined);
  assert.equal(
    githubIdFromToken("password:CKABCDEFGHIJKLMNOPQRSTUVW"),
    undefined,
  );
  assert.equal(githubIdFromToken("password:abc"), undefined);
  assert.equal(githubIdFromToken(`password:${"a".repeat(33)}`), undefined);
  assert.equal(githubIdFromToken(`${ownerId}\n`), undefined);
});

test("the password owner id is derived from a well-formed account id", () => {
  assert.equal(
    passwordOwnerId("ckabcdefghijklmnopqrstuvw"),
    "password:ckabcdefghijklmnopqrstuvw",
  );
  assert.equal(passwordOwnerId(""), undefined);
  assert.equal(passwordOwnerId("../x"), undefined);
  assert.equal(passwordOwnerId("CKABCDEFGHIJKLMNOPQRSTUVW"), undefined);
  assert.equal(passwordOwnerId("abc"), undefined);
  assert.equal(passwordOwnerId("a".repeat(33)), undefined);
  assert.equal(passwordOwnerId(undefined), undefined);
  assert.equal(passwordOwnerId(12345678901234567890), undefined);
});
