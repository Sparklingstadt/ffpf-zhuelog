"use server";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { questionNotes } from "@/composition/question-container";
import type { SaveQuestionInput } from "@/domain/chat/question";
import type { ActionResult } from "@/presentation/controllers/action-state";
import { handleQuestionSave } from "@/presentation/controllers/question-save-controller";

// Saves a quick question and its answer as a question note, for members and
// admins. No revalidatePath: the note pages read the database on every
// visit, and it would replace the answer on screen.
export async function saveQuestionAction(
  input: SaveQuestionInput,
): Promise<ActionResult> {
  return handleQuestionSave(input, {
    getViewer: getCurrentViewerUser,
    save: (note) => questionNotes.save(note),
  });
}
