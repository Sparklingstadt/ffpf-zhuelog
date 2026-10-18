"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import {
  handleEmptyTrash,
  handleNoteAction,
  type NoteActionState,
} from "@/presentation/controllers/note-trash-controller";
import { trashedRedirectPath } from "@/presentation/presenters/note-trash-href";

export type { NoteActionState };

// Replace, not push: the detail page's number now belongs to the next note,
// so going back must not reopen it.
function redirectAfterTrash(path: string): never {
  redirect(path, RedirectType.replace);
}
type Run = (ownerId: string, id: string) => Promise<boolean>;

// Every list, the home page's recent notes and the trash pages change.
function revalidateNotes() {
  revalidatePath("/");
  revalidatePath("/logs", "layout");
}

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
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const state = await noteAction(formData, (ownerId, id) =>
    learningUseCases.trashLearningEntry.execute(ownerId, id),
  );
  if (state.status === "success")
    redirectAfterTrash(trashedRedirectPath("/logs", formData));
  return state;
}

export async function restoreLearningEntryAction(
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  return noteAction(formData, (ownerId, id) =>
    learningUseCases.restoreLearningEntry.execute(ownerId, id),
  );
}

export async function purgeLearningEntryAction(
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  return noteAction(formData, (ownerId, id) =>
    learningUseCases.purgeLearningEntry.execute(ownerId, id),
  );
}

export async function emptyLearningTrashAction(): Promise<NoteActionState> {
  return emptyAction((ownerId) =>
    learningUseCases.emptyLearningTrash.execute(ownerId),
  );
}
