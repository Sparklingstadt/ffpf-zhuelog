import { createConversationGateway } from "@/infrastructure/go-api/conversation-gateway";

// The admin's saved chat conversations go through the Go API as the
// signed-in user.
export const conversationNotes = createConversationGateway();
