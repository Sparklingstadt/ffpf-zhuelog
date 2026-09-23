import { safeValidateUIMessages } from "ai";

import type { StreamLearningChat } from "@/application/chat/use-cases/stream-learning-chat";
import type { LearningChatMessage } from "@/domain/chat/entities/chat-message";
import {
  BodyLimitError,
  readLimitedBody,
} from "@/infrastructure/http/read-limited-body";
import { isSameOriginRequest } from "../http/same-origin";

const MAX_MESSAGES = 40;
const MAX_TEXT_LENGTH = 40_000;

export async function handleChatRequest(
  request: Request,
  streamLearningChat: Pick<StreamLearningChat, "execute">,
) {
  if (!isSameOriginRequest(request))
    return Response.json(
      { error: "この画面から送信してください。" },
      { status: 403 },
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return Response.json(
      { error: "JSON形式で送信してください。" },
      { status: 415 },
    );
  let body: unknown;
  try {
    body = JSON.parse(
      (await readLimitedBody(request, 256 * 1024)).toString("utf8"),
    );
  } catch (error) {
    return Response.json(
      { error: "リクエストを読み取れませんでした。" },
      { status: error instanceof BodyLimitError ? 413 : 400 },
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

  try {
    return streamLearningChat.execute(messages, request.signal);
  } catch {
    return Response.json(
      { error: "応答を取得できませんでした。" },
      { status: 502 },
    );
  }
}
