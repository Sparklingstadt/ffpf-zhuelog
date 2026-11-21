import { notFound, redirect } from "next/navigation";

import { conversationNotes } from "@/composition/chat-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import type { ConversationSummary } from "@/domain/chat/conversation";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";

// The chat and conversation notes exist for members and admins: a signed-out
// visitor goes to `signInPath`, a guest gets a 404.
export async function requireChatUser(signInPath: string) {
  const user = await getCurrentViewerUser();
  if (!user) redirect(signInPath);
  if (!isMemberRole(user.role)) notFound();
  return user;
}

// The user's conversations, newest first.
export async function loadConversationList(): Promise<ConversationSummary[]> {
  return (await conversationNotes.list()).conversations;
}
