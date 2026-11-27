import { redirect } from "next/navigation";

import type { RecordOwner } from "@/application/identity/use-cases/resolve-record-owner";
import { getRecordOwner } from "@/composition/identity-container";

// Sends a signed-out visitor to `signInPath`; returns the user
// and whose records the page shows. `requested` is the raw `?user=` value.
export async function requireSignedInOwner(
  requested: string | undefined,
  signInPath: string,
) {
  const { user, owner } = await getRecordOwner(requested);
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect(signInPath);
  return {
    user,
    owner: owner as Exclude<RecordOwner, { reason: "unauthenticated" }>,
  };
}

// For pages with nothing to show a guest: they go back to the home page.
export async function requireNonGuestOwner(
  requested: string | undefined,
  signInPath: string,
) {
  const { user, owner } = await requireSignedInOwner(requested, signInPath);
  if (owner.kind === "denied") redirect("/");
  return { user, owner };
}
