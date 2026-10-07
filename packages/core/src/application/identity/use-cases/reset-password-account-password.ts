import { z } from "zod";
import { optionalPasswordSchema } from "../../../domain/identity/entities/password-account";
import { PasswordAccountNotFoundError } from "../../../domain/identity/password-account-error";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";

const inputSchema = z.object({ password: optionalPasswordSchema });

export class ResetPasswordAccountPassword {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(
    accountId: string,
    password: unknown,
  ): Promise<{ loginId: string; password: string; generated: boolean }> {
    const parsed = inputSchema.parse({ password });
    const account = await this.accounts.findById(accountId);
    if (!account) throw new PasswordAccountNotFoundError();

    const generated = parsed.password === undefined;
    const next = parsed.password ?? this.hasher.generate();
    await this.accounts.setPassword(account.id, await this.hasher.hash(next));
    return { loginId: account.loginId, password: next, generated };
  }
}
