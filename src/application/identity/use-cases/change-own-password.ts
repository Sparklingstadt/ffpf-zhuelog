import { z } from "zod";
import {
  MAX_FAILURES_PER_LOGIN,
  passwordSchema,
  THROTTLE_WINDOW_MS,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";
import type { SignInThrottle } from "../ports/sign-in-throttle";

const newPasswordSchema = z.object({ newPassword: passwordSchema });
const currentPasswordSchema = z.string().min(1).max(128);

export class ChangeOwnPassword {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly throttle: SignInThrottle,
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
    // Guards a stolen session from guessing the current password. Only the
    // signed-in member can reach this key, and it never blocks sign-in.
    const key = `password-change:${account.id}`;
    if (
      !(await this.throttle.consume(
        key,
        MAX_FAILURES_PER_LOGIN,
        THROTTLE_WINDOW_MS,
        now,
      ))
    ) {
      await this.hasher.simulateVerify(currentPassword);
      return "invalid-current";
    }
    if (!current.success) {
      await this.hasher.simulateVerify(currentPassword);
      return "invalid-current";
    }
    if (!(await this.hasher.verify(currentPassword, account.passwordHash)))
      return "invalid-current";

    await this.accounts.setPassword(
      account.id,
      await this.hasher.hash(newPassword),
    );
    await this.throttle.reset(key);
    return "changed";
  }
}
