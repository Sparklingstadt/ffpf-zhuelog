import { buildDemoSeed, type DemoSeed } from "../../domain/demo/demo-seed";

// Called without DEMO_LOGIN_ID: there is no demo to reset.
export class DemoResetUnavailableError extends Error {
  override name = "DemoResetUnavailableError";
}

export type DemoResetDeps = {
  // DEMO_LOGIN_ID; undefined: no demo (the reset route answers 404 then).
  loginId: string | undefined;
  fixture: unknown;
  store: { reset(loginId: string, seed: DemoSeed, now: Date): Promise<string> };
  newUuid: () => string;
  now: () => Date;
};

// The nightly demo reset: the fixture made relative to now, written over the
// demo account in one go.
export function createDemoReset(deps: DemoResetDeps) {
  return {
    available: deps.loginId !== undefined,

    // Throws DemoResetUnavailableError without DEMO_LOGIN_ID.
    async reset(): Promise<void> {
      const loginId = deps.loginId;
      if (loginId === undefined)
        throw new DemoResetUnavailableError("DEMO_LOGIN_ID is not set");
      const now = deps.now();
      const seed = buildDemoSeed(deps.fixture, now, deps.newUuid);
      await deps.store.reset(loginId, seed, now);
    },
  };
}
