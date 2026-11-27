import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test, type TestContext } from "node:test";

import type { SignInResult } from "../src/application/identity/sign-in";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { parseSidOAuthCookie } from "../src/infrastructure/auth/sid-oauth";
import { parseOAuthCookie } from "../src/infrastructure/auth/github-oauth";
import {
  installNextStubs,
  next,
  redirectOf,
  stubSource,
  writtenCookies,
} from "./helpers/next-stubs";

// Signing in, signing out and acting as a member, as the Server Actions run
// them (composition/identity-container): which cookies are written, where a
// failure goes, and who may act as someone. The sign-in rules themselves are
// in session.test.ts and the stores' tests; the OAuth callbacks in
// github-oauth.test.ts and sid-oauth.test.ts.

installNextStubs();

const admin: AuthenticatedUser = {
  userId: "10001",
  role: "admin",
  displayName: "admin",
};
const member: AuthenticatedUser = {
  userId: "c1abcdefghijklmnopqrstu",
  role: "member",
  displayName: "taro",
  username: "taro",
};
const guest: AuthenticatedUser = {
  userId: "g1",
  role: "guest",
  displayName: "guest",
};

// Who the request's session says is signed in.
let user: AuthenticatedUser | null = null;
stubSource("composition/current-user", {
  getCachedCurrentUser: async () => user,
});

const container = () => import("../src/composition/sign-in-container");
const identity = () => import("../src/composition/identity-container");

const session = { token: "new-token", maxAgeSeconds: 2_592_000 };
const signedIn: SignInResult = { ok: true, session };
const MONTH = 2_592_000;
// A new sign-in writes the token and clears zl_act_as, zl_access, zl_refresh.
const newSessionCookies = [
  ["zl_session", "new-token", MONTH],
  ["zl_act_as", "", 0],
  ["zl_access", "", 0],
  ["zl_refresh", "", 0],
];
const clearedCookies = [
  ["zl_session", "", 0],
  ["zl_act_as", "", 0],
  ["zl_access", "", 0],
  ["zl_refresh", "", 0],
];

// The PKCE verifier as zl_oauth stores it (base64url JSON), and the S256
// challenge RFC 7636 makes of it: BASE64URL(SHA256(verifier)), worked out
// here rather than with the code under test.
function storedVerifier(cookieValue: string): string {
  const stored: unknown = JSON.parse(
    Buffer.from(cookieValue, "base64url").toString("utf8"),
  );
  const { verifier } = stored as { verifier?: unknown };
  assert.equal(typeof verifier, "string");
  return verifier as string;
}
function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const ENV = [
  "AUTH_URL",
  "AUTH_GITHUB_ID",
  "GITHUB_WEB_CLIENT_SECRET",
  "SID_ISSUER",
  "SID_CLIENT_ID",
  "SID_CLIENT_SECRET",
] as const;
const savedEnv = new Map(ENV.map((name) => [name, process.env[name]]));

// The sign-in calls and ended sessions of one test. The container's real
// objects are patched in place (as sign-in-container.test.ts does), so the
// real newSessionCookies runs.
let ended: string[] = [];
let restore: (() => void)[] = [];
async function stubSignIn(
  results: Partial<
    Record<"withPassword" | "asGuest" | "asDemo", () => SignInResult>
  >,
) {
  const { signIn, sessionStore } = await container();
  const calls: unknown[][] = [];
  for (const [name, result] of Object.entries(results)) {
    const method = name as keyof typeof results;
    const real = signIn[method];
    signIn[method] = (async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return result();
    }) as never;
    restore.push(() => {
      signIn[method] = real as never;
    });
  }
  const realEnd = sessionStore.end;
  sessionStore.end = async (token) => void ended.push(token);
  restore.push(() => {
    sessionStore.end = realEnd;
  });
  return calls;
}

function captureLogs(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logged.push(["error", ...args]),
  );
  t.mock.method(console, "warn", (...args: unknown[]) =>
    logged.push(["warn", ...args]),
  );
  return logged;
}

