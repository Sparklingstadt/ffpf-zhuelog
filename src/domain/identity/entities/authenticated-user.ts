export type AppRole = "admin" | "member" | "guest" | "revoked";

// The member an admin acts as. githubId is then the member's ownerId, so
// records are read and written as theirs; role stays "admin".
export type ActingAs = {
  ownerId: string;
  loginId: string;
  displayName: string;
};

export type AuthenticatedUser = {
  githubLogin: string;
  githubId?: string;
  role: AppRole;
  displayName?: string;
  accountId?: string;
  actingAs?: ActingAs;
  // The admin asked to act as a member but the Go API did not confirm it
  // (an older API, or a member that no longer exists): githubId is the
  // admin's own.
  actAsIgnored?: boolean;
};

export function isMemberRole(role: AppRole) {
  return role === "admin" || role === "member";
}
