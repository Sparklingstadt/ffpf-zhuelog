export type AppRole = "admin" | "user";

export type AuthenticatedUser = {
  githubLogin: string;
  role: AppRole;
};
