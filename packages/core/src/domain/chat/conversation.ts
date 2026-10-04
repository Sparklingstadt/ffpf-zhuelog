import { z } from "zod";

export const conversationMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant"]),
  text: z
    .string()
    .min(1)
    .max(40_000)
    .refine((value) => Boolean(value.trim())),
});
const messagesSchema = z
  .array(conversationMessageSchema)
  .max(40)
  .refine(
    (messages) =>
      messages.reduce((length, message) => length + message.text.length, 0) <=
      40_000,
  )
  .refine(
    (messages) =>
      new Set(messages.map((message) => message.id)).size === messages.length,
  );
export const conversationDraftSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(100),
  modelName: z.string().min(1).max(150),
  ended: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  messages: messagesSchema,
});
export const conversationSchema = conversationDraftSchema.refine(
  (value) => value.messages.length > 0,
);
export type Conversation = z.infer<typeof conversationDraftSchema>;
export type ConversationSummary = Omit<Conversation, "messages">;
export class ConversationOwnershipError extends Error {}
export function conversationTitle(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || "新しい会話";
}
export function conversationContent(value: Conversation) {
  return JSON.stringify([value.messages, value.ended, value.modelName]);
}
