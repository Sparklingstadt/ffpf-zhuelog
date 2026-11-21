import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  installNextStubs,
  next,
  redirectOf,
  writtenCookies,
} from "./helpers/next-stubs";

// The parts of the Go session that read and write cookies and redirect:
// signing in and out, acting as a member, starting OAuth, and the calls made
// as the signed-in user. The URL builders are in go-api-session.test.ts.

installNextStubs();

const session = () => import("../src/infrastructure/go-api/go-api-session");
const authed = () => import("../src/infrastructure/go-api/authed");
const client = () => import("../src/infrastructure/go-api/client");

const realFetch = globalThis.fetch;
const saved = { ...process.env };
let calls: { path: string; init: RequestInit }[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const goError = (status: number, code: string) =>
  json({ error: { code, message: "" } }, status);

// Answers each Go call by its path; a path without an answer is unreachable.
function go(answers: Record<string, () => Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const answer = answers[path];
    if (!answer) throw new TypeError("fetch failed");
    return answer();
  }) as typeof fetch;
}

const header = (call: { init: RequestInit }, name: string) =>
  (call.init.headers as Record<string, string>)[name];
const body = (call: { init: RequestInit }) =>
  JSON.parse(call.init.body as string) as Record<string, unknown>;

const tokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
  refreshExpiresIn: 86_400,
};

beforeEach(() => {
  next.reset();
  next.headers = new Headers({
    host: "zhuelog.test",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "203.0.113.7",
    "x-zhuelog-path": "/logs?view=all",
  });
  process.env.GO_API_URL = "https://api.test";
  process.env.API_WEB_PROXY_SECRET = "s3cret-s3cret-s3cret-s3cret-s3cret";
  delete process.env.AUTH_URL;
  delete process.env.AUTH_GITHUB_ID;
  delete process.env.FFPF_ID_ISSUER;
  delete process.env.FFPF_ID_CLIENT_ID;
  go({});
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...saved };
});

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: true,
  maxAge,
});

test("a password sign-in stores the session, stops acting and goes where it was asked", async () => {
  const { signInWithPasswordViaGo } = await session();
  go({ "/v1/auth/password": () => json(tokens) });
  next.cookies.set("zl_act_as", "password:old");

  const redirect = await redirectOf(() =>
    signInWithPasswordViaGo({
      loginId: "taro",
      password: "member-password-1",
      redirectTo: "/logs",
    }),
  );

  assert.equal(redirect.to, "/logs");
  assert.deepEqual(body(calls[0]!), {
    loginId: "taro",
    password: "member-password-1",
  });
  assert.equal(header(calls[0]!, "X-Zhuelog-Client-IP"), "203.0.113.7");
  assert.deepEqual(next.written, [
    // A minute short of the token's own life.
    { name: "zl_access", value: "access-1", options: cookieOptions(840) },
    { name: "zl_refresh", value: "refresh-1", options: cookieOptions(86_400) },
    { name: "zl_act_as", value: "", options: cookieOptions(0) },
  ]);
});

test("a rejected password goes back to the form without a session", async () => {
  const { signInWithPasswordViaGo } = await session();
  go({ "/v1/auth/password": () => goError(401, "unauthorized") });

  const redirect = await redirectOf(() =>
    signInWithPasswordViaGo({
      loginId: "taro",
      password: "wrong",
      redirectTo: "/logs",
    }),
  );

  assert.equal(
    redirect.to,
    "/signin?error=CredentialsSignin&callbackUrl=%2Flogs",
  );
  assert.deepEqual(next.written, []);
});

test("a password sign-in that fails for another reason is thrown, not shown as a wrong password", async () => {
  const { signInWithPasswordViaGo } = await session();
  const { GoApiError } = await client();
  go({ "/v1/auth/password": () => goError(503, "unavailable") });

  await assert.rejects(
    signInWithPasswordViaGo({
      loginId: "taro",
      password: "member-password-1",
      redirectTo: "/logs",
    }),
    (error) => error instanceof GoApiError && error.status === 503,
  );
  assert.deepEqual(next.written, []);
});

