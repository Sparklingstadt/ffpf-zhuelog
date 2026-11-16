import { getCachedCurrentUser } from "@/composition/current-user";

// The member whose records this request reads and writes, when an admin acts
// as one: the act-as cookie counts only once the signed-in user resolves to
// an admin acting as an existing member.
export async function confirmedActAs(): Promise<string | undefined> {
  const user = await getCachedCurrentUser();
  return user?.role === "admin" ? user.actingAs?.ownerId : undefined;
}
