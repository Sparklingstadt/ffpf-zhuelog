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
  // Also invalidates existing sessions.
  setPassword(id: string, passwordHash: string): Promise<void>;
}
