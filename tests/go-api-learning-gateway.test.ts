import assert from "node:assert/strict";
import { test } from "node:test";

import { GoApiError } from "../src/infrastructure/go-api/client";
import type { GoApiCall } from "../src/infrastructure/go-api/authed";
import { createLearningGateway } from "../src/infrastructure/go-api/learning-gateway";

function recordingCall(response: unknown) {
  const calls: [string, string][] = [];
  const call = (async (path: string, init: { method: string }) => {
    calls.push([init.method, path]);
    if (response instanceof Error) throw response;
    return response;
  }) as GoApiCall;
  return { call, calls };
}

test("importCsv uploads the file as csvFile and returns Go's count", async () => {
  const uploads: { path: string; file: FormDataEntryValue | null }[] = [];
  const upload = (async (path: string, form: FormData) => {
    uploads.push({ path, file: form.get("csvFile") });
    return { batch: { id: "b1" }, count: 3 };
  }) as Parameters<typeof createLearningGateway>[1];
  const file = new File(["a,b,c"], "notes.csv", { type: "text/csv" });
  const count = await createLearningGateway(
    recordingCall({}).call,
    upload,
  ).importCsv(file);
  assert.equal(count, 3);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].path, "/v1/imports/csv");
  assert.ok(uploads[0].file instanceof File);
  assert.equal((uploads[0].file as File).name, "notes.csv");
  assert.equal(await (uploads[0].file as File).text(), "a,b,c");
});

test("the review queue: status, put in and take out, on the token owner's note", async () => {
  const { call, calls } = recordingCall({ inReview: true });
  const gateway = createLearningGateway(call);
  assert.equal(await gateway.isInReview("e5"), true);
  assert.equal(await gateway.setInReview("e5", true), true);
  assert.equal(await gateway.setInReview("e5", false), true);
  assert.deepEqual(calls, [
    ["GET", "/v1/entries/e5/review"],
    ["PUT", "/v1/entries/e5/review"],
    ["DELETE", "/v1/entries/e5/review"],
  ]);
});

test("a note Go does not find has no review status and cannot be put in", async () => {
  const { call } = recordingCall(new GoApiError(404, "not_found"));
  const gateway = createLearningGateway(call);
  assert.equal(await gateway.isInReview("e1"), null);
  assert.equal(await gateway.setInReview("e1", true), false);
});

test("the review status lets other Go errors through", async () => {
  const { call } = recordingCall(new GoApiError(500, "internal"));
  await assert.rejects(
    createLearningGateway(call).isInReview("e1"),
    (error) => error instanceof GoApiError && error.status === 500,
  );
});
