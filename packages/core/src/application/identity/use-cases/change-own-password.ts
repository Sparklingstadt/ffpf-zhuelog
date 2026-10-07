import { z } from "zod";
import {
  isLocked,
  passwordSchema,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";

const newPasswordSchema = z.object({ newPassword: passwordSchema });
const currentPasswordSchema = z.string().min(1).max(128);

export class ChangeOwnPassword {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(
    accountId: string,
    input: {
      currentPassword: unknown;
      newPassword: unknown;
      confirmPassword: unknown;
    },
    now = new Date(),
  ): Promise<"changed" | "invalid-current" | "mismatch"> {
    const { newPassword } = newPasswordSchema.parse({
      newPassword: input.newPassword,
    });
    if (newPassword !== input.confirmPassword) return "mismatch";

    const account = await this.accounts.findById(accountId);
    if (!account || isLocked(account, now)) return "invalid-current";

    const current = currentPasswordSchema.safeParse(input.currentPassword);
    if (
      !current.success ||
      !(await this.hasher.verify(current.data, account.passwordHash))
    ) {
      await this.accounts.recordFailure(account.id, now);
      return "invalid-current";
    }

    await this.accounts.setPassword(
      account.id,
      await this.hasher.hash(newPassword),
    );
    return "changed";
  }
}
