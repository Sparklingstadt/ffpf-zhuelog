import assert from "node:assert/strict";
import { beforeEach, test, type TestContext } from "node:test";

import { AccountAdminForbiddenError } from "../src/application/identity/member-accounts";
import { LineLinkForbiddenError } from "../src/application/line/line-link";
import type { AuthenticatedUser } from "../src/domain/identity/entities/authenticated-user";
import {
  accountForbiddenMessage,
  accountInputMessage,
  accountNotFoundMessage,
  changePasswordMessage,
} from "../src/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "../src/presentation/presenters/generic-error-message";
import {
  installNextStubs,
  next,
  RedirectSignal,
  redirectOf,
  stubSource,
} from "./helpers/next-stubs";

// The Server Actions around who is signed in: sign-in and sign-out, acting as
// a member, member accounts, a member's own password and the LINE link. What
// they add to the use cases (each with its own tests): the role checked again
// before anything is called, form fields read as text, each outcome's text,
// and what is refreshed or where the browser goes afterwards.

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
  getCurrentMemberUser: async () =>
    user && user.role !== "guest" ? user : null,
  getCurrentAdminUser: async () => (user?.role === "admin" ? user : null),
  signInWithGitHub: record("signInWithGitHub"),
  signInWithFfpf: record("signInWithFfpf"),
  signInAsGuest: record("signInAsGuest"),
  signInAsDemo: record("signInAsDemo"),
  signInWithPassword: record("signInWithPassword"),
  signOutCurrentUser: record("signOutCurrentUser"),
  // As the real one: it ends by redirecting.
  signOutTo: async (to: string) => {
    calls.push(["signOutTo", to]);
    throw new RedirectSignal(to);
  },
  startActingAs: record("startActingAs"),
  stopActing: record("stopActing"),
});
stubSource("composition/account-container", {
  memberAccounts: {
    create: record("memberAccounts.create"),
    resetPassword: record("memberAccounts.resetPassword"),
  },
  ownPassword: { change: record("ownPassword.change") },
});
stubSource("composition/line-container", {
  lineLink: {
    issueCode: record("lineLink.issueCode"),
    unlink: record("lineLink.unlink"),
    setReviewNotify: record("lineLink.setReviewNotify"),
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
const throws = (error: Error) => () => {
  throw error;
};
const idle = { status: "idle" } as const;
const refused = { status: "error", message: accountForbiddenMessage };
const issued = {
  loginId: "hana",
  password: "generated-password",
  generated: true,
};

function captureErrors(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
  return logged;
}

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
  // password members; nothing is even looked up.
  user = admin;
  for (const ownerId of ["10001", "ffpf:abc", "password:../x", ""])
    assert.equal(
      (await redirectOf(() => startActingAsAction(ownerId))).to,
      "/admin/accounts?actAs=failed",
    );
  assert.deepEqual(calls, []);

  answers.startActingAs = () => true;
  assert.equal((await redirectOf(() => startActingAsAction(target))).to, "/");
  // The member was deleted in the meantime.
  answers.startActingAs = () => false;
  assert.equal(
    (await redirectOf(() => startActingAsAction(target))).to,
    "/admin/accounts?actAs=failed",
  );
  assert.deepEqual(calls, [
    ["startActingAs", target],
    ["startActingAs", target],
  ]);

  // Anyone may stop: it only clears their own cookie.
  calls = [];
  user = null;
  assert.equal(
    (await redirectOf(() => stopActingAction())).to,
    "/admin/accounts",
  );
  assert.deepEqual(calls, [["stopActing"]]);
});

test("only an admin creates accounts and resets passwords", async () => {
  const actions = await accounts();
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
  answers["memberAccounts.create"] = () => ({ ok: true, issued });

  const state = await createPasswordAccountAction(
    idle,
    form({ loginId: "hana", displayName: "花", password: new Blob(["x"]) }),
  );

  assert.deepEqual(state, { status: "success", ...issued });
  // A field that is not text is sent as empty, never as a file.
  assert.deepEqual(calls, [
    [
      "memberAccounts.create",
      { loginId: "hana", displayName: "花", password: "" },
    ],
  ]);
  assert.deepEqual(next.revalidated, [["/admin/accounts"]]);
});

test("the one-time password still reaches the admin when the list cannot be refreshed", async (t) => {
  const { createPasswordAccountAction } = await accounts();
  const logged = captureErrors(t);
  user = admin;
  answers["memberAccounts.create"] = () => ({ ok: true, issued });
  next.failRevalidate = true;

  const state = await createPasswordAccountAction(
    idle,
    form({ loginId: "hana", displayName: "花", password: "" }),
  );

  assert.deepEqual(state, { status: "success", ...issued });
  // Only the fixed code is logged: the form carries a plaintext password.
  assert.deepEqual(logged, [["PASSWORD_ACCOUNT_REVALIDATE_FAILED"]]);
});

test("a refused account input shows its own text and refreshes nothing", async () => {
  const actions = await accounts();
  user = admin;
  const fields = form({ loginId: "hana", displayName: "花", password: "" });

  for (const reason of [
    "login-id",
    "display-name",
    "password",
    "login-id-taken",
  ] as const) {
    answers["memberAccounts.create"] = () => ({ ok: false, reason });
    assert.deepEqual(await actions.createPasswordAccountAction(idle, fields), {
      status: "error",
      message: accountInputMessage(reason),
    });
  }

  answers["memberAccounts.resetPassword"] = () => ({
    ok: false,
    reason: "password",
  });
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
    { status: "error", message: accountInputMessage("password") },
  );
  // The account was deleted in the meantime.
  answers["memberAccounts.resetPassword"] = () => ({
    ok: false,
    reason: "not-found",
  });
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
    { status: "error", message: accountNotFoundMessage },
  );
  assert.deepEqual(next.revalidated, []);
});