test("guest and demo sign-ins store the session or show their own failure", async () => {
  const { signInAsGuestViaGo, signInAsDemoViaGo } = await session();

  go({ "/v1/auth/guest": () => json(tokens) });
  assert.equal((await redirectOf(() => signInAsGuestViaGo("/"))).to, "/");
  assert.deepEqual(
    next.written.map((cookie) => cookie.name),
    ["zl_access", "zl_refresh", "zl_act_as"],
  );

  next.reset();
  go({ "/v1/auth/guest": () => goError(429, "rate_limited") });
  assert.equal(
    (await redirectOf(() => signInAsGuestViaGo("/logs"))).to,
    "/signin?error=Unknown&callbackUrl=%2Flogs",
  );

  go({ "/v1/auth/demo": () => goError(404, "not_found") });
  assert.equal(
    (await redirectOf(() => signInAsDemoViaGo("/"))).to,
    "/signin?error=DemoUnavailable&callbackUrl=%2F",
  );
  assert.deepEqual(next.written, []);
});

test("signing out clears the cookies even when the Go API cannot be reached", async () => {
  const { signOutViaGo } = await session();
  next.cookies.set("zl_refresh", "refresh-1");
  go({});

  const redirect = await redirectOf(() => signOutViaGo("/signin"));

  assert.equal(redirect.to, "/signin");
  assert.equal(calls[0]!.path, "/v1/auth/logout");
  assert.deepEqual(body(calls[0]!), { refreshToken: "refresh-1" });
  assert.deepEqual(next.written, [
    { name: "zl_access", value: "", options: cookieOptions(0) },
    { name: "zl_refresh", value: "", options: cookieOptions(0) },
    { name: "zl_act_as", value: "", options: cookieOptions(0) },
  ]);
});

test("signing out without a refresh token calls nothing and still clears the cookies", async () => {
  const { signOutViaGo } = await session();

  await redirectOf(() => signOutViaGo("/signin"));

  assert.deepEqual(calls, []);
  assert.equal(next.written.length, 3);
});

test("acting as a member starts only once the Go API confirms it", async () => {
  const { startActingAsViaGo, stopActingViaGo } = await session();
  const { GoApiError } = await client();
  const member = "password:c1";
  const me = (extra: object) => () =>
    json({ ownerId: "10001", role: "admin", login: "admin", ...extra });

  // No session: nothing is asked.
  assert.equal(await startActingAsViaGo(member), false);
  assert.deepEqual(calls, []);

  next.cookies.set("zl_access", "access-1");
  go({ "/v1/me": me({ actingAs: { ownerId: member } }) });
  assert.equal(await startActingAsViaGo(member), true);
  assert.equal(header(calls[0]!, "X-Zhuelog-Act-As"), member);
  assert.deepEqual(next.written, [
    {
      name: "zl_act_as",
      value: member,
      options: cookieOptions(30 * 24 * 60 * 60),
    },
  ]);

  // An older API ignores the header, another member is not the one asked
  // for, and a member's own token is never an admin's.
  for (const answer of [
    me({}),
    me({ actingAs: { ownerId: "password:other" } }),
    () =>
      json({
        ownerId: member,
        role: "member",
        login: "taro",
        actingAs: { ownerId: member },
      }),
    () => goError(403, "forbidden"),
    () => goError(404, "not_found"),
  ]) {
    next.written.length = 0;
    go({ "/v1/me": answer });
    assert.equal(await startActingAsViaGo(member), false);
    assert.deepEqual(next.written, []);
  }

  go({ "/v1/me": () => goError(500, "internal") });
  await assert.rejects(
    startActingAsViaGo(member),
    (error) => error instanceof GoApiError && error.status === 500,
  );

  await stopActingViaGo();
  assert.deepEqual(next.written, [
    { name: "zl_act_as", value: "", options: cookieOptions(0) },
  ]);
});

test("GitHub sign-in keeps PKCE and state in a short cookie and goes to GitHub", async () => {
  const { signInWithGitHubViaGo } = await session();

  // Without a client id the button should not be there; say so, not crash.
  assert.equal(
    (await redirectOf(() => signInWithGitHubViaGo("/logs"))).to,
    "/signin?error=Configuration",
  );
  assert.deepEqual(next.written, []);

  process.env.AUTH_GITHUB_ID = "client-1";
  const to = new URL(
    (await redirectOf(() => signInWithGitHubViaGo("/logs"))).to,
  );
  assert.equal(
    to.origin + to.pathname,
    "https://github.com/login/oauth/authorize",
  );
  assert.equal(to.searchParams.get("client_id"), "client-1");
  assert.equal(
    to.searchParams.get("redirect_uri"),
    "https://zhuelog.test/api/auth/callback/github/go",
  );
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");

  const [cookie, ...others] = writtenCookies();
  assert.ok(cookie);
  assert.deepEqual(others, []);
  assert.equal(cookie.name, "zl_oauth");
  assert.deepEqual(cookie.options, cookieOptions(600));
  const stored = JSON.parse(
    Buffer.from(cookie.value, "base64url").toString("utf8"),
  ) as { state: string; verifier: string; callbackPath: string };
  assert.equal(stored.state, to.searchParams.get("state"));
  assert.equal(stored.callbackPath, "/logs");
  // The verifier stays in the cookie; only its challenge goes to GitHub.
  assert.ok(!to.toString().includes(stored.verifier));
});

