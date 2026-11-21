import { createHash, randomBytes } from "node:crypto";

import { LINK_CODE_LENGTH, linkCodeFromBytes } from "@/domain/line/link-code";

// Go: IssueCode (linebot/code.go:35-52). 8 random bytes, one letter each.
export function newLinkCode(): string {
  return linkCodeFromBytes(randomBytes(LINK_CODE_LENGTH));
}

// Go: hashCode (linebot/code.go:54-57). What LineLinkCode stores: the
// SHA-256 of the code, in lowercase hex.
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
