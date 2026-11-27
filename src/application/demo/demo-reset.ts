import { buildDemoSeed, type DemoSeed } from "../../domain/demo/demo-seed";

// Called without DEMO_LOGIN_ID or DEMO_PASSWORD: there is no demo to reset.
export class DemoResetUnavailableError extends Error {
  override name = "DemoResetUnavailableError";
}

export type DemoResetDeps = {
  // DEMO_LOGIN_ID and DEMO_PASSWORD; either undefined: no demo (the reset
  // route answers 404 then).
  loginId: string | undefined;
  password: string | undefined;
  fixture: unknown;
  store: {
    // Writes the seed over the demo user, whose password becomes password.
    reset(
      loginId: string,
      password: string,
      seed: DemoSeed,
      now: Date,
    ): Promise<string>;
    // Deletes the guests made more than 24 hours before now.
    deleteStaleGuests(now: Date): Promise<number>;
  };
  newUuid: () => string;
  now: () => Date;
};

// The nightly demo reset: the fixture made relative to now, written over the
// demo account in one go, with DEMO_PASSWORD as its password again. The same
// daily run deletes the guests older than a day.
export function createDemoReset(deps: DemoResetDeps) {
  return {
    available: deps.loginId !== undefined && deps.password !== undefined,

    // Throws DemoResetUnavailableError without DEMO_LOGIN_ID or
    // DEMO_PASSWORD.
    async reset(): Promise<void> {
      const { loginId, password } = deps;
      if (loginId === undefined || password === undefined)
        throw new DemoResetUnavailableError(
          "DEMO_LOGIN_ID or DEMO_PASSWORD is not set",
        );
      const now = deps.now();
      const seed = buildDemoSeed(deps.fixture, now, deps.newUuid);
      await deps.store.reset(loginId, password, seed, now);
      await deps.store.deleteStaleGuests(now);
    },
  };
}
