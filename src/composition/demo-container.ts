import { createDemoReset } from "@/application/demo/demo-reset";
import fixture from "@/domain/demo/demo-fixture.json";
import { demoLoginId } from "@/infrastructure/config/environment";
import { createDemoResetStore } from "@/infrastructure/prisma/demo-reset-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";

// The nightly demo reset. Read once at module load; Vercel needs a redeploy
// for env changes anyway.
export const demoReset = createDemoReset({
  loginId: demoLoginId(),
  fixture,
  store: createDemoResetStore(prisma),
  newUuid: () => globalThis.crypto.randomUUID(),
  now: () => new Date(Math.trunc(Date.now())),
});
