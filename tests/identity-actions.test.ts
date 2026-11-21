import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import { GoApiError } from "../src/infrastructure/go-api/client";
import {
  accountForbiddenMessage,
  accountNotFoundMessage,
} from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";
import {
  installNextStubs,
  next,
  redirectOf,
  stubSource,
  writtenCookies,
} from "./helpers/next-stubs";

// The Server Actions around who is signed in: sign-in and sign-out, acting as
// a member, password accounts and the LINE link. Each checks the role again
// before it calls the Go API.

installNextStubs();

const admin: AuthenticatedUser = {
  githubLogin: "admin",
  githubId: "10001",
  role: "admin",
};
const member: AuthenticatedUser = {
  githubLogin: "taro",
  githubId: "password:c1abcdefghijklmnopqrstu",
  role: "member",
};
const guest: AuthenticatedUser = { githubLogin: "guest", role: "guest" };

// Who is signed in, every call the actions made, and what each call answers.
let user: AuthenticatedUser | null = null;
let calls: unknown[][] = [];
let answers: Record<string, () => unknown> = {};
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return answers[name]?.();
  };

stubSource("composition/identity-container", {
  getCurrentViewerUser: async () => user,
  getCurrentMemberUser: async () =>
    user && user.role !== "guest" ? user : null,
  getCurrentAdminUser: async () => (user?.role === "admin" ? user : null),
  signInWithGitHub: record("signInWithGitHub"),
  signInWithFfpf: record("signInWithFfpf"),
  signInAsGuest: record("signInAsGuest"),
  signInAsDemo: record("signInAsDemo"),
  signInWithPassword: record("signInWithPassword"),
  signOutCurrentUser: record("signOutCurrentUser"),
  startActingAs: record("startActingAs"),
  stopActing: record("stopActing"),
  memberAccounts: {
    createAccount: record("createAccount"),
    resetPassword: record("resetPassword"),
    changeOwnPassword: record("changeOwnPassword"),
    issueLineLinkCode: record("issueLineLinkCode"),
    unlinkLine: record("unlinkLine"),
    setLineReviewNotify: record("setLineReviewNotify"),
  },
});

const auth = () => import("../src/presentation/actions/auth-actions");
const acting = () => import("../src/presentation/actions/acting-actions");
const accounts = () =>
  import("../src/presentation/actions/password-account-actions");
const line = () => import("../src/presentation/actions/line-link-actions");

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const fails =
  (status: number, code: string, message = "") =>
  () => {
    throw new GoApiError(status, code, message);
  };
const idle = { status: "idle" } as const;

beforeEach(() => {
  next.reset();
  next.headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  user = null;
  calls = [];
  answers = {};
});

test("sign-in actions only ever come back to a path of this site", async () => {
  const actions = await auth();

  await actions.signInWithGitHubAction("https://evil.example");
  await actions.signInWithFfpfAction("//evil.example");
  await actions.signInAsGuestAction("/%2fevil.example");
  await actions.signInAsDemoAction("/logs/2026/9/24?view=all");
  await actions.signInWithPasswordAction(
    "/\\evil.example",
    form({ loginId: "taro", password: "member-password-1" }),
  );

  assert.deepEqual(calls, [
    ["signInWithGitHub", "/"],
    ["signInWithFfpf", "/"],
    ["signInAsGuest", "/"],
    ["signInAsDemo", "/logs/2026/9/24?view=all"],
    [
      "signInWithPassword",
      { loginId: "taro", password: "member-password-1", redirectTo: "/" },
    ],
  ]);
});

test("a password form without text fields signs in with empty values, and sign-out is passed on", async () => {
  const actions = await auth();

  await actions.signInWithPasswordAction(
    "/logs",
    form({ loginId: new Blob(["x"]) }),
  );
  await actions.signOutAction();

  assert.deepEqual(calls, [
    ["signInWithPassword", { loginId: "", password: "", redirectTo: "/logs" }],
    ["signOutCurrentUser"],
  ]);
});

