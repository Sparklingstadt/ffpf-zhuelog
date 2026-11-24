import { createHash, randomBytes } from "node:crypto";

import { LINK_CODE_LENGTH, linkCodeFromBytes } from "@/domain/line/link-code";

// A new link code: 8 random bytes, one letter each.
export function newLinkCode(): string {
  return linkCodeFromBytes(randomBytes(LINK_CODE_LENGTH));
}

// What LineLinkCode stores: the SHA-256 of the code, in lowercase hex.
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
