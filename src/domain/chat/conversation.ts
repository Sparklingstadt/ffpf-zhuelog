// An admin's practice conversation with ChatGPT. The Go API checks the same
// limits; these let the chat screen stop before it sends a request Go would
// reject.

export type ChatRole = "user" | "assistant";

export type ConversationMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  modelName: string;
  // Reached the limits; the conversation can only be read.
  ended: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Conversation = ConversationSummary & {
  messages: ConversationMessage[];
};

export const MAX_MESSAGES = 40;
// Counted in characters (code points), as Go counts runes.
export const MAX_TOTAL_CHARS = 40_000;
const MAX_TITLE_CHARS = 80;

export function conversationTitle(text: string): string {
  const squeezed = text.replace(/\s+/g, " ").trim();
  return [...squeezed].slice(0, MAX_TITLE_CHARS).join("") || "新しい会話";
}

export function fitsLimits(messages: { text: string }[]): boolean {
  const total = messages.reduce(
    (sum, message) => sum + [...message.text].length,
    0,
  );
  return messages.length <= MAX_MESSAGES && total <= MAX_TOTAL_CHARS;
}
