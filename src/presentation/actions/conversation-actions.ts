"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import type { SaveConversationInput } from "@/domain/chat/conversation";
import type {
  ActionResult,
  ActionState,
} from "@/presentation/controllers/action-state";
import {
  handleConversationDelete,
  handleConversationSave,
} from "@/presentation/controllers/conversation-controller";

export type { SaveConversationInput } from "@/domain/chat/conversation";
export type SaveConversationResult = ActionResult;

// Saves the whole conversation after each answer. No revalidatePath: it
// would re-render /chat under the open chat. The conversation pages are
// dynamic and read the database on every visit.
export async function saveConversationAction(
  input: SaveConversationInput,
): Promise<SaveConversationResult> {
  return handleConversationSave(input, {
    getViewer: getCurrentViewerUser,
    save: (conversation) => conversationNotes.save(conversation),
  });
}

export async function deleteConversationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await handleConversationDelete(formData, {
    getViewer: getCurrentViewerUser,
    remove: (id) => conversationNotes.remove(id),
  });
  if (result.status !== "success") return result;
  revalidatePath("/conversations", "layout");
  redirect("/conversations");
}