test("only an admin starts acting, and only as a member", async () => {
  const { startActingAsAction, stopActingAction } = await acting();
  const target = member.githubId!;

  for (const visitor of [null, guest, member]) {
    user = visitor;
    assert.equal((await redirectOf(() => startActingAsAction(target))).to, "/");
  }
  assert.deepEqual(calls, []);

  // An admin's own id, an FFPF ID account and a made-up path are not
  // password members; the Go API is not even asked.
  user = admin;
  for (const ownerId of ["10001", "ffpf:abc", "password:../x", ""])
    assert.equal(
      (await redirectOf(() => startActingAsAction(ownerId))).to,
      "/admin/accounts?actAs=failed",
    );
  assert.deepEqual(calls, []);

  answers.startActingAs = () => true;
  assert.equal((await redirectOf(() => startActingAsAction(target))).to, "/");
  answers.startActingAs = () => false;
  assert.equal(
    (await redirectOf(() => startActingAsAction(target))).to,
    "/admin/accounts?actAs=failed",
  );
  assert.deepEqual(calls, [
    ["startActingAs", target],
    ["startActingAs", target],
  ]);

  calls = [];
  assert.equal(
    (await redirectOf(() => stopActingAction())).to,
    "/admin/accounts",
  );
  assert.deepEqual(calls, [["stopActing"]]);
});

test("only an admin creates accounts and resets passwords", async () => {
  const actions = await accounts();
  const refused = { status: "error", message: accountForbiddenMessage };
  const fields = form({ loginId: "hana", displayName: "花", password: "" });

  for (const visitor of [null, guest, member]) {
    user = visitor;
    assert.deepEqual(
      await actions.createPasswordAccountAction(idle, fields),
      refused,
    );
    assert.deepEqual(
      await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
      refused,
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(next.revalidated, []);
});

test("a created account comes back with its one-time password and refreshes the list", async () => {
  const { createPasswordAccountAction } = await accounts();
  user = admin;
  answers.createAccount = () => ({
    loginId: "hana",
    password: "generated-password",
    generated: true,
  });

  const state = await createPasswordAccountAction(
    idle,
    form({ loginId: "hana", displayName: "花", password: new Blob(["x"]) }),
  );

  assert.deepEqual(state, {
    status: "success",
    loginId: "hana",
    password: "generated-password",
    generated: true,
  });
  // A field that is not text is sent as empty, never as a file.
  assert.deepEqual(calls, [
    ["createAccount", { loginId: "hana", displayName: "花", password: "" }],
  ]);
  assert.deepEqual(next.revalidated, [["/admin/accounts"]]);
});

test("the one-time password still reaches the admin when the list cannot be refreshed", async (t) => {
  const { createPasswordAccountAction } = await accounts();
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  user = admin;
  answers.createAccount = () => ({
    loginId: "hana",
    password: "generated-password",
    generated: true,
  });
  next.failRevalidate = true;

  const state = await createPasswordAccountAction(
    idle,
    form({ loginId: "hana", displayName: "花", password: "" }),
  );

  assert.equal(state.status, "success");
  // Only the fixed code is logged: the form carries a plaintext password.
  assert.deepEqual(logged, [["PASSWORD_ACCOUNT_REVALIDATE_FAILED"]]);
});

test("account failures show the Go API's own message or the generic one, and refresh nothing", async (t) => {
  const actions = await accounts();
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  user = admin;
  const fields = form({ loginId: "hana", displayName: "花", password: "" });

  answers.createAccount = fails(
    409,
    "login_id_taken",
    "このログインIDは使われています。",
  );
  assert.deepEqual(await actions.createPasswordAccountAction(idle, fields), {
    status: "error",
    message: "このログインIDは使われています。",
  });

  answers.resetPassword = fails(503, "unavailable", "internal detail");
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
    { status: "error", message: genericErrorMessage },
  );
  assert.deepEqual(logged, [
    ["PASSWORD_ACCOUNT_RESET_FAILED", 503, "unavailable"],
  ]);

  // The account was deleted in the meantime.
  answers.resetPassword = () => null;
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
    { status: "error", message: accountNotFoundMessage },
  );
  assert.deepEqual(next.revalidated, []);

  answers.resetPassword = () => ({
    loginId: "hana",
    password: "new-password",
    generated: false,
  });
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction(
      "c1",
      idle,
      form({ password: "new-password" }),
    ),
    {
      status: "success",
      loginId: "hana",
      password: "new-password",
      generated: false,
    },
  );
  assert.deepEqual(calls.at(-1), ["resetPassword", "c1", "new-password"]);
  assert.deepEqual(next.revalidated, [["/admin/accounts"]]);
});

