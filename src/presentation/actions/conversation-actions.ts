"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { conversationNotes } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { GoApiError } from "@/infrastructure/go-api/client";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  goFailureMessage,
  type ActionState,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

// The shape only; Go checks the limits.
const conversationInput = z.object({
  id: z.uuid(),
  title: z.string(),
  modelName: z.string(),
  ended: z.boolean(),
  createdAt: z.iso.datetime(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
    }),
  ),
});

export type SaveConversationInput = z.infer<typeof conversationInput>;
export type SaveConversationResult =
  { ok: true } | { ok: false; message: string };

const invalidConversation = "会話の形式または上限を確認してください。";

// The chat is for admins only; Go checks the role again.
async function isAdmin() {
  return (await getCurrentViewerUser())?.role === "admin";
}

// Saves the whole conversation after each answer.
export async function saveConversationAction(
  input: SaveConversationInput,
): Promise<SaveConversationResult> {
  if (!(await isAdmin()))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = conversationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidConversation };
  try {
    await conversationNotes.save({
      ...parsed.data,
      createdAt: new Date(parsed.data.createdAt),
      updatedAt: new Date(),
    });
    // No revalidatePath: it would re-render /chat under the open chat. The
    // conversation pages are dynamic and read Go on every visit.
    return { ok: true };
  } catch (error) {
    // Anything but a Go failure (including Next's redirect) is rethrown.
    if (!(error instanceof GoApiError)) throw error;
    if (error.status === 403)
      return { ok: false, message: accountForbiddenMessage };
    return {
      ok: false,
      message: goFailureMessage("CONVERSATION_SAVE_FAILED", error),
    };
  }
}

export async function deleteConversationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isAdmin())) return actionUnauthorized;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: invalidConversation };
  const result = await attemptGoAction(
    "CONVERSATION_DELETE_FAILED",
    async () => {
      await conversationNotes.remove(id.data);
      return actionSuccess;
    },
  );
  if (result.status !== "success") return result;
  revalidatePath("/conversations", "layout");
  redirect("/conversations");
}
