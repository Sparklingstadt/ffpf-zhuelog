import { safeValidateUIMessages } from "ai";

import type { StreamLearningChat } from "@/application/chat/use-cases/stream-learning-chat";
import type { LearningChatMessage } from "@/domain/chat/entities/chat-message";

const MAX_MESSAGES = 40;
const MAX_TEXT_LENGTH = 40_000;

export async function handleChatRequest(
  request: Request,
  streamLearningChat: StreamLearningChat,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "リクエストを読み取れませんでした。" },
      { status: 400 },
    );
  }

  const rawMessages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body as { messages?: unknown }).messages
      : undefined;

  if (
    !Array.isArray(rawMessages) ||
    rawMessages.length === 0 ||
    rawMessages.length > MAX_MESSAGES
  ) {
    return Response.json(
      { error: "会話履歴の件数が不正です。" },
      { status: 400 },
    );
  }

  const validation = await safeValidateUIMessages({ messages: rawMessages });
  if (!validation.success) {
    return Response.json(
      { error: "会話データの形式が不正です。" },
      { status: 400 },
    );
  }

  const messages: LearningChatMessage[] = validation.data.map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    text: message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  }));
  const totalTextLength = messages.reduce(
    (total, message) => total + message.text.length,
    0,
  );

  if (
    validation.data.some(
      (message) => message.role !== "user" && message.role !== "assistant",
    ) ||
    messages.at(-1)?.role !== "user" ||
    messages.some((message) => !message.text) ||
    totalTextLength > MAX_TEXT_LENGTH
  ) {
    return Response.json(
      { error: "会話内容が上限を超えているか、形式が不正です。" },
      { status: 400 },
    );
  }

  return streamLearningChat.execute(messages, request.signal);
}
