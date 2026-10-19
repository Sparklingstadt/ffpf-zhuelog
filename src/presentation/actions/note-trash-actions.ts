"use server";

import { redirect, RedirectType } from "next/navigation";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { revalidateNotes } from "@/presentation/actions/revalidate-notes";
import type { ActionState } from "@/presentation/controllers/action-state";
import {
  handleEmptyTrash,
  handleNoteAction,
} from "@/presentation/controllers/note-trash-controller";
import { trashedRedirectPath } from "@/presentation/presenters/note-trash-href";

// Replace, not push: the detail page's number now belongs to the next note,
// so going back must not reopen it.
function redirectAfterTrash(path: string): never {
  redirect(path, RedirectType.replace);
}
type Run = (ownerId: string, id: string) => Promise<boolean>;

async function noteAction(formData: FormData, run: Run) {
  const state = await handleNoteAction(formData, {
    getMember: getCurrentMemberUser,
    run,
  });
  if (state.status === "success") revalidateNotes();
  return state;
}

async function emptyAction(run: (ownerId: string) => Promise<number>) {
  const state = await handleEmptyTrash({
    getMember: getCurrentMemberUser,
    run,
  });
  if (state.status === "success") revalidateNotes();
  return state;
}

export async function trashLearningEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await noteAction(formData, (ownerId, id) =>
    learningUseCases.trashLearningEntry.execute(ownerId, id),
  );
  if (state.status === "success")
    redirectAfterTrash(trashedRedirectPath("/logs", formData));
  return state;
}

export async function restoreLearningEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return noteAction(formData, (ownerId, id) =>
    learningUseCases.restoreLearningEntry.execute(ownerId, id),
  );
}

export async function purgeLearningEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return noteAction(formData, (ownerId, id) =>
    learningUseCases.purgeLearningEntry.execute(ownerId, id),
  );
}

export async function emptyLearningTrashAction(): Promise<ActionState> {
  return emptyAction((ownerId) =>
    learningUseCases.emptyLearningTrash.execute(ownerId),
  );
}
