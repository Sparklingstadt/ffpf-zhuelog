import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { GoApiError, type GoMe } from "./client";

// Asks the Go API who holds the access token. The caller wraps this in
// React's cache() so a request calls GET /v1/me at most once.
export class GoApiCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly readAccessToken: () => Promise<string | undefined>,
    private readonly me: (token: string) => Promise<GoMe>,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const token = await this.readAccessToken();
    if (!token) return null;

    let me: GoMe;
    try {
      me = await this.me(token);
    } catch (error) {
      // 401: the token is not (or no longer) valid, e.g. after a password
      // change bumped sessionVersion. 403: the user lost access.
      if (error instanceof GoApiError && error.status === 401) return null;
      if (error instanceof GoApiError && error.status === 403)
        return { githubLogin: "", role: "revoked" };
      throw error;
    }

    // Guests carry no githubId, as with Auth.js.
    if (me.role === "guest") return { githubLogin: me.login, role: "guest" };
    const user: AuthenticatedUser = {
      githubLogin: me.login,
      githubId: me.ownerId,
      role: me.role,
    };
    if (me.role !== "member") return user;
    return { ...user, displayName: me.displayName, accountId: me.accountId };
  }
}