test("a reset password is sent by the account's id and comes back once", async () => {
  const { resetPasswordAccountPasswordAction } = await accounts();
  user = admin;
  const reissued = {
    loginId: "hana",
    password: "new-password-12",
    generated: false,
  };
  answers["memberAccounts.resetPassword"] = () => ({
    ok: true,
    issued: reissued,
  });

  assert.deepEqual(
    await resetPasswordAccountPasswordAction(
      "c1",
      idle,
      form({ password: "new-password-12" }),
    ),
    { status: "success", ...reissued },
  );
  assert.deepEqual(calls, [
    ["memberAccounts.resetPassword", "c1", "new-password-12"],
  ]);
  assert.deepEqual(next.revalidated, [["/admin/accounts"]]);
});

test("an account call that fails says not allowed or the generic text, logging its name only", async (t) => {
  const actions = await accounts();
  const logged = captureErrors(t);
  user = admin;
  const fields = form({
    loginId: "hana",
    displayName: "花",
    password: "plain-password-1",
  });

  // The use case checks the admin again (an admin acting as a member).
  answers["memberAccounts.create"] = throws(new AccountAdminForbiddenError());
  assert.deepEqual(
    await actions.createPasswordAccountAction(idle, fields),
    refused,
  );
  assert.deepEqual(logged, []);

  answers["memberAccounts.resetPassword"] = throws(
    new TypeError("db down plain-password-1"),
  );
  assert.deepEqual(
    await actions.resetPasswordAccountPasswordAction("c1", idle, fields),
    { status: "error", message: genericErrorMessage },
  );
  assert.deepEqual(logged, [["PASSWORD_ACCOUNT_RESET_FAILED", "TypeError"]]);
  assert.deepEqual(next.revalidated, []);
});

test("only a password member changes their own password", async () => {
  const { changeOwnPasswordAction } = await accounts();
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
});

