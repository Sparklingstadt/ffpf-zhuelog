// The one-time code that links a LINE account to a web account: its
// alphabet, length, lifetime and redeem throttle.

import type { ThrottleRule } from "@/domain/identity/sign-in-throttle";
import { trimWhiteSpace } from "@/domain/line/white-space";

// No 0, O, 1 or I; 32 letters divide 256, so a byte picks a letter without
// bias.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
// A code can be redeemed for 10 minutes.
export const LINK_CODE_TTL_MS = 600_000;

// 5 attempts per hour, counted on "line-link:<LINE user id>". Every attempt
// counts; a success resets it.
export const LINK_REDEEM_THROTTLE: ThrottleRule = {
  limit: 5,
  windowMs: 3_600_000,
};

// The key a LINE user's redeem attempts are counted on.
export function lineLinkThrottleKey(lineUserId: string): string {
  return `line-link:${lineUserId}`;
}

// The code for 8 bytes: each picks LINK_CODE_ALPHABET[byte % 32].
export function linkCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== LINK_CODE_LENGTH)
    throw new RangeError(`a link code needs ${LINK_CODE_LENGTH} bytes`);
  let code = "";
  for (const b of bytes)
    code += LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length];
  return code;
}

// The code in a text a user sent: NFKC, white space trimmed, upper case; the
// code when it is exactly 8 characters of the alphabet, else null. Only a-z is
// upper-cased: toUpperCase would turn "ß" into "SS" and change the length.
export function readLinkCode(text: string): string | null {
  const n = trimWhiteSpace(text.normalize("NFKC")).replace(/[a-z]/g, (c) =>
    c.toUpperCase(),
  );
  const chars = [...n];
  if (chars.length !== LINK_CODE_LENGTH) return null;
  return chars.every((c) => LINK_CODE_ALPHABET.includes(c)) ? n : null;
}
