// FFPF ID members (services/api/auth/ffpf.go, login.go). Their owner id is
// ffpf:<sub>; there is no allowlist.
import { goTrimSpace } from "../line/go-text";
import { firstCodePoints } from "./password-account";

// Go: ffpfSub (auth/ffpf.go:40). The sub becomes the owner id ffpf:<sub>.
export const FFPF_SUB_PATTERN = /^[a-z0-9]{1,64}$/;

// Go: maxDisplayNameRunes (auth/service.go:38).
export const FFPF_DISPLAY_NAME_MAX_CODE_POINTS = 50;

// Go: strings.Cut(email, "@")'s before: the email up to its first "@", or
// all of it.
export function emailLocalPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

// Go: verify's name rule and LoginFFPF's truncation (auth/ffpf.go:261-265,
// auth/login.go:53-57): Go's TrimSpace, at most 50 code points; blank → the
// email before its first "@", at most 50 code points.
export function ffpfDisplayName(name: string, email: string): string {
  const trimmed = firstCodePoints(
    goTrimSpace(name),
    FFPF_DISPLAY_NAME_MAX_CODE_POINTS,
  );
  if (trimmed !== "") return trimmed;
  return firstCodePoints(
    emailLocalPart(email),
    FFPF_DISPLAY_NAME_MAX_CODE_POINTS,
  );
}
