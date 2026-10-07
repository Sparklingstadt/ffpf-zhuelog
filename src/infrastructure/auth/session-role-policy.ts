import { isAllowedGitHubLogin } from "./github-login-policy";

// Recheck on every session read so removing an admin revokes existing JWTs too.
export function resolveSessionRole(
  role: unknown,
  login: unknown,
  allowed?: string,
) {
  if (role === "guest") return "guest";
  // Revocation of member accounts is checked against the DB elsewhere.
  if (role === "member") return "member";
  return role === "admin" &&
    typeof login === "string" &&
    isAllowedGitHubLogin(login, allowed)
    ? "admin"
    : "revoked";
}
