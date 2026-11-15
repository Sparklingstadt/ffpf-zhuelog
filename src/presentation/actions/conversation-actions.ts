"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { conversationNotes } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  attemptGoResult,
  type ActionResult,
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
export type SaveConversationResult = ActionResult;

const invalidConversation = "会話の形式または上限を確認してください。";

// The chat is for members and admins; Go checks the role again.
async function canChat() {
  const user = await getCurrentViewerUser();
  return user ? isMemberRole(user.role) : false;
}

// Saves the whole conversation after each answer.
export async function saveConversationAction(
  input: SaveConversationInput,
): Promise<SaveConversationResult> {
  if (!(await canChat()))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = conversationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidConversation };
  // No revalidatePath: it would re-render /chat under the open chat. The
  // conversation pages are dynamic and read Go on every visit.
  return attemptGoResult("CONVERSATION_SAVE_FAILED", async () => {
    await conversationNotes.save({
      ...parsed.data,
      createdAt: new Date(parsed.data.createdAt),
      updatedAt: new Date(),
    });
  });
}

export async function deleteConversationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await canChat())) return actionUnauthorized;
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
