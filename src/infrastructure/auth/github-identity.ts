import { ownerIdForAccount } from "@ffpf-zhuelog/core/domain/identity/entities/password-account";

// Auth.js replaces the OAuth user id with crypto.randomUUID() (it becomes
// token.sub), so the numeric GitHub account id must come from the provider
// account at sign-in and travel in its own JWT claim.
const GITHUB_ID = /^\d+$/;
// Password accounts own their data as "password:<PasswordAccount.id>". The id
// is a Prisma cuid; anything else (e.g. path segments) is never trusted.
const PASSWORD_ACCOUNT_ID = /^[a-z0-9]{20,32}$/;
const PASSWORD_OWNER_ID = /^password:[a-z0-9]{20,32}$/;

export function githubIdFromAccount(
  account: { provider?: string; providerAccountId?: string } | null | undefined,
): string | undefined {
  if (account?.provider !== "github") return undefined;
  const id = account.providerAccountId;
  return typeof id === "string" && GITHUB_ID.test(id) ? id : undefined;
}

export function passwordOwnerId(accountId: unknown): string | undefined {
  return typeof accountId === "string" && PASSWORD_ACCOUNT_ID.test(accountId)
    ? ownerIdForAccount(accountId)
    : undefined;
}

export function githubIdFromToken(value: unknown): string | undefined {
  return typeof value === "string" &&
    (GITHUB_ID.test(value) || PASSWORD_OWNER_ID.test(value))
    ? value
    : undefined;
}