beforeEach(() => {
  next.reset();
  next.headers = new Headers({
    "x-forwarded-for": "203.0.113.7",
    host: "zhuelog.example",
  });
  for (const name of ENV) delete process.env[name];
  user = null;
  ended = [];
});
afterEach(() => {
  // Newest first: a test may stub the same call more than once.
  for (const undo of restore.reverse()) undo();
  restore = [];
  for (const [name, value] of savedEnv)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
});

test("a password sign-in ends the browser's previous session, writes the new cookies and goes on", async () => {
  const calls = await stubSignIn({ withPassword: () => signedIn });
  const { signInWithPassword } = await identity();
  next.cookies.set("zl_session", "old-token");

  const redirect = await redirectOf(() =>
    signInWithPassword({
      loginId: "taro",
      password: "member-password-1",
      redirectTo: "/logs/2026/9/24?view=all",
    }),
  );

  assert.equal(redirect.to, "/logs/2026/9/24?view=all");
  // Throttled by the client's address, read from the request.
  assert.deepEqual(calls, [
    [
      "withPassword",
      { loginId: "taro", password: "member-password-1" },
      "203.0.113.7",
    ],
  ]);
  assert.deepEqual(ended, ["old-token"]);
  assert.deepEqual(writtenCookies(), newSessionCookies);
  for (const cookie of next.written)
    assert.deepEqual(cookie.options, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: cookie.options.maxAge,
    });
});

test("the session cookies are Secure behind HTTPS", async () => {
  await stubSignIn({ withPassword: () => signedIn, asGuest: () => signedIn });
  const { signInWithPassword, signInAsGuest, signOutTo } = await identity();
  next.headers.set("x-forwarded-proto", "https");

  await redirectOf(() =>
    signInWithPassword({ loginId: "taro", password: "x", redirectTo: "/" }),
  );
  await redirectOf(() => signInAsGuest("/"));
  await redirectOf(() => signOutTo("/signin"));

  assert.equal(next.written.length, 12);
  for (const cookie of next.written)
    assert.equal(cookie.options.secure, true, cookie.name);
});

test("a refused password sign-in writes no cookie and goes back with the one message", async () => {
  const { signInWithPassword } = await identity();
  next.cookies.set("zl_session", "old-token");

  for (const reason of ["invalid", "throttled"] as const) {
    await stubSignIn({ withPassword: () => ({ ok: false, reason }) });
    const redirect = await redirectOf(() =>
      signInWithPassword({
        loginId: "taro",
        password: "wrong-password-1",
        redirectTo: "/logs",
      }),
    );
    // Neither the reason nor what was typed is in the URL.
    assert.equal(
      redirect.to,
      "/signin?error=CredentialsSignin&callbackUrl=%2Flogs",
    );
  }
  // The session the browser already had is left alone.
  assert.deepEqual(ended, []);
  assert.deepEqual(writtenCookies(), []);
});

test("a store failure during a password sign-in is thrown, with no cookie written", async () => {
  await stubSignIn({
    withPassword: () => {
      throw new TypeError("db down");
    },
  });
  const { signInWithPassword } = await identity();

  await assert.rejects(
    signInWithPassword({ loginId: "taro", password: "x", redirectTo: "/" }),
    TypeError,
  );
  assert.deepEqual(writtenCookies(), []);
});

test("a guest signs in with a new session; a refusal or a failure shows the generic message", async (t) => {
  const logged = captureLogs(t);
  const { signInAsGuest } = await identity();
  const failed = "/signin?error=Unknown&callbackUrl=%2Fpractice";

  const calls = await stubSignIn({ asGuest: () => signedIn });
  assert.equal(
    (await redirectOf(() => signInAsGuest("/practice"))).to,
    "/practice",
  );
  assert.deepEqual(calls, [["asGuest", "203.0.113.7"]]);
  assert.deepEqual(writtenCookies(), newSessionCookies);
  assert.deepEqual(logged, []);

  next.written.length = 0;
  await stubSignIn({ asGuest: () => ({ ok: false, reason: "throttled" }) });
  assert.equal((await redirectOf(() => signInAsGuest("/practice"))).to, failed);
  await stubSignIn({
    asGuest: () => {
      throw new TypeError("db down 203.0.113.7");
    },
  });
  assert.equal((await redirectOf(() => signInAsGuest("/practice"))).to, failed);
  assert.deepEqual(writtenCookies(), []);
  // The error's name only, never its message.
  assert.deepEqual(logged, [
    ["warn", "SIGN_IN_GUEST_REFUSED", "throttled"],
    ["error", "SIGN_IN_GUEST_FAILED", "TypeError"],
  ]);
});

