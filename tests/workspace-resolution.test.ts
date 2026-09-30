import assert from "node:assert/strict";
import test from "node:test";

test("pnpm workspace packages load their public integration exports", async () => {
  const core = await import("@ffpf-zhuelog/core/integration");
  const plugin = await import("@ffpf-zhuelog/typle-integrate-plugin");
  assert.ok(Object.keys(core).length > 0);
  assert.ok(Object.keys(plugin).length > 0);
});
