// The admin plugin's role "admin" (a user's role may be a comma-separated
// list, as Better Auth stores several roles).
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").some((part) => part.trim() === "admin");
}
