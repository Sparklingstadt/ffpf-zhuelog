import type { AppRole } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";

// Member (password) sessions are revoked by bumping the account's
// sessionVersion, so each session read compares the JWT claim with the DB.
// Other roles never touch the DB: existing GitHub admin and guest JWTs carry
// neither claim and must keep working unchanged.
export async function isCurrentMemberSession(
  claims: { role: AppRole; accountId?: unknown; sessionVersion?: unknown },
  findById: (id: string) => Promise<{ sessionVersion: number } | null>,
): Promise<boolean> {
  if (claims.role !== "member") return true;
  const { accountId, sessionVersion } = claims;
  if (typeof accountId !== "string" || accountId === "") return false;
  if (typeof sessionVersion !== "number" || !Number.isInteger(sessionVersion))
    return false;
  const account = await findById(accountId);
  return account !== null && account.sessionVersion === sessionVersion;
}
