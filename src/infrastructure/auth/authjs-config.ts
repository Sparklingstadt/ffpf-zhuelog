import { AuthenticatePasswordAccount } from "@ffpf-zhuelog/core/application/identity/use-cases/authenticate-password-account";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { isAllowedGitHubLogin } from "@/infrastructure/auth/github-login-policy";
import {
  githubIdFromAccount,
  githubIdFromToken,
  passwordOwnerId,
} from "./github-identity";
import {
  passwordAccountRepository,
  passwordHasher,
} from "./password-account-services";
import { resolveSessionRole } from "./session-role-policy";

const authenticatePasswordAccount = new AuthenticatePasswordAccount(
  passwordAccountRepository,
  passwordHasher,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
          role: isAllowedGitHubLogin(profile.login) ? "admin" : "revoked",
        };
      },
    }),
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      authorize() {
        return {
          id: "guest",
          name: "ゲスト",
          email: null,
          image: null,
          githubLogin: "guest",
          role: "guest",
        };
      },
    }),
    Credentials({
      id: "password",
      name: "Password",
      credentials: { loginId: {}, password: {} },
      // Wrong credentials return null (Auth.js reports CredentialsSignin).
      // Infrastructure errors propagate so they are not mistaken for a wrong
      // password. Never log the credentials.
      async authorize(credentials) {
        const account = await authenticatePasswordAccount.execute({
          loginId: credentials.loginId,
          password: credentials.password,
        });
        if (!account) return null;
        return {
          id: account.id,
          name: account.displayName,
          email: null,
          image: null,
          githubLogin: account.loginId,
          role: "member",
          accountId: account.id,
          sessionVersion: account.sessionVersion,
        };
      },
    }),
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    signIn({ account, profile, user }) {
      if (account?.provider === "guest") return user.role === "guest";
      if (account?.provider === "password") return user.role === "member";
      return (
        account?.provider === "github" &&
        typeof profile?.login === "string" &&
        isAllowedGitHubLogin(profile.login)
      );
    },
    jwt({ token, user, account }) {
      if (user) {
        token.githubLogin = user.githubLogin;
        token.role = user.role;
        token.accountId = user.accountId;
        token.sessionVersion = user.sessionVersion;
        token.githubId =
          passwordOwnerId(user.accountId) ?? githubIdFromAccount(account);
      }
      return token;
    },
    session({ session, token }) {
      session.user.githubLogin =
        typeof token.githubLogin === "string" ? token.githubLogin : "";
      session.user.githubId = githubIdFromToken(token.githubId);
      session.user.role = resolveSessionRole(token.role, token.githubLogin);
      session.user.accountId =
        typeof token.accountId === "string" ? token.accountId : undefined;
      session.user.sessionVersion =
        typeof token.sessionVersion === "number"
          ? token.sessionVersion
          : undefined;
      return session;
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;
      const isPublicRoute =
        // These exact endpoints enforce their own auth: LINE HMAC for the
        // webhook, the CRON_SECRET bearer token for the cron drain.
        pathname === "/api/line/webhook" ||
        pathname === "/api/line/drain" ||
        pathname === "/signin" ||
        pathname.startsWith("/api/auth/");
      const permitted =
        isPublicRoute ||
        session?.user.role === "admin" ||
        session?.user.role === "member" ||
        session?.user.role === "guest";
      if (permitted) return true;
      if (pathname.startsWith("/api/")) {
        return Response.json(
          { error: "認証が必要です。" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      // Server Actions perform their own authorization. Let them return the
      // typed denial; a proxy HTML redirect is not a valid action response.
      // This header is only protocol detection, never an authorization grant.
      if (request.method === "POST" && request.headers.has("next-action"))
        return true;
      const signInUrl = new URL("/signin", request.nextUrl.origin);
      signInUrl.searchParams.set(
        "callbackUrl",
        `${pathname}${request.nextUrl.search}`,
      );
      // Explicit Response is important when auth() wraps a custom proxy handler.
      return Response.redirect(signInUrl);
    },
  },
});
