// Admins are identified by their numeric GitHub user id, never by login: a
// login can be renamed and then registered by someone else.
const GITHUB_ID = /^\d+$/;

export function getAllowedGitHubIds(
  source = process.env.AUTH_ALLOWED_GITHUB_IDS ?? "",
) {
  return new Set(
    source
      .split(",")
      .map((id) => id.trim())
      .filter((id) => GITHUB_ID.test(id)),
  );
}

export function isAllowedGitHubId(
  id: unknown,
  source = process.env.AUTH_ALLOWED_GITHUB_IDS ?? "",
) {
  return typeof id === "string" && getAllowedGitHubIds(source).has(id);
}
