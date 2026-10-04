import type { LearningChatMessage } from "../../chat/entities/chat-message";

export type ConversationMessage = LearningChatMessage & {
  id: string;
  position: number;
};

export type ConversationNote = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessage[];
};

export type ConversationNoteSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
};

export type ConversationNoteDraft = {
  title: string;
  messages: LearningChatMessage[];
};
