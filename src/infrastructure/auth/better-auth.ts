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
  isAllowedUsername,
  normalizeUsername,
  rejectsDemoPasswordChange,
  rejectsGuestImpersonation,
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
  advanced: {
    // The same headers as client-address.ts: x-real-ip, else x-forwarded-for.
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
  },
  // Name and login id are not changed by members themselves (and the demo's
  // must not be changed at all).
  disabledPaths: ["/update-user"],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/change-password") {
        const session = await getSessionFromCtx<{ username?: string | null }>(
          ctx,
        );
        if (
          rejectsDemoPasswordChange(
            ctx.path,
            session?.user.username,
            demoLoginId(),
          )
        )
          throw new APIError("FORBIDDEN");
      }
      if (ctx.path === "/admin/impersonate-user") {
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
