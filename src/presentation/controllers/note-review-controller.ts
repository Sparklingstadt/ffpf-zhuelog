import { z } from "zod";

import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  noteIdSchema,
  type ActionState,
} from "@/presentation/controllers/action-state";

const notFound: ActionState = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};

const inReviewSchema = z.enum(["true", "false"]);

// Puts the signed-in user's note in their review queue or takes it out.
// Members and admins have a queue; Go checks that the note is theirs.
export async function handleNoteReview(
  formData: FormData,
  dependencies: {
    getMember: () => Promise<{ role: AppRole } | null>;
    run: (id: string, inReview: boolean) => Promise<boolean>;
  },
): Promise<ActionState> {
  const user = await dependencies.getMember();
  if (!user || !isMemberRole(user.role)) return actionUnauthorized;
  const id = noteIdSchema.safeParse(formData.get("id"));
  const inReview = inReviewSchema.safeParse(formData.get("inReview"));
  if (!id.success || !inReview.success) return notFound;
  return attemptGoAction("NOTE_REVIEW_FAILED", async () =>
    (await dependencies.run(id.data, inReview.data === "true"))
      ? actionSuccess
      : notFound,
  );
}
