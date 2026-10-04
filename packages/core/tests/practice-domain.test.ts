import assert from "node:assert/strict";
import { test } from "node:test";

import * as practice from "@ffpf-zhuelog/core/domain/practice/personal-correction";

test("practice domain holds neither screen text nor provider settings", () => {
  // Messages and HTTP request checks belong to presentation, the model name
  // to the OpenAI gateway.
  assert.equal("correctionErrors" in practice, false);
  assert.equal("PERSONAL_CORRECTION_MODEL" in practice, false);
});

test("correction failures carry a code, not user-facing text", () => {
  const error = new practice.PersonalCorrectionError("limited");
  assert.equal(error.code, "limited");
  assert.equal(error.message, "limited");
  // @ts-expect-error request-level rejections are not domain failures
  assert.ok(new practice.PersonalCorrectionError("origin"));
});
