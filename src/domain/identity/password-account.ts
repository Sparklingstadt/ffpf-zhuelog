// The rules for password-account input. Lengths are UTF-16 code units unless
// stated otherwise, so trim(), toLowerCase() and length are the plain JS ones.

const LOGIN_ID = /^[a-z0-9._-]{3,32}$/;
const MIN_NEW_PASSWORD_UNITS = 12;
const MAX_NEW_PASSWORD_UNITS = 128;
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

// Non-empty, at most 128 UTF-8 bytes, well-formed, no NUL.
export function isAccountIdShape(id: string): boolean {
  return (
    id !== "" &&
    !id.includes("\u0000") &&
    !LONE_SURROGATE.test(id) &&
    new TextEncoder().encode(id).length <= MAX_ACCOUNT_ID_BYTES
  );
}

// The current password of a password change or a sign-in: non-empty and at
// most 128 code points (not UTF-16 units).
export const CURRENT_PASSWORD_MAX_CODE_POINTS = 128;

export function isPlausibleCurrentPassword(current: string): boolean {
  if (current === "") return false;
  // Count code points without copying: a surrogate pair is one, as for...of
  // sees it.
  let count = 0;
  for (let i = 0; i < current.length; count += 1) {
    if (count === CURRENT_PASSWORD_MAX_CODE_POINTS) return false;
    i += (current.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  }
  return true;
}

// The first n code points of s (what simulate may see: a refused password is
// cut to 128 code points before its dummy hash).
export function firstCodePoints(s: string, n: number): string {
  let out = "";
  let count = 0;
  for (const codePoint of s) {
    if (count === n) break;
    out += codePoint;
    count += 1;
  }
  return out;
}
