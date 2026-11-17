import assert from "node:assert/strict";
import { test } from "node:test";

import { ScryptPasswordHasher } from "../src/infrastructure/security/scrypt-password-hasher";

// Every page imports the sign-in container (through current-user), so a
// cold start must not pay a scrypt: the sign-in page warms it instead.
test("importing the sign-in wiring never warms; warmSignIn does", async () => {
  let warms = 0;
  ScryptPasswordHasher.prototype.warm = async () => {
    warms += 1;
  };
  const container = await import("../src/composition/sign-in-container");
  await import("../src/composition/current-user");
  assert.equal(warms, 0);
  await container.warmSignIn();
  assert.equal(warms, 1);
});
