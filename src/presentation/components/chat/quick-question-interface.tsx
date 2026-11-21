"use client";

import Link from "next/link";
import { type FormEvent } from "react";
import { BookOpen, Plus, Send, Square } from "lucide-react";
import { MAX_QUESTION_CHARS } from "@/domain/chat/question";
import { ChatMessage } from "./chat-message";
import { submitOnEnter } from "./chat-stream";
import { useQuickQuestion } from "./use-quick-question";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/presentation/components/ui/card";
import { Textarea } from "@/presentation/components/ui/textarea";

// Starting points for a question; picking one puts it in the box to finish.
const EXAMPLES = [
  { label: "この文は自然？", text: "次の文は自然な中国語ですか？\n" },
  { label: "似た語の違い", text: "「」と「」の違いは何ですか？" },
  { label: "量詞は？", text: "「」に使う量詞は何ですか？" },
] as const;

// The question, its answer and saving live in useQuickQuestion; this draws
// them.
export function QuickQuestionInterface({ chatModel }: { chatModel: string }) {
  const {
    input,
    setInput,
    question,
    answer,
    status,
    busy,
    notice,
    note,
    submit,
    stop,
    retrySave,
    startNew,
  } = useQuickQuestion();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-4">
        <div>
          <p className="font-medium">1つの疑問を、すぐに解決</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {chatModel} · 質問と回答を自動保存
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status !== "saved"}
          onClick={startNew}
        >
          <Plus />
          新しい質問
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 py-6">
        {!question ? (
          <div className="space-y-2 py-6 text-center">
            <p className="font-medium">
              気になったことを、ひとつ聞いてみましょう
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              例：「了」と「过」はどう違う？
              <br />
              日本語・中国語のどちらでも質問できます。
            </p>
          </div>
        ) : (
          <ChatMessage role="user" text={question} />
        )}
        {answer ? (
          <>
            <ChatMessage
              role="assistant"
              text={answer}
              muted={status === "idle"}
            />
            <p className="text-xs text-muted-foreground">
              AI の回答です。まちがいを含むことがあります。
            </p>
          </>
        ) : null}
        {status === "asking" && !answer ? (
          <p role="status" className="text-sm text-muted-foreground">
            回答しています…
          </p>
        ) : null}
        {status === "saving" ? (
          <p role="status" className="text-sm text-muted-foreground">
            質問ノートに保存しています…
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className={
              status === "saved"
                ? "text-sm text-muted-foreground"
                : "text-sm text-destructive"
            }
          >
            {notice}
          </p>
        ) : null}
        {status === "save-failed" && note ? (
          <Button type="button" variant="outline" onClick={retrySave}>
            保存を再試行
          </Button>
        ) : null}
        {status === "saved" && note ? (
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href={`/questions/${note.id}`}>
                <BookOpen />
                質問ノートを見る
              </Link>
            </Button>
            <Button type="button" onClick={startNew}>
              <Plus />
              新しい質問
            </Button>
          </div>
        ) : null}
      </CardContent>
      {status === "idle" || status === "asking" ? (
        <CardFooter className="block border-t p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            {!question ? (
              <div
                role="group"
                aria-label="質問の例"
                className="flex flex-wrap gap-2"
              >
                {EXAMPLES.map((example) => (
                  <Button
                    key={example.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() => setInput(example.text)}
                  >
                    {example.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Textarea
              aria-label="クイック質問の内容"
              placeholder="中国語の疑問を入力…"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={submitOnEnter}
              disabled={busy}
              maxLength={MAX_QUESTION_CHARS}
              className="min-h-28 resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Enterで質問 · Shift + Enterで改行 · 質問は
                OpenAI（ChatGPT）に送られます
              </p>
              {/* Distinct keys: reusing one <button> would turn the clicked
                  stop button into a submit button before the click's default
                  action runs, sending the stopped question again. */}
              {status === "asking" ? (
                <Button
                  key="stop"
                  type="button"
                  variant="outline"
                  onClick={stop}
                >
                  <Square />
                  停止
                </Button>
              ) : (
                <Button key="submit" type="submit" disabled={!input.trim()}>
                  <Send />
                  質問する
                </Button>
              )}
            </div>
          </form>
        </CardFooter>
      ) : null}
    </Card>
  );
}
