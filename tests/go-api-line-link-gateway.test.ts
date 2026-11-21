import assert from "node:assert/strict";
import { test } from "node:test";

import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import {
  GoApiError,
  type GoApiInit,
} from "../src/infrastructure/go-api/client";
import { createLineLinkGateway } from "../src/infrastructure/go-api/line-link-gateway";

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

test("getLineLink reads whether LINE is linked", async () => {
  const { call, calls } = fakeCall({ linked: true });
  const link = await createLineLinkGateway(call).getLineLink();
  assert.deepEqual(calls, [{ path: "/v1/line/link", init: { method: "GET" } }]);
  assert.deepEqual(link, {
    linked: true,
    available: true,
    reviewNotify: false,
  });
});

test("getLineLink reads the review message setting", async () => {
  const { call } = fakeCall({ linked: true, reviewNotify: true });
  const link = await createLineLinkGateway(call).getLineLink();
  assert.equal(link.reviewNotify, true);
});

test("getLineLink reports LINE as unavailable when Go has no link routes", async () => {
  const { call } = fakeCall(new GoApiError(404, "not_found", ""));
  const link = await createLineLinkGateway(call).getLineLink();
  assert.deepEqual(link, {
    linked: false,
    available: false,
    reviewNotify: false,
  });
});

test("getLineLink rethrows other failures", async () => {
  const failure = new GoApiError(500, "internal", "");
  const { call } = fakeCall(failure);
  await assert.rejects(
    () => createLineLinkGateway(call).getLineLink(),
    failure,
  );
});

test("issueLineLinkCode posts and returns the code with a Date expiry", async () => {
  const { call, calls } = fakeCall({
    code: "ABCD2345",
    expiresAt: "2026-10-23T03:04:05.123Z",
  });
  const issued = await createLineLinkGateway(call).issueLineLinkCode();
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
  await createLineLinkGateway(call).unlinkLine();
  assert.deepEqual(calls, [
    { path: "/v1/line/link", init: { method: "DELETE" } },
  ]);
});

test("setLineReviewNotify puts to turn on and deletes to turn off", async () => {
  const { call, calls } = fakeCall({ reviewNotify: true });
  const gateway = createLineLinkGateway(call);
  assert.equal(await gateway.setLineReviewNotify(true), true);
  assert.equal(await gateway.setLineReviewNotify(false), true);
  assert.deepEqual(calls, [
    { path: "/v1/line/review-notify", init: { method: "PUT" } },
    { path: "/v1/line/review-notify", init: { method: "DELETE" } },
  ]);
});

test("setLineReviewNotify is false when Go has no setting and rethrows the rest", async () => {
  const missing = fakeCall(new GoApiError(404, "not_found", ""));
  assert.equal(
    await createLineLinkGateway(missing.call).setLineReviewNotify(true),
    false,
  );
  const failure = new GoApiError(500, "internal", "");
  const broken = fakeCall(failure);
  await assert.rejects(
    () => createLineLinkGateway(broken.call).setLineReviewNotify(true),
    failure,
  );
});
