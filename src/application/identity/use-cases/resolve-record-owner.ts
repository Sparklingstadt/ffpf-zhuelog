import type { AuthenticatedUser } from "../../../domain/identity/entities/authenticated-user";
import { isUserId } from "../../../domain/identity/user-id";

// One member per denial reason, so a page that has handled one reason is
// left with a type that no longer includes it.
export type RecordOwner =
  | { kind: "self"; ownerId: string }
  | { kind: "other"; ownerId: string }
  | { kind: "denied"; reason: "unauthenticated" }
  | { kind: "denied"; reason: "guest" }
  | { kind: "redirect-self" };

// Whose notes a page lists: the user's own, or another member's for an admin.
export function showsRecords(
  owner: RecordOwner,
): owner is Extract<RecordOwner, { ownerId: string }> {
  return owner.kind === "self" || owner.kind === "other";
}

// Decides whose records a page shows. `requested` is the raw `?user=` value:
// an admin may name any well-formed user id.
export function resolveRecordOwner(
  user: AuthenticatedUser | null,
  requested: string | undefined,
): RecordOwner {
  if (!user) return { kind: "denied", reason: "unauthenticated" };
  if (user.role === "guest") return { kind: "denied", reason: "guest" };

  const ownerId = user.userId;
  if (!requested || requested === ownerId) return { kind: "self", ownerId };
  if (user.role !== "admin" || !isUserId(requested))
    return { kind: "redirect-self" };
  return { kind: "other", ownerId: requested };
}
