export interface PasswordHasher {
  hash(password: string): Promise<string>;
  // A malformed hash is simply a mismatch.
  verify(password: string, passwordHash: string): Promise<boolean>;
  // Spends as long as verify, for a login ID that does not exist.
  simulateVerify(password: string): Promise<void>;
  // A new random password.
  generate(): string;
}
