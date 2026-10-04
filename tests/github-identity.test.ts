import assert from "node:assert/strict";
import { test } from "node:test";
import {
  githubIdFromAccount,
  githubIdFromToken,
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
