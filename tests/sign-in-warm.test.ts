import assert from "node:assert/strict";
import { test } from "node:test";

import { ScryptPasswordHasher } from "../src/infrastructure/security/scrypt-password-hasher";

// Importing the sign-in container must not pay a scrypt on a cold start:
// the sign-in page warms it instead.
test("importing the sign-in wiring never warms; warmSignIn does", async () => {
  let warms = 0;
  ScryptPasswordHasher.prototype.warm = async () => {
    warms += 1;
  };
  const container = await import("../src/composition/sign-in-container");
  assert.equal(warms, 0);
  await container.warmSignIn();
  assert.equal(warms, 1);
});
