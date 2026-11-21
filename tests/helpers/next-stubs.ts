import { mock } from "node:test";

// Stand-ins for the Next.js request APIs, so Server Actions, page guards and
// the code that reads and writes cookies can run in a plain Node test. Call
// installNextStubs() (and stubSource() for the containers a test replaces)
// before importing the module under test with `await import(...)`, and
// next.reset() between tests. scripts/test-unit.mjs passes
// --experimental-test-module-mocks, which mock.module() needs.

type WrittenCookie = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

// What redirect() throws in place of Next's NEXT_REDIRECT.
export class RedirectSignal extends Error {
  constructor(
    readonly to: string,
    readonly type?: string,
  ) {
    super(`redirect to ${to}`);
    this.name = "RedirectSignal";
  }
}

// What notFound() throws in place of Next's 404.
export class NotFoundSignal extends Error {
  constructor() {
    super("not found");
    this.name = "NotFoundSignal";
  }
}

export const next = {
  // The request's cookies; cookies().set() also updates them.
  cookies: new Map<string, string>(),
  // Every cookies().set() call, in order.
  written: [] as WrittenCookie[],
  // The request's headers.
  headers: new Headers(),
  // Every revalidatePath() call: [path] or [path, type].
  revalidated: [] as string[][],
  // Makes revalidatePath() throw, as it does outside a request.
  failRevalidate: false,
  reset() {
    this.cookies.clear();
    this.written.length = 0;
    this.headers = new Headers();
    this.revalidated.length = 0;
    this.failRevalidate = false;
  },
};

// The cookies written so far, as [name, value, maxAge]. (Reading next.written
// through a function also keeps an earlier assert.deepEqual(next.written, [])
// from narrowing it to an empty array for the rest of a test.)
export function writtenCookies(): [string, string, unknown][] {
  return next.written.map(({ name, value, options }) => [
    name,
    value,
    options.maxAge,
  ]);
}

// mock.module() took `namedExports` until Node 26 renamed it to `exports`.
export function stubModule(
  specifier: string | URL,
  exports: Record<string, unknown>,
) {
  const modern = Number(process.versions.node.split(".")[0]) >= 26;
  mock.module(
    String(specifier),
    (modern ? { exports } : { namedExports: exports }) as never,
  );
}

// A module of src/, named by its path from there ("composition/chat-container").
export function stubSource(path: string, exports: Record<string, unknown>) {
  stubModule(new URL(`../../src/${path}.ts`, import.meta.url), exports);
}

export function installNextStubs() {
  stubModule("next/headers", {
    cookies: async () => ({
      get: (name: string) =>
        next.cookies.has(name)
          ? { name, value: next.cookies.get(name)! }
          : undefined,
      set: (name: string, value: string, options = {}) => {
        next.written.push({ name, value, options });
        next.cookies.set(name, value);
      },
    }),
    headers: async () => next.headers,
  });
  stubModule("next/navigation", {
    redirect: (to: string, type?: string) => {
      throw new RedirectSignal(to, type);
    },
    RedirectType: { push: "push", replace: "replace" },
    notFound: () => {
      throw new NotFoundSignal();
    },
    // As Next's: its own control-flow errors go on, anything else is left to
    // the caller.
    unstable_rethrow: (error: unknown) => {
      if (error instanceof RedirectSignal || error instanceof NotFoundSignal)
        throw error;
    },
  });
  stubModule("next/cache", {
    revalidatePath: (path: string, type?: string) => {
      if (next.failRevalidate) throw new Error("revalidatePath outside Next");
      next.revalidated.push(type ? [path, type] : [path]);
    },
  });
}

// Where run() redirected to. Fails when it returned or threw anything else.
export async function redirectOf(
  run: () => Promise<unknown>,
): Promise<RedirectSignal> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error;
    throw error;
  }
  throw new Error("expected a redirect");
}
