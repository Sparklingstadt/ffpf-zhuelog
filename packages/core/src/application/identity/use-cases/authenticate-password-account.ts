import { z } from "zod";
import {
  isLocked,
  loginIdSchema,
  type PasswordAccount,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";

// Login accepts any non-empty password up to the cap so that accounts keep
// working if the minimum length rule ever changes; it only bounds hashing cost.
const credentialsSchema = z.object({
  loginId: loginIdSchema,
  password: z.string().min(1).max(128),
});

export class AuthenticatePasswordAccount {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(
    input: { loginId: unknown; password: unknown },
    now = new Date(),
  ): Promise<PasswordAccount | null> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) {
      await this.hasher.simulateVerify(
        String(input.password ?? "").slice(0, 128),
      );
      return null;
    }
    const { loginId, password } = parsed.data;

    const account = await this.accounts.findByLoginId(loginId);
    if (!account) {
      await this.hasher.simulateVerify(password);
      return null;
    }
    if (isLocked(account, now)) return null;

    if (!(await this.hasher.verify(password, account.passwordHash))) {
      await this.accounts.recordFailure(account.id, now);
      return null;
    }
    if (account.failedAttempts > 0)
      await this.accounts.clearFailures(account.id);
    return account;
  }
}
