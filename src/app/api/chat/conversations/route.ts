import { conversationRepository } from "@/composition/conversation-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import {
  handleConversationSave,
  handleConversationRead,
} from "@/presentation/controllers/conversation-controller";
export const runtime = "nodejs";
export async function GET() {
  return handleConversationRead(
    await getCurrentViewerUser(),
    conversationRepository,
  );
}
export async function PUT(request: Request) {
  return handleConversationSave(
    request,
    await getCurrentViewerUser(),
    conversationRepository,
  );
}