test("FFPF ID sign-in needs its configuration and goes to the issuer", async () => {
  const { signInWithFfpfViaGo } = await session();

  assert.equal(
    (await redirectOf(() => signInWithFfpfViaGo("/"))).to,
    "/signin?error=Configuration",
  );

  process.env.FFPF_ID_ISSUER = "https://id.test/";
  process.env.FFPF_ID_CLIENT_ID = "ffpf-client";
  process.env.AUTH_URL = "https://public.test/ignored";
  const to = new URL((await redirectOf(() => signInWithFfpfViaGo("/"))).to);
  assert.equal(to.origin + to.pathname, "https://id.test/oauth/authorize");
  assert.equal(to.searchParams.get("client_id"), "ffpf-client");
  // AUTH_URL names the public origin, whatever the request's host was.
  assert.equal(
    to.searchParams.get("redirect_uri"),
    "https://public.test/api/auth/callback/ffpf",
  );
  assert.ok(to.searchParams.get("nonce"));
  assert.equal(next.written[0]!.name, "zl_oauth");
});

test("a call without a session goes to sign-in and comes back to the current page", async () => {
  const { goApiAuthed } = await authed();

  const redirect = await redirectOf(() =>
    goApiAuthed("/v1/entries", { method: "GET" }),
  );

  assert.equal(redirect.to, "/signin?callbackUrl=%2Flogs%3Fview%3Dall");
  assert.deepEqual(calls, []);
});

test("a call the Go API answers 401 goes to sign-in; other failures are thrown", async () => {
  const { goApiAuthed } = await authed();
  const { GoApiError } = await client();
  next.cookies.set("zl_access", "expired");

  go({ "/v1/entries": () => goError(401, "unauthorized") });
  assert.equal(
    (await redirectOf(() => goApiAuthed("/v1/entries", { method: "GET" }))).to,
    "/signin?callbackUrl=%2Flogs%3Fview%3Dall",
  );

  go({ "/v1/entries": () => goError(403, "forbidden") });
  await assert.rejects(
    goApiAuthed("/v1/entries", { method: "GET" }),
    (error) => error instanceof GoApiError && error.status === 403,
  );
});

test("calls carry the token, and the member only while the Go API confirms acting", async () => {
  const { goApiAuthed, goUploadAuthed } = await authed();
  const member = "password:c1";
  next.cookies.set("zl_access", "access-1");

  go({ "/v1/entries": () => json({ entries: [] }) });
  assert.deepEqual(await goApiAuthed("/v1/entries", { method: "GET" }), {
    entries: [],
  });
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/v1/entries"],
  );
  assert.equal(header(calls[0]!, "authorization"), "Bearer access-1");
  assert.equal(header(calls[0]!, "X-Zhuelog-Act-As"), undefined);

  // The act-as cookie alone is not enough: /v1/me has to agree.
  next.cookies.set("zl_act_as", member);
  go({
    "/v1/me": () => json({ ownerId: "10001", role: "admin", login: "admin" }),
    "/v1/entries": () => json({ entries: [] }),
  });
  await goApiAuthed("/v1/entries", { method: "GET" });
  assert.equal(header(calls.at(-1)!, "X-Zhuelog-Act-As"), undefined);

  go({
    "/v1/me": () =>
      json({
        ownerId: "10001",
        role: "admin",
        login: "admin",
        actingAs: { ownerId: member },
      }),
    "/v1/entries": () => json({ entries: [] }),
    "/v1/entries/import": () => json({ imported: 1 }),
  });
  await goApiAuthed("/v1/entries", { method: "GET" });
  assert.equal(header(calls.at(-1)!, "X-Zhuelog-Act-As"), member);

  await goUploadAuthed("/v1/entries/import", new FormData());
  const upload = calls.at(-1)!;
  assert.equal(upload.init.method, "POST");
  assert.equal(header(upload, "authorization"), "Bearer access-1");
  assert.equal(header(upload, "X-Zhuelog-Act-As"), member);
});
