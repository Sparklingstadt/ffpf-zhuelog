import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import type {
  IssuedPassword,
  MemberAccount,
} from "../../domain/identity/member-account";
import { isAdminRole } from "../../domain/identity/roles";
import {
  checkNewAccount,
  choosePassword,
  isAccountIdShape,
  memberEmail,
  type AccountInputError,
  type PasswordChoice,
} from "../../domain/identity/password-account";

// Only admins manage member accounts (not while impersonating a member: the
// admin is then that member).
export class AccountAdminForbiddenError extends Error {
  override name = "AccountAdminForbiddenError";
}

export type CreateAccountResult =
  | { ok: true; issued: IssuedPassword }
  | { ok: false; reason: AccountInputError | "login-id-taken" };

// "not-found" is a missing user, a user who is not a member with a login id
// (an admin, a guest, a Sparklingstadt ID member), and an id no user could
// have.
// sessionsEnded false: the password was replaced, but ending the member's
// sessions failed (sessionsError), so other browsers may still be signed in.
export type ResetPasswordResult =
  | { ok: true; issued: IssuedPassword; sessionsEnded: true }
  | {
      ok: true;
      issued: IssuedPassword;
      sessionsEnded: false;
      sessionsError: unknown;
    }
  | { ok: false; reason: "password" | "not-found" };

// A user as Better Auth's admin API answers it (the fields used here).
export type AdminApiUser = {
  id: string;
  name: string;
  username?: string | null;
  role?: string | null;
  isAnonymous?: boolean | null;
  createdAt: Date;
};

// The part of Better Auth's admin plugin used here (auth.api), always called
// with the admin's own request headers: Better Auth checks the session's role
// again. Errors are Better Auth's APIError (status and body.code).
export type MemberAccountsDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  headers: () => Promise<Headers>;
  api: {
    listUsers(input: {
      query: {
        filterField: "isAnonymous";
        filterValue: false;
        sortBy: "createdAt";
        sortDirection: "asc";
        limit: number;
        offset: number;
      };
      headers: Headers;
    }): Promise<{ users: AdminApiUser[] }>;
    getUser(input: {
      query: { id: string };
      headers: Headers;
    }): Promise<AdminApiUser>;
    createUser(input: {
      body: {
        email: string;
        password: string;
        name: string;
        data: { username: string };
      };
      headers: Headers;
    }): Promise<unknown>;
    setUserPassword(input: {
      body: { userId: string; newPassword: string };
      headers: Headers;
    }): Promise<unknown>;
    revokeUserSessions(input: {
      body: { userId: string };
      headers: Headers;
    }): Promise<unknown>;
  };
  generatePassword: () => string;
};

// Users asked for per listUsers call (Better Auth's Prisma adapter answers at
// most 100 when no limit is given).
const LIST_PAGE_SIZE = 100;

const TAKEN_CODES = new Set([
  // The username plugin: the login id is taken.
  "USERNAME_IS_ALREADY_TAKEN",
  // The admin plugin: the member mail address (made from the login id) is.
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
]);

function errorCode(error: unknown): string | undefined {
  const body = (error as { body?: { code?: unknown } } | null)?.body;
  return typeof body?.code === "string" ? body.code : undefined;
}

// A member: neither an admin nor a guest.
function isMember(user: AdminApiUser): boolean {
  return user.isAnonymous !== true && !isAdminRole(user.role);
}

// The admin's management of member accounts, through Better Auth's admin
// plugin: the caller is checked first (requireAdmin runs before any input
// check), then the input. The plain password leaves only in `issued`, for the
// admin to hand over once; Better Auth hashes it.
export function createMemberAccounts(deps: MemberAccountsDeps) {
  async function requireAdmin(): Promise<void> {
    const user = await deps.currentUser();
    if (user?.role !== "admin") throw new AccountAdminForbiddenError();
  }

  function issue(choice: PasswordChoice) {
    return choice.generate
      ? { password: deps.generatePassword(), generated: true }
      : { password: choice.password, generated: false };
  }

  // The member with a login id (and so a password here), or null.
  async function passwordMember(
    userId: string,
    headers: Headers,
  ): Promise<{ id: string; loginId: string } | null> {
    let user: AdminApiUser;
    try {
      user = await deps.api.getUser({ query: { id: userId }, headers });
    } catch (error) {
      if ((error as { status?: unknown } | null)?.status === "NOT_FOUND")
        return null;
      throw error;
    }
    return isMember(user) && user.username
      ? { id: user.id, loginId: user.username }
      : null;
  }

  return {
    // Every member (the demo's and Sparklingstadt ID members too), oldest
    // first: listUsers is asked page by page until a page comes back short
    // (or brings no user not seen yet).
    async list(): Promise<MemberAccount[]> {
      await requireAdmin();
      const headers = await deps.headers();
      const seen = new Map<string, AdminApiUser>();
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { users } = await deps.api.listUsers({
          query: {
            filterField: "isAnonymous",
            filterValue: false,
            sortBy: "createdAt",
            sortDirection: "asc",
            limit: LIST_PAGE_SIZE,
            offset,
          },
          headers,
        });
        const before = seen.size;
        for (const user of users)
          if (!seen.has(user.id)) seen.set(user.id, user);
        if (users.length < LIST_PAGE_SIZE || seen.size === before) break;
      }
      return [...seen.values()].filter(isMember).map((user) => ({
        id: user.id,
        loginId: user.username ?? null,
        displayName: user.name,
        createdAt: user.createdAt,
      }));
    },

    async create(raw: {
      loginId: string;
      displayName: string;
      password: string;
    }): Promise<CreateAccountResult> {
      await requireAdmin();
      const input = checkNewAccount(raw);
      if (!input.ok) return { ok: false, reason: input.error };
      const { password, generated } = issue(input.password);
      try {
        await deps.api.createUser({
          body: {
            email: memberEmail(input.loginId),
            password,
            name: input.displayName,
            data: { username: input.loginId },
          },
          headers: await deps.headers(),
        });
      } catch (error) {
        const code = errorCode(error);
        if (code && TAKEN_CODES.has(code))
          return { ok: false, reason: "login-id-taken" };
        throw error;
      }
      return {
        ok: true,
        issued: { loginId: input.loginId, password, generated },
      };
    },

    // The password is checked before the id. Then the member's password is
    // replaced and every session of theirs ends (they sign in again with the
    // new one). Nothing refuses the demo's account. The id is bound into a
    // server action, so the client can send any value: a non-string is an id
    // no user could have.
    async resetPassword(
      userId: string,
      rawPassword: string,
    ): Promise<ResetPasswordResult> {
      await requireAdmin();
      const choice = choosePassword(rawPassword);
      if (!choice) return { ok: false, reason: "password" };
      if (typeof userId !== "string" || !isAccountIdShape(userId))
        return { ok: false, reason: "not-found" };
      const headers = await deps.headers();
      const target = await passwordMember(userId, headers);
      if (!target) return { ok: false, reason: "not-found" };
      const { password, generated } = issue(choice);
      await deps.api.setUserPassword({
        body: { userId: target.id, newPassword: password },
        headers,
      });
      const issued = { loginId: target.loginId, password, generated };
      // The new password must still reach the admin when the sessions
      // cannot be ended: the caller says so (and logs it).
      try {
        await deps.api.revokeUserSessions({
          body: { userId: target.id },
          headers,
        });
      } catch (sessionsError) {
        return { ok: true, issued, sessionsEnded: false, sessionsError };
      }
      return { ok: true, issued, sessionsEnded: true };
    },
  };
}
