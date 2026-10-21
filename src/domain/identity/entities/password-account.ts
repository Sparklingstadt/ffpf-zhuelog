import { z } from "zod";

export type PasswordAccount = {
  id: string;
  loginId: string;
  displayName: string;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
};

// What an administrator sees: never the hash.
export type PasswordAccountSummary = {
  id: string;
  loginId: string;
  displayName: string;
  createdAt: Date;
};

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

export const displayNameSchema = z.string().trim().min(1).max(50);

export const passwordSchema = z.string().min(12).max(128);

// A blank field means no password was given.
export const optionalPasswordSchema = z.union([
  z
    .string()
    .trim()
    .length(0)
    .transform(() => undefined),
  passwordSchema,
]);

// Sign-in attempts are counted per client address, never per account alone,
// so nobody can lock a member out from somewhere else. The Go API
// (services/api/auth) uses the same keys and limits on the same table.
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
// Every password sign-in attempt from one client. Caps the hashing cost an
// attacker can make us spend.
export const MAX_ATTEMPTS_PER_CLIENT = 20;
// Attempts at one login ID (or one password change) before it pauses; a
// success resets the count.
export const MAX_FAILURES_PER_LOGIN = 5;

export function ownerIdForAccount(id: string) {
  return `password:${id}`;
}

export function toSummary(account: PasswordAccount): PasswordAccountSummary {
  return {
    id: account.id,
    loginId: account.loginId,
    displayName: account.displayName,
    createdAt: account.createdAt,
  };
}
