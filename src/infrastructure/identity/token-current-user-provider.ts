import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import type { AccessClaims } from "./access-token";

export type IdentityAccount = {
  id: string;
  loginId: string;
  displayName: string;
  passwordHash: string;
  sessionVersion: number;
};

export type FfpfIdentityAccount = {
  id: string;
  email: string;
  displayName: string;
  sessionVersion: number;
};

// What the provider needs from the account tables. Implemented by the DB
// adapter in this layer.
export interface IdentityAccounts {
  findPasswordAccount(id: string): Promise<IdentityAccount | null>;
  findFfpfAccount(id: string): Promise<FfpfIdentityAccount | null>;
}

export type TokenIdentityConfig = {
  allowedGitHubIds: ReadonlySet<string>;
  demoLoginId?: string;
};

const PASSWORD_PREFIX = "password:";
const FFPF_PREFIX = "ffpf:";
const DEMO_PASSWORD_HASH = "demo:no-password";
const ACT_AS_PATTERN = /^password:[a-z0-9]{1,64}$/;

// Decides who is signed in from the access token and the account tables,
// following the Go API's Authenticate and Me (services/api/auth). The caller
// wraps this in React's cache() so a request resolves the user at most once.
export class TokenCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly readAccessToken: () => Promise<string | undefined>,
    private readonly readActAs: () => Promise<string | undefined>,
    private readonly verify: (token: string) => AccessClaims | null,
    private readonly accounts: IdentityAccounts,
    private readonly config: TokenIdentityConfig,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const token = await this.readAccessToken();
    if (!token) return null;
    const claims = this.verify(token);
    if (!claims) return null;

    switch (claims.role) {
      case "guest":
        // Guests carry no githubId, so they own no records.
        return { githubLogin: "guest", role: "guest" };
      case "admin":
        return this.adminUser(claims);
      case "member":
        return this.memberUser(claims);
      default:
        return null;
    }
  }

  private async adminUser(
    claims: Extract<AccessClaims, { role: "admin" }>,
  ): Promise<AuthenticatedUser> {
    if (!this.config.allowedGitHubIds.has(claims.ownerId))
      return { githubLogin: "", role: "revoked" };
    const own: AuthenticatedUser = {
      githubLogin: claims.login,
      githubId: claims.ownerId,
      role: "admin",
    };
    const actAs = await this.readActAs();
    if (!actAs) return own;

    const account = ACT_AS_PATTERN.test(actAs)
      ? await this.accounts.findPasswordAccount(
          actAs.slice(PASSWORD_PREFIX.length),
        )
      : null;
    if (!account) return { ...own, actAsIgnored: true };
    return {
      ...own,
      githubId: actAs,
      actingAs: {
        ownerId: actAs,
        loginId: account.loginId,
        displayName: account.displayName,
      },
      actorId: claims.ownerId,
    };
  }

  private async memberUser(
    claims: Extract<AccessClaims, { role: "member" }>,
  ): Promise<AuthenticatedUser | null> {
    const { ownerId, sessionVersion } = claims;
    if (ownerId.startsWith(FFPF_PREFIX)) {
      const id = ownerId.slice(FFPF_PREFIX.length);
      if (!id) return null;
      const account = await this.accounts.findFfpfAccount(id);
      if (!account || account.sessionVersion !== sessionVersion) return null;
      return {
        githubLogin: account.email,
        githubId: ownerId,
        role: "member",
        displayName: account.displayName,
      };
    }
    if (ownerId.startsWith(PASSWORD_PREFIX)) {
      const id = ownerId.slice(PASSWORD_PREFIX.length);
      if (!id) return null;
      const account = await this.accounts.findPasswordAccount(id);
      if (!account || account.sessionVersion !== sessionVersion) return null;
      return {
        githubLogin: account.loginId,
        githubId: ownerId,
        role: "member",
        displayName: account.displayName,
        accountId: account.id,
        ...(this.isDemo(account) ? { demo: true } : {}),
      };
    }
    return null;
  }

  private isDemo(account: IdentityAccount): boolean {
    return (
      account.passwordHash === DEMO_PASSWORD_HASH ||
      (!!this.config.demoLoginId && account.loginId === this.config.demoLoginId)
    );
  }
}
