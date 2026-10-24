"use client";

import { Bot, Plus, Send, Sparkles, Square } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  conversationTitle,
  fitsLimits,
  type Conversation,
  type ConversationMessage,
} from "@/domain/chat/conversation";
import {
  saveConversationAction,
  type SaveConversationInput,
} from "@/presentation/actions/conversation-actions";
import { ChatMessage } from "@/presentation/components/chat/chat-message";
import { readChatStream } from "@/presentation/components/chat/chat-stream";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/presentation/components/ui/card";
import { Textarea } from "@/presentation/components/ui/textarea";

const MAX_INPUT_LENGTH = 4_000;
const FAILURE = "ChatGPTから応答を受信できませんでした。";
const CUT = "応答が途中で切れました。";
const STOPPED = "応答を停止しました。";
const LIMIT = "会話の上限に達しました。新しい会話を始めてください。";
const SAVE_FAILED =
  "保存できませんでした。次の回答のときにもう一度保存します。";

const starters = [
  "今日あったことを中国語で話す練習をしたいです。質問してください。",
  "自然な中国語の表現を、ピン音と日本語の説明付きで教えてください。",
  "HSK4級くらいの中国語で会話してください。間違いは会話後に直してください。",
];

type Meta = { id: string; createdAt: string | null; ended: boolean };

function newMeta(): Meta {
  return { id: crypto.randomUUID(), createdAt: null, ended: false };
}

function toSaveInput(
  meta: Meta,
  messages: ConversationMessage[],
  modelName: string,
): SaveConversationInput {
  return {
    id: meta.id,
    title: conversationTitle(messages[0]?.text ?? ""),
    modelName,
    ended: meta.ended,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    messages,
  };
}

// Reads the error text of a failed /api/chat: the relay's {error: string} or
// Go's {error: {message}}.
async function failureText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string };
    };
    const error = body.error;
    if (typeof error === "string" && error) return error;
    if (typeof error === "object" && error?.message) return error.message;
  } catch {
    // Not JSON.
  }
  return FAILURE;
}

// The admin's chat with ChatGPT. Every answer that arrives whole is saved
// with the whole conversation; an answer that is cut off is shown dimmed and
// left out, and its question goes back into the input to send again.
export function ChatInterface({
  chatModel,
  initial,
}: {
  chatModel: string;
  initial: Conversation | null;
}) {
  const [meta, setMeta] = useState<Meta>(() =>
    initial
      ? {
          id: initial.id,
          createdAt: initial.createdAt.toISOString(),
          ended: initial.ended,
        }
      : newMeta(),
  );
  const [messages, setMessages] = useState<ConversationMessage[]>(
    initial?.messages ?? [],
  );
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  // A cut-off answer, shown until the next send.
  const [cutAnswer, setCutAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // What was last saved, so an unchanged conversation is not sent again and
  // a failed save is retried after the next answer.
  const savedJson = useRef(
    initial
      ? JSON.stringify(
          toSaveInput(
            {
              id: initial.id,
              createdAt: initial.createdAt.toISOString(),
              ended: initial.ended,
            },
            initial.messages,
            initial.modelName,
          ),
        )
      : "",
  );
  const abort = useRef<AbortController | null>(null);
  // Bumped by "新しい会話" so a send that was running leaves the new
  // conversation alone.
  const generation = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, answer, cutAnswer]);

  // Stops a running answer when the page goes away.
  useEffect(() => () => abort.current?.abort(), []);

  async function save(next: Meta, nextMessages: ConversationMessage[]) {
    if (!nextMessages.length) return true;
    const value = toSaveInput(next, nextMessages, chatModel);
    const json = JSON.stringify(value);
    if (json === savedJson.current) return true;
    const started = generation.current;
    let result: Awaited<ReturnType<typeof saveConversationAction>>;
    try {
      result = await saveConversationAction(value);
    } catch {
      // Unreachable server or a failed action: retried after the next answer.
      result = { ok: false, message: "" };
    }
    // "新しい会話" was pressed meanwhile: the saved conversation is no longer
    // on screen.
    if (generation.current !== started) return true;
    if (!result.ok) return false;
    savedJson.current = json;
    // A reload opens the same conversation.
    window.history.replaceState(null, "", `/chat?id=${next.id}`);
    return true;
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || meta.ended) return;

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: question,
    };
    const asked = [...messages, userMessage];
    if (!fitsLimits(asked)) {
      const ended = { ...meta, ended: true };
      setMeta(ended);
      setNotice(
        (await save(ended, messages)) ? LIMIT : `${LIMIT} ${SAVE_FAILED}`,
      );
      return;
    }

    const current = {
      ...meta,
      createdAt: meta.createdAt ?? new Date().toISOString(),
    };
    setMeta(current);
    setMessages(asked);
    setInput("");
    setAnswer("");
    setCutAnswer("");
    setNotice("");
    setBusy(true);

    const controller = new AbortController();
    abort.current = controller;
    const started = generation.current;
    let received = "";
    let failure = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: asked.map(({ role, text }) => ({ role, text })),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        failure = await failureText(response);
      } else {
        const result = await readChatStream(response.body, (delta) => {
          received += delta;
          setAnswer(received);
        });
        if (result !== "done" || !received.trim())
          failure = typeof result === "object" ? result.error : CUT;
      }
    } catch {
      failure = controller.signal.aborted ? STOPPED : FAILURE;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
    if (generation.current !== started) return;
    setBusy(false);
    setAnswer("");

    if (failure) {
      // Leave the question out of the conversation so it can be sent again.
      setMessages(messages);
      setInput(question);
      setCutAnswer(received);
      setNotice(failure);
      return;
    }
    const answered: ConversationMessage[] = [
      ...asked,
      { id: crypto.randomUUID(), role: "assistant", text: received },
    ];
    setMessages(answered);
    // The answer that crosses the limits ends the conversation; Go accepts
    // it because the question was within them.
    const next = fitsLimits(answered) ? current : { ...current, ended: true };
    if (next.ended) setMeta(next);
    const saved = await save(next, answered);
    if (next.ended) setNotice(saved ? LIMIT : `${LIMIT} ${SAVE_FAILED}`);
    else if (!saved) setNotice(SAVE_FAILED);
  }

  function startNew() {
    generation.current += 1;
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setMeta(newMeta());
    setMessages([]);
    setInput("");
    setAnswer("");
    setCutAnswer("");
    setNotice("");
    savedJson.current = "";
    window.history.replaceState(null, "", "/chat");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
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
        {notice || meta.ended ? (
          <div className="space-y-1 px-4 pb-4 text-sm sm:px-6" role="status">
            {notice ? <p className="text-destructive">{notice}</p> : null}
            {meta.ended && !notice ? (
              <p>
                この会話は上限に達したため、読むだけです。「新しい会話」で練習を始められます。
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      {meta.ended ? null : (
        <CardFooter className="block border-t bg-card p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="メッセージを入力…"
              maxLength={MAX_INPUT_LENGTH}
              disabled={busy}
              aria-label="ChatGPTへのメッセージ"
              className="min-h-24 resize-y"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Enterで送信 · Shift + Enterで改行
              </p>
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => abort.current?.abort()}
                >
                  <Square className="fill-current" />
                  停止
                </Button>
              ) : (
                <Button type="submit" disabled={!input.trim()}>
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
