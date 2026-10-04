"use server";

import { revalidatePath } from "next/cache";

import { conversationUseCases } from "@/composition/conversation-container";
import { getCurrentAdminUser } from "@/composition/identity-container";
import { ConversationNoteValidationError } from "@ffpf-zhuelog/core/domain/conversation/conversation-note-draft";
import { getLogDateHref } from "@/presentation/presenters/log-date-presenter";

export type SaveConversationResult =
  | { status: "success"; noteId: string; href: string; message: string }
  | { status: "error"; message: string };

export async function saveConversationNoteAction(input: {
  noteId?: string | null;
  messages: unknown;
}): Promise<SaveConversationResult> {
  const user = await getCurrentAdminUser();
  if (!user) {
    return {
      status: "error",
      message: "この操作を行う権限がありません。再度ログインしてください。",
    };
  }

  const noteId =
    typeof input?.noteId === "string" && /^[a-z0-9]{1,64}$/i.test(input.noteId)
      ? input.noteId
      : undefined;

  try {
    const note = await conversationUseCases.saveConversationNote.execute(
      input?.messages,
      noteId,
    );
    revalidatePath("/conversations", "layout");
    return {
      status: "success",
      noteId: note.id,
      href: getLogDateHref(note.createdAt, "/conversations"),
      message: `${note.messageCount}件のメッセージを保存しました。`,
    };
  } catch (error) {
    if (!(error instanceof ConversationNoteValidationError))
      console.error("CONVERSATION_NOTE_SAVE_FAILED");
    return {
      status: "error",
      message:
        error instanceof ConversationNoteValidationError
          ? error.message
          : "会話ノートを保存できませんでした。時間をおいて再度お試しください。",
    };
  }
}
