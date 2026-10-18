import { z } from "zod";
import {
  displayNameSchema,
  loginIdSchema,
  optionalPasswordSchema,
  toSummary,
  type PasswordAccountSummary,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";

// One object so a ZodError's issues[0].path[0] names the offending field.
const inputSchema = z.object({
  loginId: loginIdSchema,
  displayName: displayNameSchema,
  password: optionalPasswordSchema,
});

export class CreatePasswordAccount {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: {
    loginId: unknown;
    displayName: unknown;
    password: unknown;
  }): Promise<{
    account: PasswordAccountSummary;
    password: string;
    generated: boolean;
  }> {
    const parsed = inputSchema.parse(input);
    const generated = parsed.password === undefined;
    const password = parsed.password ?? this.hasher.generate();
    // Throws LoginIdTakenError when the ID is already in use.
    const account = await this.accounts.create({
      loginId: parsed.loginId,
      displayName: parsed.displayName,
      passwordHash: await this.hasher.hash(password),
    });
    return { account: toSummary(account, new Date()), password, generated };
  }
}
