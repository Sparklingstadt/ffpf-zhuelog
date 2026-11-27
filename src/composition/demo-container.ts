import { createDemoReset } from "@/application/demo/demo-reset";
import fixture from "@/domain/demo/demo-fixture.json";
import { demoConfig } from "@/infrastructure/config/environment";
import { createDemoResetStore } from "@/infrastructure/prisma/demo-reset-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { ScryptPasswordHasher } from "@/infrastructure/security/scrypt-password-hasher";

const hasher = new ScryptPasswordHasher();
const demo = demoConfig();

// The nightly demo reset. Read once at module load; Vercel needs a redeploy
// for env changes anyway.
export const demoReset = createDemoReset({
  loginId: demo?.loginId,
  password: demo?.password,
  fixture,
  store: createDemoResetStore(prisma, (password) => hasher.hash(password)),
  newUuid: () => globalThis.crypto.randomUUID(),
  now: () => new Date(Math.trunc(Date.now())),
});
