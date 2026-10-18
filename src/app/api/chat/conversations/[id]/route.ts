import { conversationRepository } from "@/composition/conversation-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isChatEnabled } from "@/infrastructure/config/environment";
import { handleConversationRead } from "@/presentation/controllers/conversation-controller";
import { chatDisabledResponse } from "@/presentation/http/chat-disabled-response";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isChatEnabled()) return chatDisabledResponse();
  return handleConversationRead(
    await getCurrentViewerUser(),
    conversationRepository,
    (await context.params).id,
  );
}
