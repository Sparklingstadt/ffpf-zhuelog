import type { Conversation } from "@ffpf-zhuelog/core/domain/chat/conversation";
export function conversationMarkdown(value: Conversation) {
  return (
    `# ${value.title.replace(/[\r\n]/g, " ")}\n\n日時: ${value.createdAt}\nモデル: ${value.modelName}\n状態: ${value.ended ? "終了" : "進行中"}\n\n` +
    value.messages
      .map(
        (message) =>
          `## ${message.role === "user" ? "あなた" : "ChatGPT"}\n\n${message.text}`,
      )
      .join("\n\n") +
    "\n"
  );
}
export function downloadConversation(value: Conversation) {
  const url = URL.createObjectURL(
    new Blob([conversationMarkdown(value)], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `conversation-${value.createdAt.slice(0, 10)}-${value.id}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
