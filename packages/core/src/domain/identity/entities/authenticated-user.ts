export type AppRole = "admin" | "guest" | "revoked";

export type AuthenticatedUser = {
  githubLogin: string;
  githubId?: string;
  role: AppRole;
};
