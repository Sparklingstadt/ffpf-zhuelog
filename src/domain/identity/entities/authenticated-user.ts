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
  // The admin asked to act as a member but the target is malformed or no
  // longer exists: githubId is the admin's own.
  actAsIgnored?: boolean;
  // The demo account (a member): its data is shared by everyone trying the
  // demo, and the AI features, LINE, follows and password are closed to it.
  demo?: boolean;
};

export function isMemberRole(role: AppRole) {
  return role === "admin" || role === "member";
}
