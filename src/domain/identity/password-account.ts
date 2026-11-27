// The rules for password-account input. Lengths are UTF-16 code units unless
// stated otherwise, so trim(), toLowerCase() and length are the plain JS ones.

const LOGIN_ID = /^[a-z0-9._-]{3,32}$/;
export const MIN_NEW_PASSWORD_UNITS = 12;
export const MAX_NEW_PASSWORD_UNITS = 128;
const MAX_DISPLAY_NAME_UNITS = 50;
const MAX_ACCOUNT_ID_BYTES = 128;
// A lone surrogate: a string with one is not well-formed Unicode.
const LONE_SURROGATE = /\p{Cs}/u;

// trim(), toLowerCase(), then ^[a-z0-9._-]{3,32}$; null when it does not
// match.
export function normalizeLoginId(raw: string): string | null {
  const loginId = raw.trim().toLowerCase();
  return LOGIN_ID.test(loginId) ? loginId : null;
}

// The trimmed name when it is 1..50 UTF-16 units with no NUL (which Postgres
// cannot store), else null.
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 &&
    name.length <= MAX_DISPLAY_NAME_UNITS &&
    !name.includes("\u0000")
    ? name
    : null;
}

// 12..128 UTF-16 units, not trimmed.
export function isValidNewPassword(password: string): boolean {
  return (
    password.length >= MIN_NEW_PASSWORD_UNITS &&
    password.length <= MAX_NEW_PASSWORD_UNITS
  );
}

export type PasswordChoice =
  { generate: true } | { generate: false; password: string };

// Blank after trim() means generate one; otherwise the password as typed
// (untrimmed), or null when it breaks the length rule.
export function choosePassword(raw: string): PasswordChoice | null {
  if (raw.trim() === "") return { generate: true };
  return isValidNewPassword(raw) ? { generate: false, password: raw } : null;
}

export type AccountInputError = "login-id" | "display-name" | "password";

// loginId, then displayName, then password; the first failure wins.
export function checkNewAccount(raw: {
  loginId: string;
  displayName: string;
  password: string;
}):
  | {
      ok: true;
      loginId: string;
      displayName: string;
      password: PasswordChoice;
    }
  | { ok: false; error: AccountInputError } {
  const loginId = normalizeLoginId(raw.loginId);
  if (loginId === null) return { ok: false, error: "login-id" };
  const displayName = normalizeDisplayName(raw.displayName);
  if (displayName === null) return { ok: false, error: "display-name" };
  const password = choosePassword(raw.password);
  if (password === null) return { ok: false, error: "password" };
  return { ok: true, loginId, displayName, password };
}

// Members have no mail address, but Better Auth's user.email is required and
// unique: an address under .invalid, which can never receive mail.
export function memberEmail(loginId: string): string {
  return `${loginId}@members.zhuelog.invalid`;
}

// Non-empty, at most 128 UTF-8 bytes, well-formed, no NUL.
export function isAccountIdShape(id: string): boolean {
  return (
    id !== "" &&
    !id.includes("\u0000") &&
    !LONE_SURROGATE.test(id) &&
    new TextEncoder().encode(id).length <= MAX_ACCOUNT_ID_BYTES
  );
}
