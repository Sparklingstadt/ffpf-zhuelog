"use client";

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";

import type { VocabularyEntry } from "@/domain/vocabulary/vocabulary-entry";
import type { ActionState } from "@/presentation/controllers/action-state";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { SpeakButton } from "@/presentation/components/speech/speak-button";
import { Input } from "@/presentation/components/ui/input";
import { matchesVocabulary } from "@/presentation/presenters/vocabulary-search";

// The words of the book as cards, with a search over their word, pinyin and
// meaning that narrows the cards as it is typed.
export function VocabularyList({
  entries,
  nextReviews = {},
  deleteVocabulary,
}: {
  entries: VocabularyEntry[];
  // When each word comes back, by id (「明日」「11/20」), made on the server.
  nextReviews?: Readonly<Record<string, string>>;
  deleteVocabulary: (
    previous: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const shown = entries.filter((entry) => matchesVocabulary(entry, query));
  const searching = query.trim() !== "";

  return (
    <section className="space-y-3" aria-label="単語の一覧">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-lg font-semibold tracking-tight">
          入れた語句{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {entries.length}語
          </span>
        </h2>
        <label htmlFor={searchId} className="sr-only">
          単語帳の中を探す
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="語句・ピンイン・意味で探す"
          className="h-10 w-full sm:w-80"
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {searching ? `${shown.length}語が見つかりました` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          「{query.trim()}」に合う語句はありません。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1 rounded-xl border bg-card px-5 py-4"
            >
              <div className="flex items-center gap-2">
                <p
                  lang="zh-CN"
                  className="min-w-0 flex-1 truncate text-2xl font-semibold"
                >
                  {entry.word}
                </p>
                <SpeakButton text={entry.word} />
                <NoteActionForm
                  action={deleteVocabulary}
                  fields={{ id: entry.id }}
                  label="消す"
                  pendingLabel="消しています…"
                  icon={<Trash2 />}
                  confirmMessage={`「${entry.word}」を単語帳から消しますか？復習の記録も消えます。`}
                />
              </div>
              <p className="text-sm text-muted-foreground">{entry.pinyin}</p>
              <p className="text-sm">{entry.meaning}</p>
              {nextReviews[entry.id] ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  次の復習{" "}
                  <span className="text-foreground">
                    {nextReviews[entry.id]}
                  </span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
