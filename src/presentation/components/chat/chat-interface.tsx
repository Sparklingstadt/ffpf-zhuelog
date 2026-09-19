"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Eraser, LoaderCircle, Send, Square, Sparkles } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { Alert, AlertDescription, AlertTitle } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/presentation/components/ui/card";
import { Textarea } from "@/presentation/components/ui/textarea";

const MAX_INPUT_LENGTH = 4_000;
const transport = new DefaultChatTransport({ api: "/api/chat" });

const starters = [
  "今日あったことを中国語で話す練習をしたいです。質問してください。",
  "自然な中国語の表現を、ピン音と日本語の説明付きで教えてください。",
  "HSK4級くらいの中国語で会話してください。間違いは会話後に直してください。",
];

type ChatInterfaceProps = {
  configured: boolean;
  modelName: string;
};

export function ChatInterface({ configured, modelName }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function submitText(text: string) {
    const nextMessage = text.trim();
    if (!configured || isBusy || !nextMessage) return;
    setInput("");
    void sendMessage({ text: nextMessage });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitText(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <Card className="min-h-[42rem] gap-0 py-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium">中国語学習アシスタント</p>
            <p className="truncate text-xs text-muted-foreground">{modelName} · 会話履歴は保存されません</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setMessages([])}
          disabled={messages.length === 0 || isBusy}
        >
          <Eraser />
          クリア
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        {!configured ? (
          <div className="p-4 sm:p-6">
            <Alert>
              <Sparkles />
              <AlertTitle>OpenAI APIキーを設定してください</AlertTitle>
              <AlertDescription>
                <code className="font-mono">OPENAI_API_KEY</code> を環境変数へ追加して開発サーバーを再起動すると、ここで会話できます。
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite">
          {messages.length === 0 ? (
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
                    className="h-auto justify-start whitespace-normal px-4 py-3 text-left leading-5"
                    disabled={!configured || isBusy}
                    onClick={() => submitText(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => <ChatMessage key={message.id} message={message} />)
          )}

          {status === "submitted" ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                <Bot className="size-4" />
              </div>
              <LoaderCircle className="size-4 animate-spin" />
              考えています…
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>応答を受信できませんでした</AlertTitle>
              <AlertDescription>APIキーや通信状態を確認して、もう一度お試しください。</AlertDescription>
            </Alert>
          ) : null}
          <div ref={endRef} />
        </div>
      </CardContent>

      <CardFooter className="block border-t bg-card p-4 sm:p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={configured ? "メッセージを入力…" : "OpenAI APIキーの設定後に利用できます"}
            maxLength={MAX_INPUT_LENGTH}
            disabled={!configured || isBusy}
            aria-label="ChatGPTへのメッセージ"
            className="min-h-24 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Enterで送信 · Shift + Enterで改行</p>
            {isBusy ? (
              <Button type="button" variant="outline" onClick={stop}>
                <Square className="fill-current" />
                停止
              </Button>
            ) : (
              <Button type="submit" disabled={!configured || !input.trim()}>
                <Send />
                送信
              </Button>
            )}
          </div>
        </form>
      </CardFooter>
    </Card>
  );
}
