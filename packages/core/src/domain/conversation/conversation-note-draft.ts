import { z } from "zod";

import type { ConversationNoteDraft } from "./entities/conversation-note";

export const MAX_CONVERSATION_MESSAGES = 100;
export const MAX_CONVERSATION_TEXT_LENGTH = 100_000;
const TITLE_LENGTH = 40;

// Only these intentional validation messages may cross the server boundary.
export class ConversationNoteValidationError extends Error {}

const messagesSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1),
    }),
  )
  .max(MAX_CONVERSATION_MESSAGES);

export function parseConversationNoteDraft(
  input: unknown,
): ConversationNoteDraft {
  const result = messagesSchema.safeParse(input);
  if (!result.success)
    throw new ConversationNoteValidationError(
      `会話の形式が不正です。保存できるのは${MAX_CONVERSATION_MESSAGES}件までのメッセージです。`,
    );

  const messages = result.data;
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser || !messages.some((message) => message.role === "assistant"))
    throw new ConversationNoteValidationError(
      "ChatGPTの応答がある会話だけを保存できます。",
    );
  const totalLength = messages.reduce(
    (total, message) => total + message.text.length,
    0,
  );
  if (totalLength > MAX_CONVERSATION_TEXT_LENGTH)
    throw new ConversationNoteValidationError(
      "会話が長すぎるため保存できません。",
    );

  return { title: toConversationTitle(firstUser.text), messages };
}

export function toConversationTitle(text: string) {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length > TITLE_LENGTH
    ? `${characters.slice(0, TITLE_LENGTH).join("")}…`
    : characters.join("");
}
