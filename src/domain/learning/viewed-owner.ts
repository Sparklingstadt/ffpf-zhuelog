// Whose learning notes a page reads: the signed-in user's own, or (for an
// admin) another member's.
export type ViewedOwner = { kind: "self" | "other"; ownerId: string };
