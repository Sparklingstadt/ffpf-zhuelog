"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { z } from "zod";
import {
  conversationDraftSchema,
  conversationSchema,
  conversationContent,
  conversationTitle,
  type Conversation,
  type ConversationSummary,
} from "@ffpf-zhuelog/core/domain/chat/conversation";
import {
  conversationBackupKey,
  readConversationBackup,
  writeConversationBackup,
} from "@/infrastructure/chat/browser-conversation-history";
import { downloadConversation } from "@/presentation/presenters/conversation-markdown";
const summarySchema = conversationDraftSchema.omit({ messages: true });
function newDraft(modelName: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新しい会話",
    modelName,
    ended: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
function uiMessages(value: Conversation): UIMessage[] {
  return value.messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.text }],
  }));
}
export function useConversationHistory(
  ownerId: string | undefined,
  modelName: string,
  messages: UIMessage[],
  setMessages: (messages: UIMessage[]) => void,
  isBusy: boolean,
) {
  const [draft, setCurrent] = useState<Conversation | null>(null);
  const current = useMemo(() => {
    if (!draft) return null;
    const plain = messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        text: message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      }))
      .filter((message) => message.text.trim());
    if (JSON.stringify(draft.messages) === JSON.stringify(plain)) return draft;
    return {
      ...draft,
      messages: plain,
      title: conversationTitle(
        plain.find((message) => message.role === "user")?.text ?? "",
      ),
      updatedAt: new Date().toISOString(),
    };
  }, [draft, messages]);
  const [local, setLocal] = useState<Conversation[]>([]);
  const [remote, setRemote] = useState<ConversationSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedContent, setSavedContent] = useState<Record<string, string>>({});
  const localRef = useRef<Conversation[]>([]);
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const storageFailed = useRef(false);
  const persist = useCallback(
    (value: Conversation, viewOnly = viewing) => {
      if (!ownerId) return;
      const records = [
        value,
        ...localRef.current.filter((item) => item.id !== value.id),
      ];
      localRef.current = records.slice(0, 20);
      setLocal(localRef.current);
      if (storageFailed.current) return;
      try {
        localRef.current = writeConversationBackup(
          window.localStorage,
          ownerId,
          value.id,
          records,
          viewOnly,
        );
        setLocal(localRef.current);
        setBackupError("");
      } catch {
        setBackupError(
          "端末バックアップを保存できません。DB保存またはダウンロードを利用してください。",
        );
      }
    },
    [ownerId, viewing],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (!ownerId) {
        setCurrent(newDraft(modelName));
        setReady(true);
        return;
      }
      let value = newDraft(modelName);
      try {
        const backup = readConversationBackup(window.localStorage, ownerId);
        localRef.current = backup.conversations;
        setLocal(backup.conversations);
        setViewing(backup.viewOnly);
        value =
          backup.conversations.find((item) => item.id === backup.activeId) ??
          value;
      } catch {
        storageFailed.current = true;
        setBackupError(
          "端末バックアップを読み取れません。既存データの上書きを避けるため、DB保存かダウンロードを利用してください。",
        );
      }
      setCurrent(value);
      setMessages(uiMessages(value));
      setReady(true);
    });
    if (!ownerId) return () => controller.abort();
    fetch("/api/chat/conversations", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setRemote(
          z
            .array(summarySchema)
            .max(50)
            .parse(await response.json()),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError(
            "DBの保存履歴を取得できませんでした。端末バックアップは利用できます。",
          );
      });
    return () => controller.abort();
    // The component is keyed by owner; initialize a draft only once per login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
  useEffect(() => {
    if (!ready || !current) return;
    const timer = setTimeout(() => persist(current), isBusy ? 250 : 0);
    const flush = () => persist(currentRef.current ?? current);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [current, persist, ready, isBusy]);
  useEffect(() => {
    if (!ownerId) return;
    const sync = (event: StorageEvent) => {
      if (event.key !== conversationBackupKey(ownerId)) return;
      try {
        const backup = readConversationBackup(window.localStorage, ownerId);
        localRef.current = backup.conversations;
        setLocal(backup.conversations);
      } catch {
        setBackupError("別のタブのバックアップを読み取れませんでした。");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [ownerId]);
  async function save() {
    if (!current || saving || !ownerId) return;
    const snapshot = current;
    setSaving(true);
    setNotice("");
    // Saving also flushes a local backup; a DB failure never clears it.
    persist(snapshot);
    try {
      const response = await fetch("/api/chat/conversations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "DBへ保存できませんでした。",
        );
      const saved = conversationSchema.parse(body);
      setSavedContent((previous) => ({
        ...previous,
        [snapshot.id]: conversationContent(saved),
      }));
      setRemote((previous) =>
        [
          summarySchema.parse(saved),
          ...previous.filter((item) => item.id !== saved.id),
        ].slice(0, 50),
      );
      setHistoryError("");
      setCurrent((previous) =>
        previous?.id === saved.id &&
        conversationContent(currentRef.current ?? previous) ===
          conversationContent(snapshot)
          ? saved
          : previous,
      );
      setNotice("DBに会話を保存しました。");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "DBへ保存できませんでした。",
      );
    } finally {
      setSaving(false);
    }
  }
  function end() {
    if (!current) return;
    const value = {
      ...current,
      ended: true,
      updatedAt: new Date().toISOString(),
    };
    currentRef.current = value;
    persist(value);
    setCurrent(value);
    setNotice("会話を終了しました。保存・ダウンロードできます。");
  }
  function startNew() {
    if (current) persist(current);
    const value = newDraft(modelName);
    setCurrent(value);
    setMessages([]);
    setViewing(false);
    setNotice("");
    persist(value, false);
  }
  async function open(id: string) {
    if (current) persist(current);
    setLoading(true);
    setNotice("");
    const localValue = localRef.current.find((item) => item.id === id);
    const remoteValue = remote.find((item) => item.id === id);
    try {
      let value = localValue;
      if (remoteValue && (!value || remoteValue.updatedAt >= value.updatedAt)) {
        const response = await fetch(`/api/chat/conversations/${id}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        value = conversationSchema.parse(await response.json());
        setSavedContent((previous) => ({
          ...previous,
          [id]: conversationContent(value!),
        }));
      }
      if (!value) throw new Error();
      setCurrent(value);
      setMessages(uiMessages(value));
      setViewing(true);
      persist(value, true);
    } catch {
      if (localValue) {
        setCurrent(localValue);
        setMessages(uiMessages(localValue));
        setViewing(true);
        persist(localValue, true);
        setNotice("DBを取得できないため端末バックアップを表示しています。");
      } else setNotice("会話を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }
  const byId = new Map<string, ConversationSummary & { source: string }>();
  for (const value of remote)
    byId.set(value.id, { ...value, source: "DB保存済み" });
  for (const value of local.filter((item) => item.messages.length)) {
    const db = byId.get(value.id);
    if (!db || value.updatedAt > db.updatedAt)
      byId.set(value.id, {
        ...value,
        source: db ? "DB + 端末の未同期版" : "端末バックアップ",
      });
  }
  return {
    current,
    ready,
    viewing,
    saving,
    loading,
    backupError,
    historyError,
    notice,
    history: [...byId.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    isSaved: Boolean(
      current && savedContent[current.id] === conversationContent(current),
    ),
    save,
    end,
    startNew,
    open,
    download: () => {
      if (current) downloadConversation(current);
    },
  };
}
