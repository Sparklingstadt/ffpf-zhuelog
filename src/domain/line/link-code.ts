// The one-time code that links a LINE account to a web account, with Go's
// alphabet, length, lifetime and redeem throttle (services/api/linebot/code.go).

import type { ThrottleRule } from "@/domain/identity/sign-in-throttle";

// Go: codeAlphabet (code.go:24). No 0, O, 1 or I; 32 letters divide 256, so a
// byte picks a letter without bias.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
// Go: IssueCode's expiry (code.go:35-52), 10 minutes.
export const LINK_CODE_TTL_MS = 600_000;

// Go: throttleLimit per throttleWindow (code.go:29-30) on
// "line-link:<LINE user id>". Every attempt counts; a success resets it.
export const LINK_REDEEM_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 3_600_000,
};

// Go: redeem's throttle key (code.go:77).
export function lineLinkThrottleKey(lineUserId: string): string {
  return `line-link:${lineUserId}`;
}

// Go: IssueCode (code.go:35-52). Each of the 8 bytes picks ALPHABET[byte % 32].
export function linkCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== LINK_CODE_LENGTH)
    throw new RangeError(`a link code needs ${LINK_CODE_LENGTH} bytes`);
  let code = "";
  for (const b of bytes)
    code += LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length];
  return code;
}

// Go: codeShape (code.go:61-72). NFKC, trim, upper case; the code when it is
// exactly 8 characters of the alphabet, else null.
export function readLinkCode(text: string): string | null {
  const n = text.normalize("NFKC").trim().toUpperCase();
  const chars = [...n];
  if (chars.length !== LINK_CODE_LENGTH) return null;
  return chars.every((c) => LINK_CODE_ALPHABET.includes(c)) ? n : null;
}
