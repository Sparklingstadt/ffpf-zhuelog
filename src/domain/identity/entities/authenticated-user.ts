export type AppRole = "admin" | "member" | "guest";

// The signed-in person, decided from their Better Auth session on every
// request. userId (Better Auth's user.id) owns their records.
export type AuthenticatedUser = {
  userId: string;
  role: AppRole;
  displayName: string;
  // The login id of a member who signs in with a password (none for a
  // Sparklingstadt ID member or a guest).
  username?: string;
  // The demo account (a member): its data is shared by everyone trying the
  // demo, and the AI features, LINE, follows and password are closed to it.
  demo?: boolean;
  // While an admin impersonates this member: the admin's own user id. The
  // user is then the member in every way (role included).
  impersonatedBy?: string;
};

export function isMemberRole(role: AppRole) {
  return role === "admin" || role === "member";
}
