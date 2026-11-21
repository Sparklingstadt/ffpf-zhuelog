import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSignOutTarget,
  sidLogoutUrl,
} from "../src/infrastructure/auth/sid-logout";

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

const deps = (
  over: Partial<Parameters<typeof resolveSignOutTarget>[0]> = {},
) => ({
  currentOwnerId: async () => "sid:abc" as string | null,
  config: () => config as typeof config | null,
  origin: async () => origin,
  onError: () => {},
  ...over,
});

test("resolveSignOutTarget: a Sparklingstadt ID member goes to the issuer", async () => {
  assert.equal(
    await resolveSignOutTarget(deps()),
    "https://id.example/oauth/logout?client_id=zhuelog&post_logout_redirect_uri=https%3A%2F%2Fz.example%2Fsignin",
  );
});

test("resolveSignOutTarget: an admin (acting as anyone) and a non-member go to /signin", async () => {
  assert.equal(
    await resolveSignOutTarget(deps({ currentOwnerId: async () => "12345" })),
    "/signin",
  );
  assert.equal(
    await resolveSignOutTarget(deps({ currentOwnerId: async () => null })),
    "/signin",
  );
  assert.equal(
    await resolveSignOutTarget(deps({ config: () => null })),
    "/signin",
  );
});

test("resolveSignOutTarget: any failure while deciding still ends at /signin", async () => {
  for (const over of [
    {
      currentOwnerId: async (): Promise<string | null> => {
        throw new Error("database down");
      },
    },
    {
      origin: async (): Promise<string> => {
        throw new Error("no headers");
      },
    },
    {
      config: (): null => {
        throw new Error("bad env");
      },
    },
  ]) {
    const errors: unknown[] = [];
    assert.equal(
      await resolveSignOutTarget(
        deps({ ...over, onError: (e) => errors.push(e) }),
      ),
      "/signin",
    );
    assert.equal(errors.length, 1);
  }
});
