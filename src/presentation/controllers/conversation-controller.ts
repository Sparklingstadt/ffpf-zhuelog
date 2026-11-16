import { z } from "zod";

import type { SaveConversationResult } from "@/application/chat/conversation-notes";
import {
  CONVERSATION_ID,
  type SaveConversationInput,
} from "@/domain/chat/conversation";
import {
  isMemberRole,
  type AppRole,
} from "@/domain/identity/entities/authenticated-user";
import {
  actionSuccess,
  actionUnauthorized,
  attemptGo,
  attemptGoAction,
  type ActionResult,
  type ActionState,
} from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

const invalidConversation = "会話の形式または上限を確認してください。";

// The shape only; the conversation notes check the limits. Unknown keys are
// dropped.
const conversationInput = z.object({
  id: z.string().regex(CONVERSATION_ID),
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
}) satisfies z.ZodType<SaveConversationInput>;

// The chat is for members and admins; the conversation notes check the user
// again.
async function canChat(getViewer: () => Promise<{ role: AppRole } | null>) {
  const user = await getViewer();
  return user ? isMemberRole(user.role) : false;
}

// Checks who may save and the conversation's shape, then saves it.
export async function handleConversationSave(
  input: unknown,
  deps: {
    getViewer: () => Promise<{ role: AppRole } | null>;
    save: (
      conversation: SaveConversationInput,
    ) => Promise<SaveConversationResult>;
  },
): Promise<ActionResult> {
  if (!(await canChat(deps.getViewer)))
    return { ok: false, message: accountForbiddenMessage };
  const parsed = conversationInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidConversation };
  const attempt = await attemptGo("CONVERSATION_SAVE_FAILED", () =>
    deps.save(parsed.data),
  );
  if (!attempt.ok) return attempt;
  switch (attempt.value) {
    case "saved":
      return { ok: true };
    case "invalid":
      return { ok: false, message: invalidConversation };
    case "conflict":
    case "unavailable":
      // conflict: the id is another owner's; crypto.randomUUID() all but
      // never makes one. unavailable: no OpenAI.
      console.error("CONVERSATION_SAVE_FAILED", attempt.value);
      return { ok: false, message: genericErrorMessage };
  }
}

// actionSuccess when deleted; the action then revalidates and redirects.
export async function handleConversationDelete(
  formData: FormData,
  deps: {
    getViewer: () => Promise<{ role: AppRole } | null>;
    remove: (id: string) => Promise<boolean>;
  },
): Promise<ActionState> {
  if (!(await canChat(deps.getViewer))) return actionUnauthorized;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: invalidConversation };
  return attemptGoAction("CONVERSATION_DELETE_FAILED", async () => {
    if (await deps.remove(id.data)) return actionSuccess;
    console.error("CONVERSATION_DELETE_FAILED", "not-found");
    return { status: "error", message: genericErrorMessage };
  });
}
