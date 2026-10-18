import { z } from "zod";
import { passwordSchema } from "../../../domain/identity/entities/password-account";
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
    if (!account) return "invalid-current";

    const current = currentPasswordSchema.safeParse(input.currentPassword);
    const currentPassword = current.success ? current.data : "";
    if (!(await this.accounts.reserveAttempt(account.id, now))) {
      await this.hasher.simulateVerify(currentPassword);
      return "invalid-current";
    }
    if (!current.success) {
      await this.hasher.simulateVerify(currentPassword);
      return "invalid-current";
    }
    if (!(await this.hasher.verify(currentPassword, account.passwordHash)))
      return "invalid-current";

    // setPassword also clears the failure count and the lock.
    await this.accounts.setPassword(
      account.id,
      await this.hasher.hash(newPassword),
    );
    return "changed";
  }
}
