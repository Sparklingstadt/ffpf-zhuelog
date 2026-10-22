import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";
import { toDate } from "./learning-json";

export type MemberAccount = {
  id: string;
  ownerId: string;
  loginId: string;
  displayName: string;
  createdAt: Date;
};

// The password to hand to the member once: the one the admin typed, or a
// generated one when the field was left blank.
export type IssuedPassword = {
  loginId: string;
  password: string;
  generated: boolean;
};

type AccountJson = Omit<MemberAccount, "createdAt"> & { createdAt: string };

function toMemberAccount(json: AccountJson): MemberAccount {
  return {
    id: json.id,
    ownerId: json.ownerId,
    loginId: json.loginId,
    displayName: json.displayName,
    createdAt: toDate(json.createdAt),
  };
}

// Password accounts (admin only in Go) and a member's own password change.
// Go validates every field; its 400/409 messages are meant for the form.
// Passwords travel in request and response bodies only, never in paths.
export function createAccountGateway(call: GoApiCall = goApiAuthed) {
  return {
    async listAccounts(): Promise<MemberAccount[]> {
      const json = await call<{ accounts: AccountJson[] }>(
        "/v1/admin/accounts",
        { method: "GET" },
      );
      return json.accounts.map(toMemberAccount);
    },

    async createAccount(input: {
      loginId: string;
      displayName: string;
      password: string;
    }): Promise<IssuedPassword> {
      const json = await call<{
        account: AccountJson;
        password: string;
        generated: boolean;
      }>("/v1/admin/accounts", { method: "POST", body: input });
      return {
        loginId: json.account.loginId,
        password: json.password,
        generated: json.generated,
      };
    },

    // null when the account no longer exists (Go answers 404).
    async resetPassword(
      accountId: string,
      password: string,
    ): Promise<IssuedPassword | null> {
      try {
        const json = await call<IssuedPassword>(
          `/v1/admin/accounts/${encodeURIComponent(accountId)}/password`,
          { method: "POST", body: { password } },
        );
        return {
          loginId: json.loginId,
          password: json.password,
          generated: json.generated,
        };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },

    // Go throttles wrong current passwords per account and revokes every
    // session of the member on success, so the caller signs out afterwards.
    async changeOwnPassword(
      input: {
        currentPassword: string;
        newPassword: string;
        confirmPassword: string;
      },
      clientIp: string,
    ): Promise<void> {
      await call<unknown>("/v1/account/password", {
        method: "POST",
        body: input,
        clientIp,
      });
    },
  };
}

export type AccountGateway = ReturnType<typeof createAccountGateway>;
