import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import type {
  IssuedPassword,
  MemberAccount,
} from "../../domain/identity/member-account";
import {
  checkNewAccount,
  choosePassword,
  isAccountIdShape,
  type AccountInputError,
  type PasswordChoice,
} from "../../domain/identity/password-account";

// Only admins manage member accounts (an admin acting as a member too).
export class AccountAdminForbiddenError extends Error {
  override name = "AccountAdminForbiddenError";
}

export type CreateAccountResult =
  | { ok: true; issued: IssuedPassword }
  | { ok: false; reason: AccountInputError | "login-id-taken" };

// "not-found" covers an id no account could have, as Go's validID answered
// 404 like a missing account.
export type ResetPasswordResult =
  | { ok: true; issued: IssuedPassword }
  | { ok: false; reason: "password" | "not-found" };

export type MemberAccountsDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  store: {
    list(): Promise<MemberAccount[]>;
    // null: the loginId is taken.
    create(
      input: { loginId: string; displayName: string; passwordHash: string },
      now: Date,
    ): Promise<MemberAccount | null>;
    loginIdOf(id: string): Promise<string | null>;
    // The loginId, or null when no account has the id.
    setPassword(
      id: string,
      passwordHash: string,
      now: Date,
    ): Promise<string | null>;
  };
  hashPassword: (password: string) => Promise<string>;
  generatePassword: () => string;
  now: () => Date;
};

// Password accounts as Go's admin account routes managed them
// (services/api/httpapi/admin_handlers.go): the caller is checked first (Go's
// requireAdmin ran before any input check), then the input in Go's order. The plain password leaves only in `issued`,
// for the admin to hand over once.
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

  return {
    // Every password account (the demo's too), oldest first.
    async list(): Promise<MemberAccount[]> {
      await requireAdmin();
      return deps.store.list();
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
      const created = await deps.store.create(
        {
          loginId: input.loginId,
          displayName: input.displayName,
          passwordHash: await deps.hashPassword(password),
        },
        deps.now(),
      );
      if (!created) return { ok: false, reason: "login-id-taken" };
      return {
        ok: true,
        issued: { loginId: created.loginId, password, generated },
      };
    },

    // The password is checked before the id, as Go did. A missing account
    // costs no hash. Nothing refuses the demo's account or the member the
    // admin acts as, as in Go.
    async resetPassword(
      accountId: string,
      rawPassword: string,
    ): Promise<ResetPasswordResult> {
      await requireAdmin();
      const choice = choosePassword(rawPassword);
      if (!choice) return { ok: false, reason: "password" };
      if (!isAccountIdShape(accountId))
        return { ok: false, reason: "not-found" };
      if ((await deps.store.loginIdOf(accountId)) === null)
        return { ok: false, reason: "not-found" };
      const { password, generated } = issue(choice);
      const loginId = await deps.store.setPassword(
        accountId,
        await deps.hashPassword(password),
        deps.now(),
      );
      if (loginId === null) return { ok: false, reason: "not-found" };
      return { ok: true, issued: { loginId, password, generated } };
    },
  };
}
