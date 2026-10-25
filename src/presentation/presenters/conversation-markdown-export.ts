import type { Conversation } from "@/domain/chat/conversation";
import type { LogDate } from "@/domain/calendar/value-objects/log-date";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

const SPEAKER = { user: "あなた", assistant: "ChatGPT" } as const;

// A conversation note as Markdown: the title, when and with which model, then
// one section per message. Message text is written as it is, so ChatGPT's own
// Markdown keeps working in the file.
export function toConversationMarkdown(conversation: Conversation): string {
  const header = [
    `# ${conversation.title}`,
    "",
    `- 日時: ${formatTokyoDateTime(conversation.createdAt)}`,
    `- モデル: ${conversation.modelName}`,
  ];
  const messages = conversation.messages
    .filter((message) => message.text)
    .flatMap((message) => [
      "",
      `## ${SPEAKER[message.role]}`,
      "",
      message.text,
    ]);
  return `${[...header, ...messages].join("\n")}\n`;
}

// Named after the day and number in the conversation's URL.
export function conversationMarkdownFileName(
  date: LogDate,
  number: number,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `huihua-${date.year}-${pad(date.month)}-${pad(date.day)}-${number}.md`;
}
