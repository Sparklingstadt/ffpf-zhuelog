"use server";

import { redirect } from "next/navigation";

import {
  getCurrentAdminUser,
  impersonateMember,
  stopImpersonation,
} from "@/composition/identity-container";

// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.

// An admin becomes the member (Better Auth's impersonation) and lands on the
// member's top page; a refusal goes back to the accounts page, which says so.
// userId is bound into the form, so the client can send any value: Better
// Auth refuses anything that is not a member's user id.
export async function startActingAsAction(userId: string) {
  if (!(await getCurrentAdminUser())) redirect("/");
  if (typeof userId !== "string" || !(await impersonateMember(userId)))
    redirect("/admin/accounts?actAs=failed");
  redirect("/");
}

// Back to the admin's own session. Without an impersonation there is nothing
// to end.
export async function stopActingAction() {
  if (!(await stopImpersonation())) redirect("/");
  redirect("/admin/accounts");
}
