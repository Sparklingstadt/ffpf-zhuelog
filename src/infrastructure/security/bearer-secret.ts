import { createHash, timingSafeEqual } from "node:crypto";

// Go: bearerMatches (httpapi/line_handlers.go:191-202). Whether header is
// "Bearer <secret>": split at the first space, the scheme compared
// case-insensitively, a non-empty token, then the SHA-256 of both compared,
// so the time does not depend on the token's length. A missing or empty
// secret never matches.
export function bearerMatches(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || header === null) return false;
  const space = header.indexOf(" ");
  if (space < 0) return false;
  const scheme = header.slice(0, space);
  const token = header.slice(space + 1);
  // Go's strings.EqualFold: no non-ASCII rune folds to b, e, a or r, so
  // lower-casing the scheme compares the same.
  if (scheme.toLowerCase() !== "bearer" || token === "") return false;
  return timingSafeEqual(
    createHash("sha256").update(secret, "utf8").digest(),
    createHash("sha256").update(headerBytes(token)).digest(),
  );
}

// Node gives a header value one character per byte (latin1), where Go has the
// bytes themselves; a string with wider characters did not come from a
// header and is taken as UTF-8.
function headerBytes(value: string): Buffer {
  for (let i = 0; i < value.length; i++)
    if (value.charCodeAt(i) > 0xff) return Buffer.from(value, "utf8");
  return Buffer.from(value, "latin1");
}
