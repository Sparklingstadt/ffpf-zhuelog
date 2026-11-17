import { DEMO_PASSWORD_HASH } from "../../domain/identity/demo-account";
import {
  CURRENT_PASSWORD_MAX_CODE_POINTS,
  firstCodePoints,
  isPlausibleCurrentPassword,
  normalizeLoginId,
} from "../../domain/identity/password-account";
import {
  GUEST_OWNER_ID,
  sessionTtlMs,
  type SessionPrincipal,
} from "../../domain/identity/session";
import {
  AUTH_ROUTE_THROTTLE,
  DEMO_SIGN_IN_THROTTLE,
  SIGN_IN_CLIENT_THROTTLE,
  SIGN_IN_LOGIN_THROTTLE,
  authRouteThrottleKey,
  demoSignInThrottleKey,
  signInClientThrottleKey,
  signInLoginThrottleKey,
  type ThrottleRule,
} from "../../domain/identity/sign-in-throttle";

// "invalid": wrong credentials of any kind, indistinguishable. "throttled":
// too many attempts. "forbidden": a GitHub user who is not an admin.
// "unavailable": the provider could not be used. "demo-unavailable": no demo
// is configured, or its account is missing or is not the reset's.
export type SignInFailure =
  "invalid" | "throttled" | "forbidden" | "unavailable" | "demo-unavailable";

export type IssuedSession = { token: string; maxAgeSeconds: number };

export type SignInResult =
  { ok: true; session: IssuedSession } | { ok: false; reason: SignInFailure };

export type GitHubIdentity = { id: number; login: string };

export type FfpfIdentity = { sub: string; email: string; name: string };

// What an OAuth client answers: the user, or why not ("invalid": the code or
// token was refused; "unavailable": the provider could not be used).
export type ExchangeOutcome<T> =
  { ok: true; user: T } | { ok: false; reason: "invalid" | "unavailable" };

export type SignInDeps = {
  throttle: {
    // Counts one attempt; true while within the rule.
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  passwordAccounts: {
    // The account with this (already normalised) loginId, or null.
    findByLoginId(loginId: string): Promise<{
      id: string;
      passwordHash: string;
      sessionVersion: number;
    } | null>;
  };
  ffpfAccounts: {
    // Go: UpsertFfpfAccount. Creates with sessionVersion 0 or updates email,
    // displayName and lastLoginAt; returns the stored sessionVersion.
    upsert(
      input: { id: string; email: string; displayName: string },
      now: Date,
    ): Promise<{ sessionVersion: number }>;
  };
  passwords: {
    verify(password: string, hash: string): Promise<boolean>;
    simulate(password: string): Promise<void>;
  };
  sessions: { start(principal: SessionPrincipal, now: Date): Promise<string> };
  github: {
    exchange(
      code: string,
      verifier: string,
      redirectUri: string,
    ): Promise<ExchangeOutcome<GitHubIdentity>>;
  } | null;
  ffpf: {
    exchange(
      code: string,
      verifier: string,
      redirectUri: string,
      nonce: string,
    ): Promise<ExchangeOutcome<FfpfIdentity>>;
  } | null;
  allowedGitHubIds: ReadonlySet<string>;
  demoLoginId: string | undefined;
  now: () => Date;
};

const PASSWORD_OWNER_PREFIX = "password:";

function failure(reason: SignInFailure): SignInResult {
  return { ok: false, reason };
}

// Signing in on the web, in the order, keys and numbers of Go's Service
// (services/api/auth/login.go, demo.go). Every sign-in first counts
// "route:auth:<client>" (Go's /v1/auth/* route limit). Store and hasher
// errors are thrown, never turned into "invalid".
export function createSignIn(deps: SignInDeps) {
  async function withinRouteLimit(client: string, now: Date) {
    return deps.throttle.consume(
      authRouteThrottleKey(client),
      AUTH_ROUTE_THROTTLE,
      now,
    );
  }

  async function issue(
    principal: SessionPrincipal,
    now: Date,
  ): Promise<SignInResult> {
    const token = await deps.sessions.start(principal, now);
    return {
      ok: true,
      session: { token, maxAgeSeconds: sessionTtlMs(principal) / 1000 },
    };
  }

  return {
    // Go: LoginPassword. Throttled attempts cost no scrypt; every credential
    // failure (malformed input, unknown loginId, wrong password) costs
    // exactly one, on at most 128 code points, and answers "invalid".
    async withPassword(
      input: { loginId: string; password: string },
      client: string,
    ): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      if (
        !(await deps.throttle.consume(
          signInClientThrottleKey(client),
          SIGN_IN_CLIENT_THROTTLE,
          now,
        ))
      )
        return failure("throttled");

      const { password } = input;
      const reject = async () => {
        await deps.passwords.simulate(
          firstCodePoints(password, CURRENT_PASSWORD_MAX_CODE_POINTS),
        );
        return failure("invalid");
      };

      const loginId = normalizeLoginId(input.loginId);
      // isPlausibleCurrentPassword: non-empty and at most 128 code points.
      if (loginId === null || !isPlausibleCurrentPassword(password))
        return reject();

      const loginKey = signInLoginThrottleKey(client, loginId);
      if (!(await deps.throttle.consume(loginKey, SIGN_IN_LOGIN_THROTTLE, now)))
        return failure("throttled");

      const account = await deps.passwordAccounts.findByLoginId(loginId);
      if (!account) return reject();
      // A wrong password already cost its one scrypt.
      if (!(await deps.passwords.verify(password, account.passwordHash)))
        return failure("invalid");

      await deps.throttle.reset(loginKey);
      return issue(
        {
          role: "member",
          ownerId: PASSWORD_OWNER_PREFIX + account.id,
          sessionVersion: account.sessionVersion,
        },
        now,
      );
    },

    // Go: LoginGuest. No credentials; every guest shares the owner id
    // "guest" and owns nothing.
    async asGuest(client: string): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      return issue({ role: "guest", ownerId: GUEST_OWNER_ID }, now);
    },

    // Go: LoginDemo. Only the account the nightly reset made (its hash is
    // DEMO_PASSWORD_HASH): if DEMO_LOGIN_ID named a real member, this would
    // let anyone into it.
    async asDemo(client: string): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      if (!deps.demoLoginId) return failure("demo-unavailable");
      if (
        !(await deps.throttle.consume(
          demoSignInThrottleKey(client),
          DEMO_SIGN_IN_THROTTLE,
          now,
        ))
      )
        return failure("throttled");
      const account = await deps.passwordAccounts.findByLoginId(
        deps.demoLoginId,
      );
      if (!account || account.passwordHash !== DEMO_PASSWORD_HASH)
        return failure("demo-unavailable");
      return issue(
        {
          role: "member",
          ownerId: PASSWORD_OWNER_PREFIX + account.id,
          sessionVersion: account.sessionVersion,
        },
        now,
      );
    },

    // Go: LoginGitHub. Filled in by the GitHub client's task.
    async withGitHub(
      input: { code: string; verifier: string; redirectUri: string },
      client: string,
    ): Promise<SignInResult> {
      void input;
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      return failure("unavailable");
    },

    // Go: LoginFFPF. Filled in by the FFPF ID client's task.
    async withFfpf(
      input: {
        code: string;
        verifier: string;
        redirectUri: string;
        nonce: string;
      },
      client: string,
    ): Promise<SignInResult> {
      void input;
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      return failure("unavailable");
    },
  };
}
