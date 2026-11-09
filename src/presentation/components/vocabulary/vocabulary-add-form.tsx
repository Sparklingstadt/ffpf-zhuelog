"use client";

import {
  BookPlus,
  LoaderCircle,
  Sparkles,
  TextCursorInput,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { VOCABULARY_LIMITS } from "@/domain/vocabulary/vocabulary-entry";
import type {
  DraftVocabularyResult,
  SaveVocabularyResult,
} from "@/presentation/actions/vocabulary-actions";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";

type Status =
  | { kind: "idle" }
  | { kind: "drafting" | "saving" }
  | { kind: "saved"; word: string }
  | { kind: "error"; message: string };

// Picks a word into the vocabulary book. The word comes from the user (typed,
// or the text selected on the page); AI drafts its pinyin and meaning from
// the word and the sentence it came from, and the user edits both before
// saving. The id is made here, so a retried save keeps one word.
export function VocabularyAddForm({
  sentence = "",
  sourceEntryId,
  draftVocabulary,
  saveVocabulary,
}: {
  // The sentence the word is picked from, sent to AI as context.
  sentence?: string;
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
  const ids = useId();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [word, setWord] = useState("");
  const [pinyin, setPinyin] = useState("");
  const [meaning, setMeaning] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "drafting" || status.kind === "saving";

  function takeSelection() {
    const selected = window.getSelection()?.toString().trim() ?? "";
    if (selected) setWord(selected.slice(0, VOCABULARY_LIMITS.word));
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
    setStatus({ kind: "idle" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
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
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-word`} className="text-sm font-medium">
          語句
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${ids}-word`}
            lang="zh-CN"
            value={word}
            maxLength={VOCABULARY_LIMITS.word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="例：认真"
            className="max-w-56"
            required
          />
          {sentence ? (
            // onMouseDown keeps the page's selection from being cleared.
            <Button
              type="button"
              variant="outline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={takeSelection}
              disabled={busy}
            >
              <TextCursorInput /> 選んだ語句を入れる
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void draft()}
            disabled={busy}
          >
            {status.kind === "drafting" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            AIで下書き
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-pinyin`} className="text-sm font-medium">
            ピンイン
          </label>
          <Input
            id={`${ids}-pinyin`}
            value={pinyin}
            maxLength={VOCABULARY_LIMITS.pinyin}
            onChange={(e) => setPinyin(e.target.value)}
            placeholder="例：rènzhēn"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-meaning`} className="text-sm font-medium">
            意味
          </label>
          <Input
            id={`${ids}-meaning`}
            value={meaning}
            maxLength={VOCABULARY_LIMITS.meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="例：まじめに、真剣に"
            required
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {status.kind === "saving" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <BookPlus />
          )}
          単語帳に入れる
        </Button>
        <p aria-live="polite" className="text-sm">
          {status.kind === "saved" ? (
            <span className="text-muted-foreground">
              「<span lang="zh-CN">{status.word}</span>」を単語帳に入れました。
            </span>
          ) : status.kind === "error" ? (
            <span role="alert" className="text-destructive">
              {status.message}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