test("the demo signs in like a guest, and says so when it is off", async (t) => {
  const logged = captureLogs(t);
  const { signInAsDemo } = await identity();
  const to = async (result: () => SignInResult) => {
    await stubSignIn({ asDemo: result });
    return (await redirectOf(() => signInAsDemo("/"))).to;
  };

  assert.equal(await to(() => signedIn), "/");
  assert.deepEqual(writtenCookies(), newSessionCookies);

  next.written.length = 0;
  assert.equal(
    await to(() => ({ ok: false, reason: "demo-unavailable" })),
    "/signin?error=DemoUnavailable&callbackUrl=%2F",
  );
  assert.equal(
    await to(() => ({ ok: false, reason: "throttled" })),
    "/signin?error=Unknown&callbackUrl=%2F",
  );
  assert.equal(
    await to(() => {
      throw new RangeError("boom");
    }),
    "/signin?error=Unknown&callbackUrl=%2F",
  );
  assert.deepEqual(writtenCookies(), []);
  assert.deepEqual(logged, [
    ["warn", "SIGN_IN_DEMO_REFUSED", "demo-unavailable"],
    ["warn", "SIGN_IN_DEMO_REFUSED", "throttled"],
    ["error", "SIGN_IN_DEMO_FAILED", "RangeError"],
  ]);
});

test("GitHub sign-in keeps state and PKCE in zl_oauth and sends the browser to GitHub", async () => {
  const { signInWithGitHub } = await identity();

  // Without the OAuth App there is nothing to start.
  assert.equal(
    (await redirectOf(() => signInWithGitHub("/logs"))).to,
    "/signin?error=Configuration",
  );
  assert.deepEqual(writtenCookies(), []);

  process.env.AUTH_GITHUB_ID = "github-client";
  process.env.GITHUB_WEB_CLIENT_SECRET = "github-secret";
  const url = new URL((await redirectOf(() => signInWithGitHub("/logs"))).to);

  assert.equal(next.written.length, 1);
  const [cookie] = next.written;
  assert.equal(cookie!.name, "zl_oauth");
  assert.deepEqual(cookie!.options, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    maxAge: 600,
  });
  const saved = parseOAuthCookie(cookie!.value);
  const verifier = storedVerifier(cookie!.value);
  assert.equal(saved?.callbackPath, "/logs");
  assert.equal(saved?.verifier, verifier);
  assert.equal(
    url.origin + url.pathname,
    "https://github.com/login/oauth/authorize",
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "github-client",
    // The request's own origin, as the callback will build it again.
    redirect_uri: "http://zhuelog.example/api/auth/callback/github/go",
    scope: "read:user",
    state: saved!.state,
    code_challenge: s256Challenge(verifier),
    code_challenge_method: "S256",
  });
  // The secret and the verifier stay on the server.
  assert.doesNotMatch(url.href, /github-secret/);
  assert.ok(!url.href.includes(verifier));

  // AUTH_URL names the public origin and makes the cookie Secure.
  process.env.AUTH_URL = "https://zhuelog.app/ignored";
  next.written.length = 0;
  const publicUrl = new URL((await redirectOf(() => signInWithGitHub("/"))).to);
  assert.equal(
    publicUrl.searchParams.get("redirect_uri"),
    "https://zhuelog.app/api/auth/callback/github/go",
  );
  assert.equal(next.written[0]!.options.secure, true);
});

