import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AUTH_RATE_LIMIT,
  isAllowedUsername,
  memberEmail,
  normalizeUsername,
  rejectsDemoPasswordChange,
  rejectsGuestImpersonation,
  startsSession,
  withoutSessionCookie,
} from "../src/infrastructure/auth/better-auth-rules";
import {
  betterAuthSecret,
  demoPassword,
  sidOAuthConfig,
} from "../src/infrastructure/config/environment";

test("isAllowedUsername follows the login id rule", () => {
  assert.equal(isAllowedUsername("abc"), true);
  assert.equal(isAllowedUsername("a.b-c_d"), true);
  assert.equal(isAllowedUsername("a".repeat(32)), true);
  assert.equal(isAllowedUsername("a".repeat(33)), false);
  assert.equal(isAllowedUsername("ab"), false);
  assert.equal(isAllowedUsername("Abc"), false);
});

test("a typed login id is trimmed and lower-cased before it is checked", () => {
  assert.equal(normalizeUsername("Alice"), "alice");
  assert.equal(normalizeUsername(" alice\t"), "alice");
  assert.equal(normalizeUsername("A.B-C_D"), "a.b-c_d");
  // The pair the username plugin runs (post-normalization validation) is
  // normalizeLoginId: whatever it accepts, they accept.
  for (const typed of ["Alice", " alice ", "ALICE-01", "a".repeat(32)])
    assert.equal(isAllowedUsername(normalizeUsername(typed)), true, typed);
  for (const typed of ["ab", " a b ", "a".repeat(33), "alice!"])
    assert.equal(isAllowedUsername(normalizeUsername(typed)), false, typed);
});

test("the demo may not change its password", () => {
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "demo", "demo"),
    true,
  );
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "alice", "demo"),
    false,
  );
  assert.equal(
    rejectsDemoPasswordChange("/sign-in/username", "demo", "demo"),
    false,
  );
  assert.equal(
    rejectsDemoPasswordChange("/change-password", "demo", undefined),
    false,
  );
});

test("without a session there is no demo to protect", () => {
  assert.equal(
    rejectsDemoPasswordChange("/change-password", undefined, "demo"),
    false,
  );
  assert.equal(
    rejectsDemoPasswordChange("/change-password", null, "demo"),
    false,
  );
});

test("a guest cannot be impersonated", () => {
  assert.equal(
    rejectsGuestImpersonation("/admin/impersonate-user", { isAnonymous: true }),
    true,
  );
  assert.equal(
    rejectsGuestImpersonation("/admin/impersonate-user", {
      isAnonymous: false,
    }),
    false,
  );
  assert.equal(
    rejectsGuestImpersonation("/admin/list-users", { isAnonymous: true }),
    false,
  );
});

test("an unknown impersonation target is left to the admin plugin", () => {
  assert.equal(
    rejectsGuestImpersonation("/admin/impersonate-user", null),
    false,
  );
  assert.equal(rejectsGuestImpersonation("/admin/impersonate-user", {}), false);
});

test("the sign-ins that start a session are told apart", () => {
  for (const path of [
    "/sign-in/username",
    "/sign-in/anonymous",
    "/callback/sid",
  ])
    assert.equal(startsSession(path), true, path);
  for (const path of [
    "/sign-in/social",
    "/sign-out",
    "/get-session",
    "/change-password",
    "/admin/impersonate-user",
  ])
    assert.equal(startsSession(path), false, path);
});

test("withoutSessionCookie drops only Better Auth's session cookies", () => {
  assert.equal(
    withoutSessionCookie(
      "a=1; better-auth.session_token=x.y; better-auth.state=s; __Secure-better-auth.session_token=z; better-auth.session_data=d; b=2",
    ),
    "a=1; better-auth.state=s; b=2",
  );
  assert.equal(withoutSessionCookie("better-auth.session_token=x"), "");
  assert.equal(withoutSessionCookie(""), "");
  assert.equal(withoutSessionCookie(null), "");
  // A cookie whose name only ends with the session cookie's stays.
  assert.equal(
    withoutSessionCookie("my-better-auth.session_token=x"),
    "my-better-auth.session_token=x",
  );
});

test("memberEmail uses the .invalid domain", () => {
  assert.equal(memberEmail("alice"), "alice@members.zhuelog.invalid");
});

test("rate limits match the spec", () => {
  assert.deepEqual(
    {
      window: AUTH_RATE_LIMIT.window,
      max: AUTH_RATE_LIMIT.max,
      storage: AUTH_RATE_LIMIT.storage,
    },
    { window: 60, max: 10, storage: "database" },
  );
  assert.deepEqual(AUTH_RATE_LIMIT.customRules["/sign-in/username"], {
    window: 900,
    max: 20,
  });
  assert.deepEqual(AUTH_RATE_LIMIT.customRules["/change-password"], {
    window: 900,
    max: 5,
  });
});

const ENV_KEYS = [
  "BETTER_AUTH_SECRET",
  "DEMO_PASSWORD",
  "SID_ISSUER",
  "SID_CLIENT_ID",
  "SID_CLIENT_SECRET",
] as const;
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("betterAuthSecret is the trimmed BETTER_AUTH_SECRET and is required", () => {
  process.env.BETTER_AUTH_SECRET = "  s3cret-value \n";
  assert.equal(betterAuthSecret(), "s3cret-value");
  process.env.BETTER_AUTH_SECRET = " 　";
  assert.throws(() => betterAuthSecret(), /BETTER_AUTH_SECRET/);
  delete process.env.BETTER_AUTH_SECRET;
  assert.throws(() => betterAuthSecret(), /BETTER_AUTH_SECRET/);
});

test("demoPassword is the trimmed DEMO_PASSWORD, undefined when blank", () => {
  process.env.DEMO_PASSWORD = " demo-password-1 ";
  assert.equal(demoPassword(), "demo-password-1");
  process.env.DEMO_PASSWORD = " 　";
  assert.equal(demoPassword(), undefined);
  delete process.env.DEMO_PASSWORD;
  assert.equal(demoPassword(), undefined);
});

test("sidOAuthConfig is the SID settings, or null without all three", () => {
  process.env.SID_ISSUER = "https://id.example.test/";
  process.env.SID_CLIENT_ID = "zhuelog";
  process.env.SID_CLIENT_SECRET = "secret";
  assert.deepEqual(sidOAuthConfig(), {
    issuer: "https://id.example.test",
    clientId: "zhuelog",
    clientSecret: "secret",
  });
  delete process.env.SID_CLIENT_SECRET;
  assert.equal(sidOAuthConfig(), null);
});
