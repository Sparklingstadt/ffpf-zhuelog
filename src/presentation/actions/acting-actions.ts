"use server";

import { redirect } from "next/navigation";

import {
  getCurrentAdminUser,
  startActingAs,
  stopActing,
} from "@/composition/identity-container";
import { isOwnerId } from "@/domain/identity/owner-id";

// Only members can be acted as; an admin's ownerId is a bare number.
function isMemberOwnerId(value: string) {
  return value.startsWith("password:") && isOwnerId(value);
}

// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.
export async function startActingAsAction(ownerId: string) {
  if (!(await getCurrentAdminUser())) redirect("/");
  const started = isMemberOwnerId(ownerId) && (await startActingAs(ownerId));
  redirect(started ? "/" : "/admin/accounts?actAs=failed");
}

export async function stopActingAction() {
  await stopActing();
  redirect("/admin/accounts");
}
