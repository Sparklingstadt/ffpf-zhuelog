import { notFound, redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";

// Practice records exist for members and admins: a signed-out visitor goes
// to `signInPath`, a guest (whose rounds are never saved) gets a 404.
export async function requirePracticeRecordUser(signInPath: string) {
  const user = await getCurrentViewerUser();
  if (!user) redirect(signInPath);
  if (!isMemberRole(user.role)) notFound();
  return user;
}
