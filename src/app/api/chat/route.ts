import { conversationNotes } from "@/composition/chat-container";
import { handleChat } from "@/presentation/controllers/chat-controller";

export const dynamic = "force-dynamic";
// OpenAI's answer is cut at 60 seconds; 90 leaves room to end the response.
export const maxDuration = 90;

export async function POST(request: Request) {
  return handleChat(request, { chatter: () => conversationNotes.chatter() });
}