test("Sparklingstadt ID sign-in keeps state, PKCE and the nonce in zl_oauth and sends the browser to the portal", async () => {
  const { signInWithSid } = await identity();

  assert.equal(
    (await redirectOf(() => signInWithSid("/logs"))).to,
    "/signin?error=Configuration",
  );
  assert.deepEqual(writtenCookies(), []);

  process.env.SID_ISSUER = "https://id.sid.example/";
  process.env.SID_CLIENT_ID = "sid-client";
  process.env.SID_CLIENT_SECRET = "sid-secret";
  const url = new URL((await redirectOf(() => signInWithSid("/logs"))).to);

  assert.deepEqual(
    writtenCookies().map(([name, , maxAge]) => [name, maxAge]),
    [["zl_oauth", 600]],
  );
  const saved = parseSidOAuthCookie(next.written[0]!.value);
  const verifier = storedVerifier(next.written[0]!.value);
  assert.equal(saved?.callbackPath, "/logs");
  assert.equal(saved?.verifier, verifier);
  // A GitHub callback never finishes a Sparklingstadt ID start.
  assert.equal(parseOAuthCookie(next.written[0]!.value), null);
  assert.equal(url.origin, "https://id.sid.example");
  assert.equal(url.searchParams.get("client_id"), "sid-client");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://zhuelog.example/api/auth/callback/sid",
  );
  assert.equal(url.searchParams.get("state"), saved!.state);
  assert.equal(url.searchParams.get("nonce"), saved!.nonce);
  assert.equal(url.searchParams.get("code_challenge"), s256Challenge(verifier));
  assert.doesNotMatch(url.href, /sid-secret/);
  assert.ok(!url.href.includes(verifier));
});

test("signing out ends the session row and clears every session cookie", async () => {
  await stubSignIn({});
  const { signOutCurrentUser, signOutTo } = await identity();
  next.cookies.set("zl_session", "old-token");

  assert.equal((await redirectOf(() => signOutCurrentUser())).to, "/signin");
  assert.deepEqual(ended, ["old-token"]);
  // Acting as a member ends with the session.
  assert.deepEqual(writtenCookies(), clearedCookies);

  // Without a session there is no row to end; the cookies are cleared anyway.
  next.reset();
  ended = [];
  assert.equal(
    (await redirectOf(() => signOutTo("/signin?notice=password-changed"))).to,
    "/signin?notice=password-changed",
  );
  assert.deepEqual(ended, []);
  assert.deepEqual(writtenCookies(), clearedCookies);
});

test("signing out still clears the cookies when the database cannot be reached", async (t) => {
  const logged = captureLogs(t);
  const { sessionStore } = await container();
  const realEnd = sessionStore.end;
  sessionStore.end = async () => {
    throw new TypeError("db down old-token");
  };
  restore.push(() => {
    sessionStore.end = realEnd;
  });
  const { signOutTo } = await identity();
  next.cookies.set("zl_session", "old-token");

  assert.equal((await redirectOf(() => signOutTo("/signin"))).to, "/signin");
  assert.deepEqual(writtenCookies(), clearedCookies);
  assert.deepEqual(logged, [["error", "SESSION_END_FAILED", "TypeError"]]);
});

test("stopping acting clears the retired act-as cookie", async () => {
  const { stopActing } = await identity();
  await stopActing();
  assert.deepEqual(writtenCookies(), [["zl_act_as", "", 0]]);
});

test("the getters answer by role, and no session is nobody", async () => {
  const {
    getCurrentAdminUser,
    getCurrentMemberUser,
    getCurrentViewerUser,
    getRecordOwner,
  } = await identity();
  const who = async () => [
    await getCurrentAdminUser(),
    await getCurrentMemberUser(),
    await getCurrentViewerUser(),
  ];

  user = admin;
  assert.deepEqual(await who(), [admin, admin, admin]);
  user = member;
  assert.deepEqual(await who(), [null, member, member]);
  user = guest;
  assert.deepEqual(await who(), [null, null, guest]);
  for (const nobody of [null]) {
    user = nobody;
    assert.deepEqual(await who(), [null, null, null]);
    assert.deepEqual(await getRecordOwner(undefined), {
      user: null,
      owner: { kind: "denied", reason: "unauthenticated" },
    });
  }

  user = admin;
  assert.deepEqual(await getRecordOwner(member.userId), {
    user: admin,
    owner: { kind: "other", ownerId: member.userId },
  });
});
