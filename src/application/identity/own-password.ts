import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";
import {
  CURRENT_PASSWORD_MAX_CODE_POINTS,
  firstCodePoints,
  isPlausibleCurrentPassword,
  isValidNewPassword,
} from "../../domain/identity/password-account";
import {
  AUTH_ROUTE_THROTTLE,
  PASSWORD_CHANGE_THROTTLE,
  authRouteThrottleKey,
  passwordChangeThrottleKey,
  type ThrottleRule,
} from "../../domain/identity/sign-in-throttle";

// "invalid-current-password" is every failure about the current password
// (no account, locked, implausible, wrong, replaced meanwhile), so they
// cannot be told apart.
export type ChangePasswordOutcome =
  | "changed"
  | "forbidden"
  | "rate-limited"
  | "invalid-new-password"
  | "password-mismatch"
  | "invalid-current-password";

export type OwnPasswordDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  accounts: {
    credentials(
      id: string,
    ): Promise<{ id: string; passwordHash: string } | null>;
    // false: the account is gone or its hash is no longer expectedHash.
    replacePassword(
      id: string,
      expectedHash: string,
      passwordHash: string,
      now: Date,
    ): Promise<boolean>;
  };
  passwords: {
    hash(password: string): Promise<string>;
    verify(password: string, passwordHash: string): Promise<boolean>;
    simulate(password: string): Promise<void>;
  };
  throttle: {
    // Counts one attempt; true while within the rule.
    consume(key: string, rule: ThrottleRule, now: Date): Promise<boolean>;
    reset(key: string): Promise<void>;
  };
  now: () => Date;
};

// A member's own password change, in the order of Go's ChangePassword
// (services/api/auth/password_change.go). Only a
// password member who is not the demo may change; an admin, acting or not,
// and a Sparklingstadt ID member may not. Every current-password failure costs
// exactly one scrypt (verify, or simulate on at most 128 code points) and
// gives the same answer. A change bumps the account's sessionVersion, which
// revokes every session of the member.
export function createOwnPassword(deps: OwnPasswordDeps) {
  return {
    async change(
      input: {
        currentPassword: string;
        newPassword: string;
        confirmPassword: string;
      },
      client: string,
    ): Promise<ChangePasswordOutcome> {
      const now = deps.now();
      const user = await deps.currentUser();
      if (
        user?.role !== "member" ||
        user.demo === true ||
        !user.githubId?.startsWith("password:") ||
        !user.accountId
      )
        return "forbidden";
      const accountId = user.accountId;

      if (
        !(await deps.throttle.consume(
          authRouteThrottleKey(client),
          AUTH_ROUTE_THROTTLE,
          now,
        ))
      )
        return "rate-limited";

      const { currentPassword, newPassword, confirmPassword } = input;
      if (!isValidNewPassword(newPassword)) return "invalid-new-password";
      if (newPassword !== confirmPassword) return "password-mismatch";

      const reject = async (): Promise<ChangePasswordOutcome> => {
        await deps.passwords.simulate(
          firstCodePoints(currentPassword, CURRENT_PASSWORD_MAX_CODE_POINTS),
        );
        return "invalid-current-password";
      };

      const account = await deps.accounts.credentials(accountId);
      if (!account) return reject();
      const changeKey = passwordChangeThrottleKey(account.id);
      if (
        !(await deps.throttle.consume(
          changeKey,
          PASSWORD_CHANGE_THROTTLE,
          now,
        )) ||
        !isPlausibleCurrentPassword(currentPassword)
      )
        return reject();
      if (!(await deps.passwords.verify(currentPassword, account.passwordHash)))
        return "invalid-current-password";

      const replaced = await deps.accounts.replacePassword(
        account.id,
        account.passwordHash,
        await deps.passwords.hash(newPassword),
        now,
      );
      if (!replaced) return "invalid-current-password";
      await deps.throttle.reset(changeKey);
      return "changed";
    },
  };
}
