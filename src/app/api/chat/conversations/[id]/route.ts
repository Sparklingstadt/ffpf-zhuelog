import { conversationRepository } from "@/composition/conversation-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { handleConversationRead } from "@/presentation/controllers/conversation-controller";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleConversationRead(
    await getCurrentViewerUser(),
    conversationRepository,
    (await context.params).id,
  );
}
