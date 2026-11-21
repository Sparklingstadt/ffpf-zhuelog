import assert from "node:assert/strict";
import { test } from "node:test";
import { sidLogoutUrl } from "../src/infrastructure/auth/sid-logout";

const config = { issuer: "https://id.example", clientId: "zhuelog" };
const origin = "https://z.example";

test("a Sparklingstadt ID member is sent to the issuer's logout, back to /signin", () => {
  assert.equal(
    sidLogoutUrl({ ownerId: "sid:abc", config, origin }),
    "https://id.example/oauth/logout?client_id=zhuelog&post_logout_redirect_uri=https%3A%2F%2Fz.example%2Fsignin",
  );
});

test("a trailing slash on the issuer does not double up", () => {
  assert.equal(
    sidLogoutUrl({
      ownerId: "sid:abc",
      config: { ...config, issuer: "https://id.example/" },
      origin,
    }),
    "https://id.example/oauth/logout?client_id=zhuelog&post_logout_redirect_uri=https%3A%2F%2Fz.example%2Fsignin",
  );
});

test("everyone else, and no configuration, stay at the web's own sign-out", () => {
  for (const ownerId of [
    "password:abcdefghij0123456789",
    "12345",
    "guest-session-id",
    null,
  ]) {
    assert.equal(
      sidLogoutUrl({ ownerId, config, origin }),
      null,
      String(ownerId),
    );
  }
  assert.equal(
    sidLogoutUrl({ ownerId: "sid:abc", config: null, origin }),
    null,
  );
});
