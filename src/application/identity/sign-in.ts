import { DEMO_PASSWORD_HASH } from "../../domain/identity/demo-account";
import {
  SID_SUB_PATTERN,
  sidDisplayName,
} from "../../domain/identity/sid-account";
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

export type SidIdentity = { sub: string; email: string; name: string };

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
  sidAccounts: {
    // Creates with sessionVersion 0 or updates email,
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
  sid: {
    exchange(
      code: string,
      verifier: string,
      redirectUri: string,
      nonce: string,
    ): Promise<ExchangeOutcome<SidIdentity>>;
  } | null;
  allowedGitHubIds: ReadonlySet<string>;
  demoLoginId: string | undefined;
  now: () => Date;
};

const PASSWORD_OWNER_PREFIX = "password:";
const SID_OWNER_PREFIX = "sid:";

function failure(reason: SignInFailure): SignInResult {
  return { ok: false, reason };
}

// Signing in. Every kind of sign-in first counts "route:auth:<client>"
// (AUTH_ROUTE_THROTTLE). Store and hasher errors are thrown, never turned
// into "invalid".
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
    // Throttled attempts cost no scrypt; every credential failure (malformed
    // input, unknown loginId, wrong password) costs exactly one, on at most
    // 128 code points, and answers "invalid".
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

    // No credentials; every guest shares the owner id "guest" and owns
    // nothing.
    async asGuest(client: string): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      return issue({ role: "guest", ownerId: GUEST_OWNER_ID }, now);
    },

    // Only the account the nightly reset made (its hash is DEMO_PASSWORD_HASH):
    // if DEMO_LOGIN_ID named a real member, this would let anyone into it.
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

    // Administrators only: the numeric GitHub id (never the login, which its
    // owner can rename and someone else can take) must be on
    // AUTH_ALLOWED_GITHUB_IDS. The login is kept for display only.
    async withGitHub(
      input: { code: string; verifier: string; redirectUri: string },
      client: string,
    ): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      if (deps.github === null) return failure("unavailable");
      const outcome = await deps.github.exchange(
        input.code,
        input.verifier,
        input.redirectUri,
      );
      if (!outcome.ok) return failure(outcome.reason);
      const ownerId = String(outcome.user.id);
      if (!deps.allowedGitHubIds.has(ownerId)) return failure("forbidden");
      return issue({ role: "admin", ownerId, login: outcome.user.login }, now);
    },

    // Any verified Sparklingstadt ID account may sign in (no
    // allowlist), as the member sid:<sub>; each sign-in records its email
    // and display name and reads the account's sessionVersion.
    async withSid(
      input: {
        code: string;
        verifier: string;
        redirectUri: string;
        nonce: string;
      },
      client: string,
    ): Promise<SignInResult> {
      const now = deps.now();
      if (!(await withinRouteLimit(client, now))) return failure("throttled");
      if (deps.sid === null) return failure("unavailable");
      const outcome = await deps.sid.exchange(
        input.code,
        input.verifier,
        input.redirectUri,
        input.nonce,
      );
      if (!outcome.ok) return failure(outcome.reason);
      const { sub, email, name } = outcome.user;
      // The client already checks the sub; checked again so no client can
      // make a malformed owner id.
      if (!SID_SUB_PATTERN.test(sub)) return failure("invalid");
      const { sessionVersion } = await deps.sidAccounts.upsert(
        { id: sub, email, displayName: sidDisplayName(name, email) },
        now,
      );
      return issue(
        { role: "member", ownerId: SID_OWNER_PREFIX + sub, sessionVersion },
        now,
      );
    },
  };
}
