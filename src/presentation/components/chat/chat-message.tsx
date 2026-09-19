import type { UIMessage } from "ai";
import { Bot, CircleUserRound } from "lucide-react";

import { cn } from "@/presentation/lib/utils";

type ChatMessageProps = {
  message: UIMessage;
};

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  if (!text) return null;

  return (
    <article
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
      aria-label={isUser ? "あなたのメッセージ" : "ChatGPTのメッセージ"}
    >
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? <CircleUserRound className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[75%]",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border bg-card text-card-foreground shadow-xs",
        )}
      >
        {text}
      </div>
    </article>
  );
}
