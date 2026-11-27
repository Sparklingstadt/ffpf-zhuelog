// The Better Auth server: sessions, the rate limit, and the sign-in methods
// (members by login id and password, Sparklingstadt ID, guests, the demo).
// Served at /api/auth/* (src/app/api/auth/[...all]/route.ts).

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { admin, anonymous, genericOAuth, username } from "better-auth/plugins";

import {
  MAX_NEW_PASSWORD_UNITS,
  MIN_NEW_PASSWORD_UNITS,
} from "@/domain/identity/password-account";
import {
  AUTH_RATE_LIMIT,
  isAdminRole,
  isAllowedUsername,
  normalizeUsername,
  rejectsDemoPasswordChange,
  rejectsGuestImpersonation,
  rejectsImpersonatedPasswordChange,
  startsSession,
  withoutSessionCookie,
} from "@/infrastructure/auth/better-auth-rules";
import {
  betterAuthSecret,
  demoLoginId,
  sidOAuthConfig,
  siteUrl,
} from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { ScryptPasswordHasher } from "@/infrastructure/security/scrypt-password-hasher";

// `next build` imports every route module without the runtime environment,
// so it gets placeholders there (the database client connects only on its
// first query).
const building = process.env.NEXT_PHASE === "phase-production-build";
if (building)
  process.env.DATABASE_URL ??= "postgresql://build:build@localhost:5432/build";

// The same scrypt format as the password accounts, so their hashes keep
// verifying (tests/fixtures/scrypt-golden.json).
const hasher = new ScryptPasswordHasher();

const sid = sidOAuthConfig();

export const auth = betterAuth({
  // AUTH_URL's origin (local development falls back to localhost:3000).
  baseURL: siteUrl(),
  secret: building ? "build-time-placeholder" : betterAuthSecret(),
  database: prismaAdapter(prisma(), { provider: "postgresql" }),
  session: { expiresIn: 30 * 24 * 60 * 60 },
  account: {
    // A Sparklingstadt ID account is joined to a user only by its sub, never
    // by a matching mail address: otherwise whoever the ID server let claim
    // an administrator's address would become that administrator.
    accountLinking: { disableImplicitLinking: true },
  },
  emailAndPassword: {
    enabled: true,
    // Members are created by an administrator only.
    disableSignUp: true,
    // The app's rule for a new password (isValidNewPassword). Sign-in checks
    // only the maximum, so shorter passwords set before still sign in.
    minPasswordLength: MIN_NEW_PASSWORD_UNITS,
    maxPasswordLength: MAX_NEW_PASSWORD_UNITS,
    password: {
      hash: (password) => hasher.hash(password),
      verify: ({ hash, password }) => hasher.verify(password, hash),
    },
  },
  rateLimit: AUTH_RATE_LIMIT,
  // Errors that would go to Better Auth's own (English) error page, such as
  // an OAuth callback with a missing or unknown state, come back to the
  // sign-in page instead, which shows its generic Japanese message for any
  // ?error= it does not know.
  onAPIError: { errorURL: "/signin" },
  advanced: {
    // x-real-ip, else x-forwarded-for (Vercel overwrites both with the real
    // client address).
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
  },
  // Name and login id are not changed by members themselves (and the demo's
  // must not be changed at all). Members sign in by login id only: their mail
  // address (memberEmail) is guessable, and /sign-in/email would get its own
  // looser rate limit than /sign-in/username. Closed on the HTTP router only;
  // nothing here calls it on the server either.
  disabledPaths: ["/update-user", "/sign-in/email"],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // A sign-in starts from no session: the browser's previous session
      // cookie is dropped from the request (withoutSessionCookie).
      // Works around better-auth 1.7.28: the anonymous plugin's after-hook
      // on /sign-in* and /callback* calls getSessionFromCtx, whose
      // getSession on a stale cookie (signed out elsewhere, expired,
      // revoked) calls deleteSessionCookie; removeSetCookieEntries then
      // scrubs the Set-Cookie of the session the sign-in has just created,
      // so the sign-in answers 200 and leaves the browser signed out.
      // Remove once upstream fixes it. Side effect: a guest who signs in as
      // a member is not linked; the guest user is left to the nightly
      // cleanup.
      if (startsSession(ctx.path) && ctx.headers?.has("cookie")) {
        const headers = new Headers(ctx.headers);
        headers.set("cookie", withoutSessionCookie(ctx.headers.get("cookie")));
        return { context: { headers } };
      }
      if (ctx.path === "/change-password") {
        const session = await getSessionFromCtx<{ username?: string | null }>(
          ctx,
        );
        if (
          rejectsDemoPasswordChange(
            ctx.path,
            session?.user.username,
            demoLoginId(),
          ) ||
          rejectsImpersonatedPasswordChange(
            ctx.path,
            session?.session.impersonatedBy as string | null | undefined,
          )
        )
          throw new APIError("FORBIDDEN");
      }
      if (ctx.path === "/admin/impersonate-user") {
        // Anyone but an admin is left to the admin plugin (401 or 403), before
        // the target is looked up: nobody else learns whether an id is a
        // guest's.
        const session = await getSessionFromCtx<{ role?: string | null }>(ctx);
        if (!isAdminRole(session?.user.role)) return;
        const userId: unknown = ctx.body?.userId;
        const target =
          typeof userId === "string"
            ? await ctx.context.internalAdapter.findUserById(userId)
            : null;
        if (
          rejectsGuestImpersonation(
            ctx.path,
            target as { isAnonymous?: boolean | null } | null,
          )
        )
          throw new APIError("FORBIDDEN");
      }
    }),
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameNormalization: normalizeUsername,
      // Check the normalized id, so a typed "Alice" is checked as "alice".
      validationOrder: { username: "post-normalization" },
      usernameValidator: isAllowedUsername,
    }),
    // Always listed (with no provider when SID_* is unset): a plugin added
    // conditionally turns the plugins into a plain array, and the user and
    // session fields of the plugins (role, isAnonymous, impersonatedBy...)
    // drop out of getSession's type.
    genericOAuth({
      config: sid
        ? [
            {
              providerId: "sid",
              discoveryUrl: `${sid.issuer}/.well-known/openid-configuration`,
              clientId: sid.clientId,
              clientSecret: sid.clientSecret,
              scopes: ["openid", "email", "profile"],
              pkce: true,
              // The ID server takes the client secret as HTTP Basic
              // credentials (client_secret_basic).
              authentication: "basic",
              // Signing out of a Sparklingstadt ID session also ends it on the
              // ID server (its end_session_endpoint), which comes back here.
              // Registered there as a post-logout redirect URI.
              postLogoutRedirectURI: "/signin",
              // Without the issuer and JWKS from discovery the provider is
              // left out rather than accepting ID tokens unverified.
              requireIdTokenVerification: true,
            },
          ]
        : [],
    }),
    anonymous(),
    // Impersonating administrators stays refused (the plugin's default).
    admin(),
    // nextCookies must stay last: it lets Server Actions write the cookies
    // Better Auth sets.
    nextCookies(),
  ],
});

export type Auth = typeof auth;

// GET and POST for the /api/auth/[...all] route (better-auth is imported only
// under infrastructure/auth).
export const authHandler = toNextJsHandler(auth);
