"use client";

import { useState } from "react";

import { VOCABULARY_LIMITS } from "@/domain/vocabulary/vocabulary-entry";
import type {
  DraftVocabularyResult,
  SaveVocabularyResult,
} from "@/presentation/actions/vocabulary-actions";

export type VocabularyDraftStatus =
  | { kind: "idle" }
  | { kind: "drafting" | "saving" }
  | { kind: "saved"; word: string }
  | { kind: "error"; message: string };

// One word on its way into the vocabulary book. AI drafts its pinyin and
// meaning from the word and the sentence it came from, and the user edits
// both before saving. The id is made here, so a retried save keeps one word.
export function useVocabularyDraft({
  sentence,
  sourceEntryId,
  draftVocabulary,
  saveVocabulary,
}: {
  sentence: string;
  sourceEntryId?: string;
  draftVocabulary: (input: {
    word: string;
    sentence: string;
  }) => Promise<DraftVocabularyResult>;
  saveVocabulary: (input: {
    id: string;
    word: string;
    pinyin: string;
    meaning: string;
    sourceEntryId?: string;
  }) => Promise<SaveVocabularyResult>;
}) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [word, setWord] = useState("");
  const [pinyin, setPinyin] = useState("");
  const [meaning, setMeaning] = useState("");
  const [status, setStatus] = useState<VocabularyDraftStatus>({
    kind: "idle",
  });
  // The pinyin and meaning came from AI and are still to be checked.
  const [drafted, setDrafted] = useState(false);
  const busy = status.kind === "drafting" || status.kind === "saving";

  // A typed word no longer matches the AI's draft.
  function changeWord(value: string) {
    setWord(value);
    setDrafted(false);
  }

  // Takes the text selected on the page as the word.
  function takeSelected(selected: string) {
    const text = selected.trim();
    if (text) setWord(text.slice(0, VOCABULARY_LIMITS.word));
    else
      setStatus({
        kind: "error",
        message: "先に、文の中の語句をドラッグして選んでください。",
      });
  }

  async function draft() {
    if (!word.trim()) {
      setStatus({ kind: "error", message: "語句を入力してください。" });
      return;
    }
    setStatus({ kind: "drafting" });
    let result: DraftVocabularyResult;
    try {
      result = await draftVocabulary({ word, sentence });
    } catch {
      result = { ok: false, message: "下書きを作れませんでした。" };
    }
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setPinyin(result.pinyin);
    setMeaning(result.meaning);
    setDrafted(true);
    setStatus({ kind: "idle" });
  }

  async function save() {
    setStatus({ kind: "saving" });
    let result: SaveVocabularyResult;
    try {
      result = await saveVocabulary({
        id,
        word,
        pinyin,
        meaning,
        ...(sourceEntryId ? { sourceEntryId } : {}),
      });
    } catch {
      result = {
        ok: false,
        message: "保存できませんでした。もう一度お試しください。",
      };
    }
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }
    setStatus({ kind: "saved", word: word.trim() });
    setId(crypto.randomUUID());
    setWord("");
    setPinyin("");
    setMeaning("");
    setDrafted(false);
  }

  return {
    word,
    pinyin,
    meaning,
    status,
    drafted,
    busy,
    changeWord,
    setPinyin,
    setMeaning,
    takeSelected,
    draft,
    save,
  };
}
