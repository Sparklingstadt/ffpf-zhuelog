import { isAllowedGitHubId } from "./github-admin-policy";

// Recheck on every session read so removing an admin revokes existing JWTs too.
export function resolveSessionRole(
  role: unknown,
  githubId: unknown,
  allowed?: string,
) {
  if (role === "guest") return "guest";
  // Revocation of member accounts is checked against the DB elsewhere.
  if (role === "member") return "member";
  return role === "admin" && isAllowedGitHubId(githubId, allowed)
    ? "admin"
    : "revoked";
}
