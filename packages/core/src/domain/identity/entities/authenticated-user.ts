export type AppRole = "admin" | "guest" | "user";

export type AuthenticatedUser = {
  githubLogin: string;
  githubId?: string;
  role: AppRole;
};
