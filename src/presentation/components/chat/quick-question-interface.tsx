"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { BookOpen, Plus, Send, Square } from "lucide-react";
import {
  MAX_QUESTION_CHARS,
  type SaveQuestionInput,
} from "@/domain/chat/question";
import { saveQuestionAction } from "@/presentation/actions/question-actions";
import { ChatMessage } from "./chat-message";
import { readChatStream } from "./chat-stream";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/presentation/components/ui/card";
import { Textarea } from "@/presentation/components/ui/textarea";

type Status = "idle" | "asking" | "saving" | "saved" | "save-failed";
const FAILURE =
  "回答を受信できませんでした。質問を確認して、もう一度送信してください。";

export function QuickQuestionInterface({ chatModel }: { chatModel: string }) {
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState<SaveQuestionInput | null>(null);
  const abort = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  const busy = status === "asking" || status === "saving";

  async function save(value: SaveQuestionInput) {
    setStatus("saving");
    let ok = false;
    try {
      ok = (await saveQuestionAction(value)).ok;
    } catch {
      /* Keep the answer available to retry. */
    }
    if (!mounted.current) return;
    setStatus(ok ? "saved" : "save-failed");
    setNotice(
      ok
        ? "質問ノートに保存しました。"
        : "質問ノートに保存できませんでした。回答はこの画面に残っています。保存を再試行してください。",
    );
    locked.current = false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || locked.current || status !== "idle") return;
    if ([...text].length > MAX_QUESTION_CHARS) {
      setNotice("質問は4,000文字以内で入力してください。");
      return;
    }
    locked.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setQuestion(text);
    setAnswer("");
    setNotice("");
    setStatus("asking");
    let received = "";
    try {
      const response = await fetch("/api/quick-question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", text }] }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(FAILURE);
      const result = await readChatStream(response.body, (delta) => {
        received += delta;
        if (mounted.current) setAnswer(received);
      });
      if (result !== "done" || !received.trim()) throw new Error(FAILURE);
      if (!mounted.current) return;
      const value = {
        id: crypto.randomUUID(),
        question: text,
        answer: received,
      };
      setNote(value);
      setInput("");
      await save(value);
    } catch {
      if (!mounted.current) return;
      setStatus("idle");
      setNotice(
        controller.signal.aborted
          ? "回答を停止しました。途中の回答は保存されません。もう一度送信できます。"
          : FAILURE,
      );
      locked.current = false;
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  function startNew() {
    if (locked.current || status !== "saved") return;
    setInput("");
    setQuestion("");
    setAnswer("");
    setNote(null);
    setNotice("");
    setStatus("idle");
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
          <ChatMessage
            role="assistant"
            text={answer}
            muted={status === "idle"}
          />
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
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (locked.current) return;
              locked.current = true;
              void save(note);
            }}
          >
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
          <form onSubmit={submit} className="space-y-3">
            <Textarea
              aria-label="クイック質問の内容"
              placeholder="中国語の疑問を入力…"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={keyDown}
              disabled={busy}
              maxLength={MAX_QUESTION_CHARS}
              className="min-h-28 resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Enterで質問 · Shift + Enterで改行
              </p>
              {status === "asking" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => abort.current?.abort()}
                >
                  <Square />
                  停止
                </Button>
              ) : (
                <Button type="submit" disabled={!input.trim()}>
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
