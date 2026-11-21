import {
  actionSuccess,
  attemptAction,
  noteIdSchema,
  type ActionState,
} from "@/presentation/controllers/action-state";

const notFound: ActionState = {
  status: "error",
  message: "このノートは見つかりませんでした。画面を更新してください。",
};

// Moves one note to the trash, restores it, or deletes it for good. The form
// never names the owner: run (learningNotes) acts on the signed-in user's own
// notes, so an admin viewing someone else (or a crafted POST) still acts on
// their own, and refuses anyone else with LearningForbiddenError.
export async function handleNoteAction(
  formData: FormData,
  dependencies: { run: (id: string) => Promise<boolean> },
): Promise<ActionState> {
  const id = noteIdSchema.safeParse(formData.get("id"));
  if (!id.success) return notFound;
  return attemptAction("NOTE_TRASH_FAILED", async () =>
    (await dependencies.run(id.data)) ? actionSuccess : notFound,
  );
}

export async function handleEmptyTrash(dependencies: {
  run: () => Promise<number>;
}): Promise<ActionState> {
  return attemptAction("NOTE_TRASH_FAILED", async () => {
    await dependencies.run();
    return actionSuccess;
  });
}
