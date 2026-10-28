import { Bot, CircleUserRound } from "lucide-react";

import type { ChatRole } from "@/domain/chat/conversation";
import { cn } from "@/presentation/lib/utils";

// Shared by the live chat and saved conversation notes. Text keeps its line
// breaks; it is never rendered as Markdown or HTML.
export function ChatMessage({
  role,
  text,
  muted = false,
}: {
  role: ChatRole;
  text: string;
  // A cut-off answer that is shown but not kept.
  muted?: boolean;
}) {
  const isUser = role === "user";

  if (!text) return null;

  return (
    <article
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
      aria-label={isUser ? "あなたのメッセージ" : "ChatGPTのメッセージ"}
    >
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? (
          <CircleUserRound className="size-4" />
        ) : (
          <Bot className="size-4" />
        )}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[85%] [overflow-wrap:anywhere] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[75%]",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border bg-card text-card-foreground shadow-xs",
          muted && "opacity-60",
        )}
      >
        {text}
      </div>
    </article>
  );
}
