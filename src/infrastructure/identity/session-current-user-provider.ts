import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import { DEMO_PASSWORD_HASH } from "@/domain/identity/demo-account";
import type { AuthenticatedUser } from "@/domain/identity/entities/authenticated-user";
import type { SessionPrincipal } from "@/domain/identity/session";

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

export type SessionIdentityConfig = {
  allowedGitHubIds: ReadonlySet<string>;
  demoLoginId?: string;
};

const PASSWORD_PREFIX = "password:";
const FFPF_PREFIX = "ffpf:";
// The only ownerIds an admin may act as. startActingAs checks the same shape
// before it writes zl_act_as.
export const ACT_AS_PATTERN = /^password:[a-z0-9]{1,64}$/;

// Decides who is signed in from the zl_session cookie's Session row and the
// account tables, following the retired Go API's Authenticate and Me
// (services/api/auth). findSession answers null for an unknown, expired,
// deleted or malformed session. Every rule below runs on every request, so a
// change to an account's sessionVersion or to zl_act_as applies at once. The
// allowlist and the demo login id come in through config, which the caller
// reads once when its module loads, so a change to them applies after a
// redeploy. The caller wraps this in React's cache() so a request resolves the
// user at most once.
export class SessionCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly readSessionToken: () => Promise<string | undefined>,
    private readonly readActAs: () => Promise<string | undefined>,
    private readonly findSession: (
      token: string,
    ) => Promise<SessionPrincipal | null>,
    private readonly accounts: IdentityAccounts,
    private readonly config: SessionIdentityConfig,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    const token = await this.readSessionToken();
    if (!token) return null;
    const principal = await this.findSession(token);
    if (!principal) return null;

    switch (principal.role) {
      case "guest":
        // Guests carry no githubId, so they own no records.
        return { githubLogin: "guest", role: "guest" };
      case "admin":
        return this.adminUser(principal);
      case "member":
        return this.memberUser(principal);
      default:
        return null;
    }
  }

  private async adminUser(
    principal: Extract<SessionPrincipal, { role: "admin" }>,
  ): Promise<AuthenticatedUser> {
    if (!this.config.allowedGitHubIds.has(principal.ownerId))
      return { githubLogin: "", role: "revoked" };
    const own: AuthenticatedUser = {
      githubLogin: principal.login,
      githubId: principal.ownerId,
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
      actorId: principal.ownerId,
    };
  }

  private async memberUser(
    principal: Extract<SessionPrincipal, { role: "member" }>,
  ): Promise<AuthenticatedUser | null> {
    const { ownerId, sessionVersion } = principal;
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
