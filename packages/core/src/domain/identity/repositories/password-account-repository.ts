import type { PasswordAccount } from "../entities/password-account";

export interface PasswordAccountRepository {
  findByLoginId(loginId: string): Promise<PasswordAccount | null>;
  findById(id: string): Promise<PasswordAccount | null>;
  // Oldest first.
  list(): Promise<PasswordAccount[]>;
  // Throws LoginIdTakenError when the login ID is already in use.
  create(input: {
    loginId: string;
    displayName: string;
    passwordHash: string;
  }): Promise<PasswordAccount>;
  // Counts one more failure; reaching the maximum locks the account and resets the count.
  recordFailure(id: string, now: Date): Promise<void>;
  clearFailures(id: string): Promise<void>;
  // Also invalidates existing sessions, and clears failures and the lock.
  setPassword(id: string, passwordHash: string): Promise<void>;
}
