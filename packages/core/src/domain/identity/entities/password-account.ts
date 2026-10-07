import { z } from "zod";

export type PasswordAccount = {
  id: string;
  loginId: string;
  displayName: string;
  passwordHash: string;
  sessionVersion: number;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
};

// What an administrator sees: never the hash or the failure counter.
export type PasswordAccountSummary = {
  id: string;
  loginId: string;
  displayName: string;
  createdAt: Date;
  locked: boolean;
};

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

export const displayNameSchema = z.string().trim().min(1).max(50);

export const passwordSchema = z.string().min(12).max(128);

// A blank field means "leave the password as it is".
export const optionalPasswordSchema = z.union([
  z
    .string()
    .trim()
    .length(0)
    .transform(() => undefined),
  passwordSchema,
]);

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export function isLocked(
  account: Pick<PasswordAccount, "lockedUntil">,
  now: Date,
) {
  return account.lockedUntil !== null && account.lockedUntil > now;
}

export function ownerIdForAccount(id: string) {
  return `password:${id}`;
}

export function toSummary(
  account: PasswordAccount,
  now: Date,
): PasswordAccountSummary {
  return {
    id: account.id,
    loginId: account.loginId,
    displayName: account.displayName,
    createdAt: account.createdAt,
    locked: isLocked(account, now),
  };
}
