"use client";

import { conversationDraftSchema } from "@ffpf-zhuelog/core/domain/chat/conversation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  Bot,
  Download,
  Save,
  Plus,
  LoaderCircle,
  Send,
  Square,
  Sparkles,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import { useConversationHistory } from "./use-conversation-history";
import { ConversationHistory } from "./conversation-history";

import { ChatMessage } from "@/presentation/components/chat/chat-message";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/presentation/components/ui/card";
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
  localCodex?: boolean;
  ownerId?: string;
};

export function ChatInterface({
  configured,
  modelName,
  localCodex = false,
  ownerId,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [limitError, setLimitError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    transport,
  });
  const isBusy = status === "submitted" || status === "streaming";
  const history = useConversationHistory(
    ownerId,
    modelName,
    messages,
    setMessages,
    isBusy,
  );
  const closed = Boolean(history.current?.ended || history.viewing);
  const blocked = isBusy || history.saving || history.loading || !history.ready;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function submitText(text: string) {
    const nextMessage = text.trim();
    if (!configured || blocked || closed || !nextMessage) return;
    const current = history.current;
    if (
      current &&
      (current.messages.length >= 39 ||
        !conversationDraftSchema.safeParse({
          ...current,
          messages: [
            ...current.messages,
            { id: crypto.randomUUID(), role: "user", text: nextMessage },
          ],
        }).success)
    ) {
      setLimitError(
        "会話の上限に達しました。保存・ダウンロードしてから、新しい会話を始めてください。",
      );
      return;
    }
    setLimitError("");
    setInput("");
    void sendMessage({ text: nextMessage });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitText(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <Card className="min-h-[42rem] gap-0 py-0 shadow-sm">
      <CardHeader className="flex flex-col items-start justify-between gap-4 border-b py-4 sm:flex-row">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium">中国語学習アシスタント</p>
            <p className="text-xs text-muted-foreground">
              {history.current?.modelName ?? modelName} ·{" "}
              {history.isSaved ? "DB保存済み" : "DBへは保存ボタンで保存"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !messages.length || closed || history.saving || history.loading
            }
            onClick={() => {
              stop();
              history.end();
              setInput("");
            }}
          >
            <Square />
            会話を終える
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !messages.length || blocked || !ownerId || history.isSaved
            }
            onClick={() => void history.save()}
          >
            <Save />
            {history.saving ? "保存中…" : "会話を保存する"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!messages.length || blocked}
            onClick={history.download}
          >
            <Download />
            端末にダウンロード
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={blocked}
            onClick={() => {
              history.startNew();
              setLimitError("");
              setInput("");
            }}
          >
            <Plus />
            新しい会話
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        <div className="space-y-2 px-4 pt-4 text-sm sm:px-6" role="status">
          {!ownerId ? (
            <p>
              履歴保存には、一度ログアウトしてGitHubでログインし直してください。
            </p>
          ) : null}
          {history.backupError ? (
            <p className="text-destructive">{history.backupError}</p>
          ) : ownerId && history.current?.messages.length ? (
            <p className="text-muted-foreground">
              LocalStorageに自動バックアップします（最新20会話・合計1MiBまで）。
            </p>
          ) : null}
          {history.historyError ? (
            <p className="text-destructive">{history.historyError}</p>
          ) : null}
          {history.notice ? <p>{history.notice}</p> : null}
          {limitError ? <p className="text-destructive">{limitError}</p> : null}
          {closed ? (
            <p>この会話は閲覧のみです。「新しい会話」で練習を始められます。</p>
          ) : null}
        </div>
        {localCodex ? (
          <div className="p-4 sm:px-6">
            <Alert>
              <AlertTitle>Codex Business · ローカル試作</AlertTitle>
              <AlertDescription>
                このMacでログイン中のCodex利用枠を消費します。会話はOpenAIへ送信されます。
                API課金への自動切り替えはありません。ファイル・外部サービスの操作は無効です。
                {configured
                  ? ""
                  : " pnpm run dev:codex でローカル起動してください。"}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        {!configured && !localCodex ? (
          <div className="p-4 sm:p-6">
            <Alert>
              <Sparkles />
              <AlertTitle>OpenAI APIキーを設定してください</AlertTitle>
              <AlertDescription>
                <code className="font-mono">OPENAI_API_KEY</code>{" "}
                を環境変数へ追加して開発サーバーを再起動すると、ここで会話できます。
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div
          className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6"
          aria-live="polite"
        >
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
                    disabled={!configured || blocked || closed}
                    onClick={() => submitText(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))
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
              <AlertDescription>
                {localCodex
                  ? error.message
                  : "APIキーや通信状態を確認して、もう一度お試しください。"}
              </AlertDescription>
            </Alert>
          ) : null}
          <div ref={endRef} />
        </div>
      </CardContent>

      <ConversationHistory
        history={history.history}
        disabled={blocked}
        onOpen={(id) => void history.open(id)}
      />

      <CardFooter className="block border-t bg-card p-4 sm:p-5">
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              configured
                ? "メッセージを入力…"
                : "OpenAI APIキーの設定後に利用できます"
            }
            maxLength={MAX_INPUT_LENGTH}
            disabled={!configured || blocked || closed}
            aria-label="ChatGPTへのメッセージ"
            className="min-h-24 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Enterで送信 · Shift + Enterで改行
            </p>
            {isBusy ? (
              <Button type="button" variant="outline" onClick={stop}>
                <Square className="fill-current" />
                停止
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!configured || blocked || closed || !input.trim()}
              >
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
