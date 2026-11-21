// Sparklingstadt ID members (served by sparklingstadt-id). Their owner id is
// sid:<sub>; there is no allowlist.
import { goTrimSpace } from "../line/go-text";
import { firstCodePoints } from "./password-account";

// The sub becomes the owner id sid:<sub>.
export const SID_SUB_PATTERN = /^[a-z0-9]{1,64}$/;

// Go: maxDisplayNameRunes (auth/service.go:38).
export const SID_DISPLAY_NAME_MAX_CODE_POINTS = 50;

// Go: strings.Cut(email, "@")'s before: the email up to its first "@", or
// all of it.
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

// The display name: trimmed (Go-style TrimSpace), at most 50 code points; blank → the
// email before its first "@", at most 50 code points.
export function sidDisplayName(name: string, email: string): string {
  const trimmed = firstCodePoints(
    goTrimSpace(name),
    SID_DISPLAY_NAME_MAX_CODE_POINTS,
  );
  if (trimmed !== "") return trimmed;
  return firstCodePoints(
    emailLocalPart(email),
    SID_DISPLAY_NAME_MAX_CODE_POINTS,
  );
}
