import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccountGateway } from "../src/infrastructure/go-api/account-gateway";
import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import {
  GoApiError,
  type GoApiInit,
} from "../src/infrastructure/go-api/client";

type Init = Omit<GoApiInit, "accessToken">;

function fakeCall(response: unknown) {
  const calls: { path: string; init: Init }[] = [];
  const call = (async (path: string, init: Init) => {
    calls.push({ path, init });
    if (response instanceof Error) throw response;
    return response;
  }) as GoApiCall;
  return { call, calls };
}

const accountJson = {
  id: "acc1",
  ownerId: "password:acc1",
  loginId: "taro",
  displayName: "太郎",
  createdAt: "2026-10-22T03:04:05.000Z",
};

test("listAccounts reads Go's accounts in order with dates", async () => {
  const { call, calls } = fakeCall({
    accounts: [accountJson, { ...accountJson, id: "acc2", loginId: "jiro" }],
  });
  const accounts = await createAccountGateway(call).listAccounts();
  assert.deepEqual(calls, [
    { path: "/v1/admin/accounts", init: { method: "GET" } },
  ]);
  assert.deepEqual(
    accounts.map((a) => a.loginId),
    ["taro", "jiro"],
  );
  assert.deepEqual(accounts[0], {
    id: "acc1",
    ownerId: "password:acc1",
    loginId: "taro",
    displayName: "太郎",
    createdAt: new Date("2026-10-22T03:04:05.000Z"),
  });
});

test("createAccount posts the form fields and returns the one-time password", async () => {
  const { call, calls } = fakeCall({
    account: accountJson,
    password: "generated-password-1",
    generated: true,
  });
  const issued = await createAccountGateway(call).createAccount({
    loginId: "taro",
    displayName: "太郎",
    password: "",
  });
  assert.deepEqual(calls, [
    {
      path: "/v1/admin/accounts",
      init: {
        method: "POST",
        body: { loginId: "taro", displayName: "太郎", password: "" },
      },
    },
  ]);
  assert.deepEqual(issued, {
    loginId: "taro",
    password: "generated-password-1",
    generated: true,
  });
});

test("createAccount rethrows Go's 409 for the action to show", async () => {
  const taken = new GoApiError(409, "login_id_taken", "使われています");
  const { call } = fakeCall(taken);
  await assert.rejects(
    createAccountGateway(call).createAccount({
      loginId: "taro",
      displayName: "太郎",
      password: "",
    }),
    (error) => error === taken,
  );
});

test("resetPassword posts to the escaped account path", async () => {
  const { call, calls } = fakeCall({
    loginId: "taro",
    password: "typed password 1",
    generated: false,
  });
  const issued = await createAccountGateway(call).resetPassword(
    "acc/1",
    "typed password 1",
  );
  assert.deepEqual(calls, [
    {
      path: "/v1/admin/accounts/acc%2F1/password",
      init: { method: "POST", body: { password: "typed password 1" } },
    },
  ]);
  assert.deepEqual(issued, {
    loginId: "taro",
    password: "typed password 1",
    generated: false,
  });
});

test("resetPassword returns null for a missing account and rethrows the rest", async () => {
  const missing = fakeCall(new GoApiError(404, "not_found"));
  assert.equal(
    await createAccountGateway(missing.call).resetPassword("acc1", ""),
    null,
  );
  const down = new GoApiError(503, "unavailable");
  await assert.rejects(
    createAccountGateway(fakeCall(down).call).resetPassword("acc1", ""),
    (error) => error === down,
  );
});

test("changeOwnPassword posts the three fields with the client IP", async () => {
  const { call, calls } = fakeCall(undefined);
  await createAccountGateway(call).changeOwnPassword(
    {
      currentPassword: "old password 1",
      newPassword: "new password 12",
      confirmPassword: "new password 12",
    },
    "203.0.113.7",
  );
  assert.deepEqual(calls, [
    {
      path: "/v1/account/password",
      init: {
        method: "POST",
        body: {
          currentPassword: "old password 1",
          newPassword: "new password 12",
          confirmPassword: "new password 12",
        },
        clientIp: "203.0.113.7",
      },
    },
  ]);
});

test("changeOwnPassword rethrows Go's errors", async () => {
  const mismatch = new GoApiError(400, "password_mismatch", "一致しません");
  await assert.rejects(
    createAccountGateway(fakeCall(mismatch).call).changeOwnPassword(
      { currentPassword: "a", newPassword: "b", confirmPassword: "c" },
      "203.0.113.7",
    ),
    (error) => error === mismatch,
  );
});

test("getLineLink reads whether LINE is linked", async () => {
  const { call, calls } = fakeCall({ linked: true });
  const link = await createAccountGateway(call).getLineLink();
  assert.deepEqual(calls, [{ path: "/v1/line/link", init: { method: "GET" } }]);
  assert.deepEqual(link, { linked: true, available: true });
});

test("getLineLink reports LINE as unavailable when Go has no link routes", async () => {
  const { call } = fakeCall(new GoApiError(404, "not_found", ""));
  const link = await createAccountGateway(call).getLineLink();
  assert.deepEqual(link, { linked: false, available: false });
});

test("getLineLink rethrows other failures", async () => {
  const failure = new GoApiError(500, "internal", "");
  const { call } = fakeCall(failure);
  await assert.rejects(() => createAccountGateway(call).getLineLink(), failure);
});

test("issueLineLinkCode posts and returns the code with a Date expiry", async () => {
  const { call, calls } = fakeCall({
    code: "ABCD2345",
    expiresAt: "2026-10-23T03:04:05.123Z",
  });
  const issued = await createAccountGateway(call).issueLineLinkCode();
  assert.deepEqual(calls, [
    { path: "/v1/line/link-code", init: { method: "POST" } },
  ]);
  assert.deepEqual(issued, {
    code: "ABCD2345",
    expiresAt: new Date("2026-10-23T03:04:05.123Z"),
  });
});

test("unlinkLine deletes the link", async () => {
  const { call, calls } = fakeCall(undefined);
  await createAccountGateway(call).unlinkLine();
  assert.deepEqual(calls, [
    { path: "/v1/line/link", init: { method: "DELETE" } },
  ]);
});
