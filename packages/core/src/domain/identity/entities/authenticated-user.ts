export type AppRole = "admin" | "member" | "guest" | "revoked";

export type AuthenticatedUser = {
  githubLogin: string;
  githubId?: string;
  role: AppRole;
  displayName?: string;
  accountId?: string;
};

export function isMemberRole(role: AppRole) {
  return role === "admin" || role === "member";
}
