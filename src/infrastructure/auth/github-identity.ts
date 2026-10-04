// Auth.js replaces the OAuth user id with crypto.randomUUID() (it becomes
// token.sub), so the numeric GitHub account id must come from the provider
// account at sign-in and travel in its own JWT claim.
const GITHUB_ID = /^\d+$/;

export function githubIdFromAccount(
  account: { provider?: string; providerAccountId?: string } | null | undefined,
): string | undefined {
  if (account?.provider !== "github") return undefined;
  const id = account.providerAccountId;
  return typeof id === "string" && GITHUB_ID.test(id) ? id : undefined;
}

export function githubIdFromToken(value: unknown): string | undefined {
  return typeof value === "string" && GITHUB_ID.test(value) ? value : undefined;
}
