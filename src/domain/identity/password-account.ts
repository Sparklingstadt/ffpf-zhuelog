// The rules Go applied to password-account input (services/api/auth/
// validate.go, services/api/httpapi/admin_handlers.go). Go's jsstr copied JavaScript's
// trim(), toLowerCase() and length, so the plain JS calls give the same
// answers. Lengths are UTF-16 code units unless stated otherwise.

const LOGIN_ID = /^[a-z0-9._-]{3,32}$/;
const MIN_NEW_PASSWORD_UNITS = 12;
const MAX_NEW_PASSWORD_UNITS = 128;
const MAX_DISPLAY_NAME_UNITS = 50;
const MAX_ACCOUNT_ID_BYTES = 128;
// A lone surrogate: what Go's utf8.ValidString would have refused.
const LONE_SURROGATE = /\p{Cs}/u;

// Go: NormalizeLoginID. trim(), toLowerCase(), then ^[a-z0-9._-]{3,32}$;
// null when it does not match.
export function normalizeLoginId(raw: string): string | null {
  const loginId = raw.trim().toLowerCase();
  return LOGIN_ID.test(loginId) ? loginId : null;
}

// Go: ValidDisplayName. The trimmed name, 1..50 UTF-16 units, no NUL (which
// Postgres cannot store).
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 &&
    name.length <= MAX_DISPLAY_NAME_UNITS &&
    !name.includes("\u0000")
    ? name
    : null;
}

// Go: ValidNewPassword. 12..128 UTF-16 units, not trimmed.
export function isValidNewPassword(password: string): boolean {
  return (
    password.length >= MIN_NEW_PASSWORD_UNITS &&
    password.length <= MAX_NEW_PASSWORD_UNITS
  );
}

export type PasswordChoice =
  { generate: true } | { generate: false; password: string };

// Go: resolvePassword. Blank after trim() means generate one; otherwise the
// password as typed (untrimmed), or null when it breaks the length rule.
export function choosePassword(raw: string): PasswordChoice | null {
  if (raw.trim() === "") return { generate: true };
  return isValidNewPassword(raw) ? { generate: false, password: raw } : null;
}

export type AccountInputError = "login-id" | "display-name" | "password";

// Go: validateAccountInput. loginId, then displayName, then password; the
// first failure wins.
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

// Go: validID. Non-empty, at most 128 UTF-8 bytes, well-formed, no NUL.
export function isAccountIdShape(id: string): boolean {
  return (
    id !== "" &&
    !id.includes("\u0000") &&
    !LONE_SURROGATE.test(id) &&
    new TextEncoder().encode(id).length <= MAX_ACCOUNT_ID_BYTES
  );
}

// Go: ChangePassword's check of the current password: non-empty and at most
// 128 code points (runes, not UTF-16 units).
export const CURRENT_PASSWORD_MAX_CODE_POINTS = 128;

export function isPlausibleCurrentPassword(current: string): boolean {
  if (current === "") return false;
  // Count code points without copying: a surrogate pair is one, as for...of
  // and Go's runes see it.
  let count = 0;
  for (let i = 0; i < current.length; count += 1) {
    if (count === CURRENT_PASSWORD_MAX_CODE_POINTS) return false;
    i += (current.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  }
  return true;
}

// The first n code points of s (what simulate may see, as Go truncated the
// current password to 128 runes before its dummy hash).
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
