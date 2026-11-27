"use server";

import { redirect } from "next/navigation";

import {
  getCurrentAdminUser,
  stopActing,
} from "@/composition/identity-container";

// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.
// Acting as a member moves to Better Auth's impersonation (Task 7 of the
// migration). Until then the current user no longer reads zl_act_as, so it
// never starts and the admin is told so.
export async function startActingAsAction(userId: string) {
  if (!(await getCurrentAdminUser())) redirect("/");
  void userId;
  redirect("/admin/accounts?actAs=failed");
}

export async function stopActingAction() {
  await stopActing();
  redirect("/admin/accounts");
}
