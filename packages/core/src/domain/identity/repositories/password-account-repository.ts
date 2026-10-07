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
  // Atomically counts one attempt before verification. Returns false (and
  // changes nothing) while the account is locked. If the previous lock has
  // expired, counting restarts at 1. When the count reaches
  // MAX_FAILED_ATTEMPTS, sets lockedUntil = now + LOCK_DURATION_MS.
  // Success must call clearFailures.
  reserveAttempt(id: string, now: Date): Promise<boolean>;
  clearFailures(id: string): Promise<void>;
  // Also invalidates existing sessions, and clears failures and the lock.
  setPassword(id: string, passwordHash: string): Promise<void>;
}