test("a changed password signs the member out; a refused one stays on the form", async (t) => {
  const { changeOwnPasswordAction } = await accounts();
  const logged = captureErrors(t);
  user = member;
  const fields = form({
    currentPassword: "old-password-1",
    newPassword: "new-password-1",
    confirmPassword: new Blob(["x"]),
  });

  for (const outcome of [
    "forbidden",
    "invalid-new-password",
    "password-mismatch",
    "invalid-current-password",
  ] as const) {
    answers["ownPassword.change"] = () => outcome;
    assert.deepEqual(await changeOwnPasswordAction(idle, fields), {
      status: "error",
      message: changePasswordMessage(outcome),
    });
  }
  assert.deepEqual(logged, []);
  // Too many attempts is told apart only in the log.
  answers["ownPassword.change"] = () => "rate-limited";
  assert.deepEqual(await changeOwnPasswordAction(idle, fields), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(logged, [["PASSWORD_CHANGE_RATE_LIMITED"]]);
  answers["ownPassword.change"] = throws(new TypeError("db down"));
  assert.deepEqual(await changeOwnPasswordAction(idle, fields), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.ok(!calls.some(([name]) => name === "signOutTo"));

  calls = [];
  answers["ownPassword.change"] = () => "changed";
  const redirect = await redirectOf(() =>
    changeOwnPasswordAction(idle, fields),
  );
  assert.equal(redirect.to, "/signin?notice=password-changed");
  // The attempts are counted by the client's address; a field that is not
  // text is empty.
  assert.deepEqual(calls, [
    [
      "ownPassword.change",
      {
        currentPassword: "old-password-1",
        newPassword: "new-password-1",
        confirmPassword: "",
      },
      "203.0.113.7",
    ],
    ["signOutTo", "/signin?notice=password-changed"],
  ]);
});

test("a LINE link code is issued with its expiry as text", async (t) => {
  const { issueLineLinkCodeAction } = await line();
  const logged = captureErrors(t);

  answers["lineLink.issueCode"] = () => ({
    code: "ABCD2345",
    expiresAt: new Date("2026-11-21T03:00:00Z"),
  });
  assert.deepEqual(await issueLineLinkCodeAction(), {
    status: "issued",
    code: "ABCD2345",
    expiresAt: "2026-11-21T03:00:00.000Z",
  });

  // Guests, the demo and an admin acting as a member have no LINE link.
  answers["lineLink.issueCode"] = throws(new LineLinkForbiddenError());
  assert.deepEqual(await issueLineLinkCodeAction(), refused);
  assert.deepEqual(logged, []);

  answers["lineLink.issueCode"] = throws(new TypeError("db down"));
  assert.deepEqual(await issueLineLinkCodeAction(), {
    status: "error",
    message: genericErrorMessage,
  });
  assert.deepEqual(logged, [["LINE_LINK_CODE_FAILED", "TypeError"]]);
});

test("unlinking LINE refreshes the page; a refused user changes nothing", async () => {
  const { unlinkLineAction } = await line();

  await unlinkLineAction();
  assert.deepEqual(calls, [["lineLink.unlink"]]);
  assert.deepEqual(next.revalidated, [["/account/line"]]);

  next.revalidated.length = 0;
  answers["lineLink.unlink"] = throws(new LineLinkForbiddenError());
  assert.equal(await unlinkLineAction(), undefined);
  assert.deepEqual(next.revalidated, []);

  // Anything else is not swallowed.
  answers["lineLink.unlink"] = throws(new TypeError("db down"));
  await assert.rejects(unlinkLineAction(), TypeError);
  assert.deepEqual(next.revalidated, []);
});

test("the LINE review reminder is on only for on=1, and says so when nothing is linked", async () => {
  const { setLineReviewNotifyAction } = await line();

  answers["lineLink.setReviewNotify"] = () => true;
  assert.deepEqual(await setLineReviewNotifyAction(idle, form({ on: "1" })), {
    status: "saved",
    on: true,
  });
  assert.deepEqual(
    await setLineReviewNotifyAction(idle, form({ on: "true" })),
    { status: "saved", on: false },
  );
  assert.deepEqual(calls, [
    ["lineLink.setReviewNotify", true],
    ["lineLink.setReviewNotify", false],
  ]);
  assert.deepEqual(next.revalidated, [["/account/line"], ["/account/line"]]);

  // No LINE link to switch the reminder on.
  next.revalidated.length = 0;
  answers["lineLink.setReviewNotify"] = () => false;
  const state = await setLineReviewNotifyAction(idle, form({ on: "1" }));
  assert.equal(state.status, "error");
  assert.match((state as { message: string }).message, /LINE と連携しているか/);

  answers["lineLink.setReviewNotify"] = throws(new LineLinkForbiddenError());
  assert.deepEqual(
    await setLineReviewNotifyAction(idle, form({ on: "1" })),
    refused,
  );
  assert.deepEqual(next.revalidated, []);
});
