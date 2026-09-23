import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { isAllowedGitHubLogin } from "@/infrastructure/auth/github-login-policy";
import { resolveSessionRole } from "./session-role-policy";

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
          role: isAllowedGitHubLogin(profile.login) ? "admin" : "user",
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
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    signIn({ account, profile, user }) {
      if (account?.provider === "guest") return user.role === "guest";
      return (
        account?.provider === "github" &&
        typeof profile?.login === "string" &&
        isAllowedGitHubLogin(profile.login)
      );
    },
    jwt({ token, user }) {
      if (user) {
        token.githubLogin = user.githubLogin;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.githubLogin =
        typeof token.githubLogin === "string" ? token.githubLogin : "";
      session.user.role = resolveSessionRole(token.role, token.githubLogin);
      return session;
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;
      const isPublicRoute =
        // These exact endpoints enforce LINE HMAC / worker Bearer auth themselves.
        pathname === "/api/line/webhook" ||
        pathname === "/api/line/worker" ||
        pathname === "/signin" ||
        pathname.startsWith("/api/auth/");
      const permitted =
        isPublicRoute ||
        session?.user.role === "admin" ||
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
