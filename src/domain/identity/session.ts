// Who a signed-in browser is (stage 11 of the Go retirement). A session keeps
// what Go's refresh token kept (services/api/auth/token.go), so the check on
// every request stays the one Go's refresh tokens (ApiRefreshToken, dropped in
// stage 12b) had.

export const GUEST_OWNER_ID = "guest";

// Go: RefreshTTL and GuestRefreshTTL (auth/token.go:14-17). Fixed from
// sign-in; a session is never extended.
export const SESSION_TTL_MS = 2_592_000_000;
export const GUEST_SESSION_TTL_MS = 86_400_000;

export type SessionPrincipal =
  | { role: "admin"; ownerId: string; login: string }
  | { role: "member"; ownerId: string; sessionVersion: number }
  | { role: "guest"; ownerId: typeof GUEST_OWNER_ID };

export function sessionTtlMs(principal: SessionPrincipal): number {
  return principal.role === "guest" ? GUEST_SESSION_TTL_MS : SESSION_TTL_MS;
}

// Go: Signer.Verify's role rules (auth/token.go:126-145). null for a row the
// check must never accept: an empty ownerId, an unknown role, an admin
// without a login, a member without a non-negative integer version, a guest
// whose ownerId is not "guest".
export function toSessionPrincipal(row: {
  ownerId: string;
  role: string;
  login: string | null;
  sessionVersion: number | null;
}): SessionPrincipal | null {
  if (row.ownerId === "") return null;
  switch (row.role) {
    case "admin":
      if (row.login === null || row.login === "") return null;
      return { role: "admin", ownerId: row.ownerId, login: row.login };
    case "member": {
      const version = row.sessionVersion;
      if (version === null || !Number.isInteger(version) || version < 0) {
        return null;
      }
      return { role: "member", ownerId: row.ownerId, sessionVersion: version };
    }
    case "guest":
      if (row.ownerId !== GUEST_OWNER_ID) return null;
      return { role: "guest", ownerId: GUEST_OWNER_ID };
    default:
      return null;
  }
}
