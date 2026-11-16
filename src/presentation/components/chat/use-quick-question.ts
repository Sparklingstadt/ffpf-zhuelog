"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  MAX_QUESTION_CHARS,
  type SaveQuestionInput,
} from "@/domain/chat/question";
import { saveQuestionAction } from "@/presentation/actions/question-actions";
import { useAnswerStream } from "@/presentation/components/chat/use-answer-stream";

export type QuickQuestionStatus =
  "idle" | "asking" | "saving" | "saved" | "save-failed";

const FAILURE =
  "回答を受信できませんでした。質問を確認して、もう一度送信してください。";
const STOPPED =
  "回答を停止しました。途中の回答は保存されません。もう一度送信できます。";

// One question to ChatGPT, saved as a question note once the whole answer
// has arrived. A stopped or failed answer stays on screen dimmed and is not
// saved; a failed save can be retried.
export function useQuickQuestion() {
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<QuickQuestionStatus>("idle");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState<SaveQuestionInput | null>(null);
  const router = useRouter();
  // Set from a click until its state change lands, so a double click does
  // not send or save twice.
  const locked = useRef(false);
  const { ask, stop, isMounted } = useAnswerStream();
  const busy = status === "asking" || status === "saving";

  async function save(value: SaveQuestionInput) {
    setStatus("saving");
    let ok = false;
    try {
      ok = (await saveQuestionAction(value)).ok;
    } catch {
      /* Keep the answer available to retry. */
    }
    if (!isMounted()) return;
    // The page's list of question notes picks up the new one.
    if (ok) router.refresh();
    setStatus(ok ? "saved" : "save-failed");
    setNotice(
      ok
        ? "質問ノートに保存しました。"
        : "質問ノートに保存できませんでした。回答はこの画面に残っています。保存を再試行してください。",
    );
    locked.current = false;
  }

  async function submit() {
    const text = input.trim();
    if (!text || locked.current || status !== "idle") return;
    if ([...text].length > MAX_QUESTION_CHARS) {
      setNotice(
        `質問は${MAX_QUESTION_CHARS.toLocaleString("ja-JP")}文字以内で入力してください。`,
      );
      return;
    }
    locked.current = true;
    setQuestion(text);
    setAnswer("");
    setNotice("");
    setStatus("asking");
    const result = await ask({
      endpoint: "/api/quick-question",
      messages: [{ role: "user", text }],
      onText: setAnswer,
      texts: { failure: FAILURE, cut: FAILURE, stopped: STOPPED },
    });
    if (!result) return;
    if (!result.ok) {
      setStatus("idle");
      setNotice(result.message);
      locked.current = false;
      return;
    }
    const value = {
      id: crypto.randomUUID(),
      question: text,
      answer: result.text,
    };
    setNote(value);
    setInput("");
    await save(value);
  }

  function retrySave() {
    if (locked.current || !note) return;
    locked.current = true;
    void save(note);
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

  return {
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
  };
}
