import { notFound, redirect } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import type { ConversationSummary } from "@/domain/chat/conversation";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { ChatUnavailableError } from "@/infrastructure/go-api/conversation-gateway";

// The chat and conversation notes exist for members and admins: a signed-out
// visitor goes to `signInPath`, a guest gets a 404.
export async function requireChatUser(signInPath: string) {
  const user = await getCurrentViewerUser();
  if (!user) redirect(signInPath);
  if (!isMemberRole(user.role)) notFound();
  return user;
}

// The user's conversations, newest first, or null when Go has no chat
// (OPENAI_API_KEY is not set).
export async function loadConversationList(): Promise<
  ConversationSummary[] | null
> {
  try {
    return (await conversationNotes.list()).conversations;
  } catch (error) {
    if (error instanceof ChatUnavailableError) return null;
    throw error;
  }
}