test("only a password member changes their own password, and is then signed out", async () => {
  const { changeOwnPasswordAction } = await accounts();
  const refused = { status: "error", message: accountForbiddenMessage };
  const fields = form({
    currentPassword: "old-password-1",
    newPassword: "new-password-1",
    confirmPassword: "new-password-1",
  });

  // Admins sign in with GitHub and have no password here.
  for (const visitor of [null, guest, admin]) {
    user = visitor;
    assert.deepEqual(await changeOwnPasswordAction(idle, fields), refused);
  }
  assert.deepEqual(calls, []);

  user = member;
  answers.changeOwnPassword = fails(
    400,
    "invalid_current_password",
    "現在のパスワードが違います。",
  );
  assert.deepEqual(await changeOwnPasswordAction(idle, fields), {
    status: "error",
    message: "現在のパスワードが違います。",
  });
  assert.deepEqual(next.written, []);

  answers.changeOwnPassword = () => undefined;
  const redirect = await redirectOf(() =>
    changeOwnPasswordAction(idle, fields),
  );
  assert.equal(redirect.to, "/signin?notice=password-changed");
  assert.deepEqual(calls.at(-1), [
    "changeOwnPassword",
    {
      currentPassword: "old-password-1",
      newPassword: "new-password-1",
      confirmPassword: "new-password-1",
    },
    "203.0.113.7",
  ]);
  // The Go API revoked every session; the cookies go with them.
  assert.deepEqual(
    writtenCookies().map((cookie) => [cookie.name, cookie.value]),
    [
      ["zl_access", ""],
      ["zl_refresh", ""],
      ["zl_act_as", ""],
    ],
  );
});

test("guests have no LINE link to issue, drop or be reminded through", async () => {
  const actions = await line();
  const refused = { status: "error", message: accountForbiddenMessage };

  for (const visitor of [null, guest]) {
    user = visitor;
    assert.deepEqual(await actions.issueLineLinkCodeAction(), refused);
    assert.equal(await actions.unlinkLineAction(), undefined);
    assert.deepEqual(
      await actions.setLineReviewNotifyAction(idle, form({ on: "1" })),
      refused,
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(next.revalidated, []);
});

test("a member issues a LINE link code and unlinks", async (t) => {
  const actions = await line();
  t.mock.method(console, "error", () => {});
  user = member;

  answers.issueLineLinkCode = () => ({
    code: "ABC123",
    expiresAt: new Date("2026-11-21T03:00:00Z"),
  });
  assert.deepEqual(await actions.issueLineLinkCodeAction(), {
    status: "issued",
    code: "ABC123",
    expiresAt: "2026-11-21T03:00:00.000Z",
  });

  answers.issueLineLinkCode = fails(429, "rate_limited");
  assert.deepEqual(await actions.issueLineLinkCodeAction(), {
    status: "error",
    message: genericErrorMessage,
  });

  await actions.unlinkLineAction();
  assert.deepEqual(calls.at(-1), ["unlinkLine"]);
  assert.deepEqual(next.revalidated, [["/account/line"]]);
});

test("the LINE review reminder is on only for on=1, and says so when nothing is linked", async () => {
  const { setLineReviewNotifyAction } = await line();
  user = admin;

  answers.setLineReviewNotify = () => true;
  assert.deepEqual(await setLineReviewNotifyAction(idle, form({ on: "1" })), {
    status: "saved",
    on: true,
  });
  assert.deepEqual(
    await setLineReviewNotifyAction(idle, form({ on: "true" })),
    { status: "saved", on: false },
  );
  assert.deepEqual(calls, [
    ["setLineReviewNotify", true],
    ["setLineReviewNotify", false],
  ]);
  assert.deepEqual(next.revalidated, [["/account/line"], ["/account/line"]]);

  // No LINE link to switch the reminder on.
  next.revalidated.length = 0;
  answers.setLineReviewNotify = () => false;
  const state = await setLineReviewNotifyAction(idle, form({ on: "1" }));
  assert.equal(state.status, "error");
  assert.match((state as { message: string }).message, /LINE と連携しているか/);
  assert.deepEqual(next.revalidated, []);
});
