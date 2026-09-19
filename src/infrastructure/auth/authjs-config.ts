import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { isAllowedGitHubLogin } from "@/infrastructure/auth/github-login-policy";

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
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    signIn({ account, profile }) {
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
      session.user.role = token.role === "admin" ? "admin" : "user";
      return session;
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;
      const isPublicRoute =
        pathname.startsWith("/signin") || pathname.startsWith("/api/auth");
      return isPublicRoute || session?.user.role === "admin";
    },
  },
});
