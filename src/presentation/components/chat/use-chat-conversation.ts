"use client";

import { useRef, useState } from "react";

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
import { useAnswerStream } from "@/presentation/components/chat/use-answer-stream";

const FAILURE = "ChatGPTから応答を受信できませんでした。";
const CUT = "応答が途中で切れました。";
const STOPPED = "応答を停止しました。";
const LIMIT = "会話の上限に達しました。新しい会話を始めてください。";
const SAVE_FAILED =
  "保存できませんでした。次の回答のときにもう一度保存します。";

type Meta = { id: string; createdAt: string | null; ended: boolean };

function newMeta(): Meta {
  return { id: crypto.randomUUID(), createdAt: null, ended: false };
}

function metaOf(conversation: Conversation): Meta {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    ended: conversation.ended,
  };
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

// The user's chat with ChatGPT. Every answer that arrives whole is saved
// with the whole conversation; an answer that is cut off is kept apart as
// `cutAnswer` and left out, and its question goes back into the input to
// send again.
export function useChatConversation({
  chatModel,
  initial,
}: {
  chatModel: string;
  initial: Conversation | null;
}) {
  const [meta, setMeta] = useState<Meta>(() =>
    initial ? metaOf(initial) : newMeta(),
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
          toSaveInput(metaOf(initial), initial.messages, initial.modelName),
        )
      : "",
  );
  // Bumped by "新しい会話" so a send that was running leaves the new
  // conversation alone.
  const generation = useRef(0);
  const { ask, stop } = useAnswerStream();

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

    const started = generation.current;
    const result = await ask({
      endpoint: "/api/chat",
      messages: asked.map(({ role, text }) => ({ role, text })),
      onText: setAnswer,
      texts: { failure: FAILURE, cut: CUT, stopped: STOPPED },
    });
    if (!result || generation.current !== started) return;
    setBusy(false);
    setAnswer("");

    if (!result.ok) {
      // Leave the question out of the conversation so it can be sent again.
      setMessages(messages);
      setInput(question);
      setCutAnswer(result.text);
      setNotice(result.message);
      return;
    }
    const answered: ConversationMessage[] = [
      ...asked,
      { id: crypto.randomUUID(), role: "assistant", text: result.text },
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
    stop();
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

  return {
    messages,
    input,
    setInput,
    answer,
    cutAnswer,
    busy,
    notice,
    ended: meta.ended,
    send,
    stop,
    startNew,
  };
}
