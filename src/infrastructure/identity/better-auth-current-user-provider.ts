import type { CurrentUserProvider } from "@/application/identity/ports/current-user-provider";
import type {
  AppRole,
  AuthenticatedUser,
} from "@/domain/identity/entities/authenticated-user";

// The part of Better Auth's getSession answer (with the username, anonymous
// and admin plugins) that decides who is signed in. Kept structural so this
// module never loads the Better Auth server (src/infrastructure/auth).
export type BetterAuthSession = {
  user: {
    id: string;
    name: string;
    role?: string | null;
    isAnonymous?: boolean | null;
    banned?: boolean | null;
    username?: string | null;
  };
  session: { impersonatedBy?: string | null };
};

function roleOf(user: BetterAuthSession["user"]): AppRole {
  if (user.isAnonymous === true) return "guest";
  return user.role === "admin" ? "admin" : "member";
}

// Who a Better Auth session is: null for no session or a banned user. An
// anonymous user is a guest whatever their role; role "admin" is an admin;
// everyone else is a member. The demo account is the member whose login id is
// DEMO_LOGIN_ID (none when it is unset).
export function toAuthenticatedUser(
  session: BetterAuthSession | null,
  demoLoginId: string | undefined,
): AuthenticatedUser | null {
  if (!session) return null;
  const { user } = session;
  if (user.banned === true) return null;
  const role = roleOf(user);
  const username = role === "guest" ? undefined : user.username || undefined;
  const impersonatedBy = session.session.impersonatedBy || undefined;
  return {
    userId: user.id,
    role,
    displayName: user.name,
    ...(username ? { username } : {}),
    ...(username && demoLoginId && username === demoLoginId
      ? { demo: true }
      : {}),
    ...(impersonatedBy ? { impersonatedBy } : {}),
  };
}

// Decides who is signed in from the request's Better Auth session.
// getSession reads the session cookie and the database on every call (the
// caller wraps this in React's cache() so a request does it at most once).
// The demo login id comes in from the caller, read once when its module
// loads.
export class BetterAuthCurrentUserProvider implements CurrentUserProvider {
  constructor(
    private readonly getSession: () => Promise<BetterAuthSession | null>,
    private readonly demoLoginId: string | undefined,
  ) {}

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    return toAuthenticatedUser(await this.getSession(), this.demoLoginId);
  }
}
