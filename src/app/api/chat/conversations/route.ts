import { conversationRepository } from "@/composition/conversation-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isChatEnabled } from "@/infrastructure/config/environment";
import {
  handleConversationSave,
  handleConversationRead,
} from "@/presentation/controllers/conversation-controller";
import { chatDisabledResponse } from "@/presentation/http/chat-disabled-response";
export const runtime = "nodejs";
export async function GET() {
  if (!isChatEnabled()) return chatDisabledResponse();
  return handleConversationRead(
    await getCurrentViewerUser(),
    conversationRepository,
  );
}
export async function PUT(request: Request) {
  if (!isChatEnabled()) return chatDisabledResponse();
  return handleConversationSave(
    request,
    await getCurrentViewerUser(),
    conversationRepository,
  );
}
