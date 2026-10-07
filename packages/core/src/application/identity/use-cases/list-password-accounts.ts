import {
  toSummary,
  type PasswordAccountSummary,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";

export class ListPasswordAccounts {
  constructor(private readonly accounts: PasswordAccountRepository) {}

  async execute(now = new Date()): Promise<PasswordAccountSummary[]> {
    return (await this.accounts.list()).map((account) =>
      toSummary(account, now),
    );
  }
}
