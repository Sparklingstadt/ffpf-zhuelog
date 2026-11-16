// A member's or an admin's practice conversation with ChatGPT. The web checks
// these limits when it answers and saves; the chat screen checks them too, to
// stop before it sends a request the server would refuse.

import { MAX_ANSWER_CHARS } from "./question";

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

// One turn of a chat request, sent to OpenAI as it is.
export type ChatTurn = { role: ChatRole; text: string };

export const MAX_MESSAGES = 40;
// Counted in characters (code points), as Go counts runes.
export const MAX_TOTAL_CHARS = 40_000;
// How long one message typed into the chat may be. Only the input box limits
// it; Go checks the total above.
export const MAX_INPUT_CHARS = 4_000;
const MAX_TITLE_CHARS = 80;
export const CONVERSATION_LIST_LIMIT = 100;
// A lower-case UUID, as the browser's crypto.randomUUID() makes them.
export const CONVERSATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_SAVED_TITLE_CHARS = 100;
export const MAX_MODEL_NAME_CHARS = 150;
export const MAX_MESSAGE_ID_CHARS = 200;

// What the browser sends to save a conversation (createdAt is ISO 8601).
export type SaveConversationInput = {
  id: string;
  title: string;
  modelName: string;
  ended: boolean;
  createdAt: string;
  messages: ConversationMessage[];
};

// A conversation as it is saved: title trimmed, createdAt a Date.
export type CheckedConversation = Omit<Conversation, "updatedAt">;

// An ISO 8601 date-time in UTC with seconds, as Date.toISOString() and zod's
// z.iso.datetime() write it.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

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

// Lengths are counted in code points, as Go counted runes.
function chars(text: string): number {
  return [...text].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRole(role: unknown): role is ChatRole {
  return role === "user" || role === "assistant";
}

// The turns of a POST /api/chat body, untrimmed, or null when Go would have
// answered 400 (decodeBody plus chat.Validate).
// Go: httpapi/chat_handlers.go streamChat and chat/chat.go Validate.
export function chatTurns(body: unknown): ChatTurn[] | null {
  // Unknown keys are refused at every level, as Go's DisallowUnknownFields.
  if (!isRecord(body) || !hasOnlyKeys(body, ["messages"])) return null;
  const messages = body.messages;
  if (!Array.isArray(messages)) return null;
  if (messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const message of messages as unknown[]) {
    if (!isRecord(message) || !hasOnlyKeys(message, ["role", "text"]))
      return null;
    const { role, text } = message;
    if (!isRole(role) || typeof text !== "string") return null;
    if (text.trim() === "") return null;
    // Counted before trimming, as Go counted them.
    total += chars(text);
    turns.push({ role, text });
  }
  if (turns[turns.length - 1].role !== "user") return null;
  if (total > MAX_TOTAL_CHARS) return null;
  return turns;
}

// The conversation as it is saved, or null when Go would have answered 400
// or 404 (an id of the wrong shape).
// Go: httpapi/chat_handlers.go putConversation and validConversation.
export function checkConversation(
  input: SaveConversationInput,
): CheckedConversation | null {
  if (!CONVERSATION_ID.test(input.id)) return null;
  const title = input.title.trim();
  if (title === "" || chars(title) > MAX_SAVED_TITLE_CHARS) return null;
  const { modelName } = input;
  if (modelName === "" || chars(modelName) > MAX_MODEL_NAME_CHARS) return null;
  if (!ISO_DATE_TIME.test(input.createdAt)) return null;
  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.getTime())) return null;

  const { messages } = input;
  if (messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.id === "" || chars(message.id) > MAX_MESSAGE_ID_CHARS)
      return null;
    if (ids.has(message.id)) return null;
    ids.add(message.id);
    if (!isRole(message.role) || message.text.trim() === "") return null;
  }
  // The answer that takes a conversation over the limit is still saved: its
  // question was within the limit when it was sent. It is bounded on its own.
  const last = messages[messages.length - 1];
  const counted = last.role === "assistant" ? messages.slice(0, -1) : messages;
  if (last.role === "assistant" && chars(last.text) > MAX_ANSWER_CHARS)
    return null;
  const total = counted.reduce((sum, message) => sum + chars(message.text), 0);
  if (total > MAX_TOTAL_CHARS) return null;

  return {
    id: input.id,
    title,
    modelName,
    ended: input.ended,
    createdAt,
    messages: messages.map(({ id, role, text }) => ({ id, role, text })),
  };
}
