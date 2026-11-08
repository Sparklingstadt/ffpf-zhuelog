"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningNotes } from "@/composition/learning-container";
import { revalidateNotes } from "@/presentation/actions/revalidate-notes";
import type { ActionState } from "@/presentation/controllers/action-state";
import { handleNoteReview } from "@/presentation/controllers/note-review-controller";

export async function setNoteReviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await handleNoteReview(formData, {
    getMember: getCurrentMemberUser,
    // Go puts the token owner's note in their own queue.
    run: (id, inReview) => learningNotes.setInReview(id, inReview),
  });
  if (state.status === "success") {
    revalidateNotes();
    revalidatePath("/review");
    revalidatePath("/");
  }
  return state;
}
