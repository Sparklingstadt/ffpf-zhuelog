"use client";

import { Bot, Plus, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";

import { MAX_INPUT_CHARS, type Conversation } from "@/domain/chat/conversation";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { submitOnEnter } from "@/presentation/components/chat/chat-stream";
import { useChatConversation } from "@/presentation/components/chat/use-chat-conversation";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/presentation/components/ui/card";
import { Textarea } from "@/presentation/components/ui/textarea";

const starters = [
  "今日あったことを中国語で話す練習をしたいです。質問してください。",
  "自然な中国語の表現を、ピンインと日本語の説明付きで教えてください。",
  "HSK4級くらいの中国語で会話してください。間違いは会話後に直してください。",
];

// The user's chat with ChatGPT (members and admins). The conversation and
// its saving live in useChatConversation; this draws it.
export function ChatInterface({
  chatModel,
  initial,
}: {
  chatModel: string;
  initial: Conversation | null;
}) {
  const {
    messages,
    input,
    setInput,
    answer,
    cutAnswer,
    busy,
    notice,
    ended,
    send,
    stop,
    startNew,
  } = useChatConversation({ chatModel, initial });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, answer, cutAnswer]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  return (
    <Card className="min-h-[36rem] gap-0 py-0 shadow-sm">
      <CardHeader className="flex flex-col items-start justify-between gap-4 border-b py-4 sm:flex-row">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium">中国語学習アシスタント</p>
            <p className="text-xs text-muted-foreground">
              {chatModel} · 回答ごとに会話ノートへ保存します
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!messages.length && !busy}
          onClick={startNew}
        >
          <Plus />
          新しい会話
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        <div
          className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6"
          aria-live="polite"
        >
          {messages.length === 0 && !busy ? (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold">何を練習しますか？</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                中国語での会話、作文の添削、文法や語彙の質問ができます。日本語・中国語のどちらでも話しかけられます。
              </p>
              <div className="mt-6 grid w-full gap-2">
                {starters.map((starter) => (
                  <Button
                    key={starter}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal py-3 text-left"
                    onClick={() => void send(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              text={message.text}
            />
          ))}
          {busy ? (
            answer ? (
              <ChatMessage role="assistant" text={answer} />
            ) : (
              <p className="text-sm text-muted-foreground">考えています…</p>
            )
          ) : null}
          {cutAnswer ? (
            <ChatMessage role="assistant" text={cutAnswer} muted />
          ) : null}
          <div ref={endRef} />
        </div>
        {notice || ended ? (
          <div className="space-y-1 px-4 pb-4 text-sm sm:px-6" role="status">
            {notice ? <p className="text-destructive">{notice}</p> : null}
            {ended && !notice ? (
              <p>
                この会話は上限に達したため、読むだけです。「新しい会話」で練習を始められます。
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      {ended ? null : (
        <CardFooter className="block border-t bg-card p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={submitOnEnter}
              placeholder="メッセージを入力…"
              maxLength={MAX_INPUT_CHARS}
              disabled={busy}
              aria-label="ChatGPTへのメッセージ"
              className="min-h-24 resize-y"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Enterで送信 · Shift + Enterで改行
              </p>
              {/* Distinct keys: reusing one <button> would turn the clicked
                  stop button into a submit button before the click's default
                  action runs, sending the stopped message again. */}
              {busy ? (
                <Button
                  key="stop"
                  type="button"
                  variant="outline"
                  onClick={stop}
                >
                  <Square className="fill-current" />
                  停止
                </Button>
              ) : (
                <Button key="submit" type="submit" disabled={!input.trim()}>
                  <Send />
                  送信
                </Button>
              )}
            </div>
          </form>
        </CardFooter>
      )}
    </Card>
  );
}
