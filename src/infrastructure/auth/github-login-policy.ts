export function getAllowedGitHubLogins(
  source = process.env.AUTH_ALLOWED_GITHUB_LOGINS ?? "",
) {
  return new Set(
    source
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedGitHubLogin(
  login: string,
  source = process.env.AUTH_ALLOWED_GITHUB_LOGINS ?? "",
) {
  return getAllowedGitHubLogins(source).has(login.trim().toLowerCase());
}
