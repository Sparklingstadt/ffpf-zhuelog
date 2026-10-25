import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import { GoApiError, type GoMe } from "./client";

// Asks the Go API who holds the access token. The caller wraps this in
// React's cache() so a request calls GET /v1/me at most once.
//
// With the act-as cookie, it asks as that member first. Go answers with
// actingAs only when it honours the header; otherwise (an older API, or Go
// refusing the member with 400/403/404) the admin is shown as themself with
// actAsIgnored, so nobody mistakes their own records for the member's.
export class GoApiCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly readAccessToken: () => Promise<string | undefined>,
    private readonly me: (token: string, actAs?: string) => Promise<GoMe>,
    private readonly readActAs: () => Promise<string | undefined> = async () =>
      undefined,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const token = await this.readAccessToken();
    if (!token) return null;
    const actAs = await this.readActAs();

    let me: GoMe | undefined;
    try {
      if (actAs) me = await this.meActingAs(token, actAs);
      me ??= await this.me(token);
    } catch (error) {
      // 401: the token is not (or no longer) valid, e.g. after a password
      // change bumped sessionVersion. 403: the user lost access.
      if (error instanceof GoApiError && error.status === 401) return null;
      if (error instanceof GoApiError && error.status === 403)
        return { githubLogin: "", role: "revoked" };
      throw error;
    }

    // Guests carry no githubId, so they own no records.
    if (me.role === "guest") return { githubLogin: me.login, role: "guest" };
    const user: AuthenticatedUser = {
      githubLogin: me.login,
      githubId: me.ownerId,
      role: me.role,
    };
    if (me.role === "admin" && actAs) {
      if (me.actingAs?.ownerId === actAs && me.ownerId === actAs) {
        const { ownerId, loginId, displayName } = me.actingAs;
        return { ...user, actingAs: { ownerId, loginId, displayName } };
      }
      return { ...user, actAsIgnored: true };
    }
    if (me.role !== "member") return user;
    return { ...user, displayName: me.displayName, accountId: me.accountId };
  }

  // Undefined when Go refuses the member, so the caller asks again as the
  // admin themself.
  private async meActingAs(
    token: string,
    actAs: string,
  ): Promise<GoMe | undefined> {
    try {
      return await this.me(token, actAs);
    } catch (error) {
      if (error instanceof GoApiError && [400, 403, 404].includes(error.status))
        return undefined;
      throw error;
    }
  }
}
