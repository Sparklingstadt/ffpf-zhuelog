import assert from "node:assert/strict";
import test from "node:test";

test("pnpm workspace packages load their public exports", async () => {
  const core =
    await import("@ffpf-zhuelog/core/domain/identity/entities/authenticated-user");
  assert.ok(Object.keys(core).length > 0);
});
