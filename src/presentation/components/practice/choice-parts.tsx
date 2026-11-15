"use client";

import { BookPlus, Check, X } from "lucide-react";
import { useState, useSyncExternalStore, type Ref } from "react";

import {
  progressPercent,
  type ChoiceQuestion,
} from "@/domain/practice/choice-question";
import {
  getExamplePinyinSnapshot,
  getServerExamplePinyinSnapshot,
  setExamplePinyinPreference,
  subscribeToExamplePinyin,
} from "@/infrastructure/preferences/example-pinyin-store";
import {
  draftVocabularyAction,
  saveVocabularyAction,
} from "@/presentation/actions/vocabulary-actions";
import { SpeakButton } from "@/presentation/components/speech/speak-button";
import { Button } from "@/presentation/components/ui/button";
import { VocabularyAddForm } from "@/presentation/components/vocabulary/vocabulary-add-form";
import { cn } from "@/presentation/lib/utils";

// The pieces of a four-choice question that the practice and today's review
// share. Nothing here may import question data (see choice-question.ts).

// The example sentence of a solved question, with the pinyin of the whole
// sentence above it when there is one. With the "hide" setting on, the
// pinyin waits behind a button so the learner reads the sentence first.
export function SolvedExample({
  question,
  canAddToVocabulary = false,
}: {
  question: Pick<ChoiceQuestion, "example" | "examplePinyin" | "translation">;
  // Members and admins may pick words of the sentence into their vocabulary
  // book in today's review. The practice leaves it out, to keep the
  // question and "next" in view.
  canAddToVocabulary?: boolean;
}) {
  const preference = useSyncExternalStore(
    subscribeToExamplePinyin,
    getExamplePinyinSnapshot,
    getServerExamplePinyinSnapshot,
  );
  const [revealed, setRevealed] = useState(false);
  const hidden = preference === "hidden";

  return (
    <>
      {question.examplePinyin ? (
        hidden && !revealed ? (
          <p>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              ピンインを見る
            </button>
          </p>
        ) : (
          <p lang="zh-Latn-pinyin" className="text-xs text-muted-foreground">
            {question.examplePinyin}
          </p>
        )
      ) : null}
      <p lang="zh-CN" className="text-sm">
        {question.example}
        <SpeakButton text={question.example} className="ml-1 align-middle" />
      </p>
      <p className="text-sm text-muted-foreground">{question.translation}</p>
      {question.examplePinyin ? (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) =>
              setExamplePinyinPreference(
                event.target.checked ? "hidden" : "shown",
              )
            }
            className="size-3.5 accent-primary"
          />
          例文のピンインを最初は隠す
        </label>
      ) : null}
      {canAddToVocabulary ? (
        <details className="group mx-auto w-full max-w-xl rounded-lg border text-left">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <BookPlus className="size-4" aria-hidden="true" />
            例文の語句を単語帳に入れる
          </summary>
          <div className="border-t p-3">
            <VocabularyAddForm
              sentence={question.example}
              draftVocabulary={draftVocabularyAction}
              saveVocabulary={saveVocabularyAction}
            />
          </div>
        </details>
      ) : null}
    </>
  );
}

export function ProgressBar({
  done,
  total,
  ref,
  className,
}: {
  done: number;
  total: number;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div ref={ref} className={cn("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label="進捗"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${progressPercent(done, total)}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-sm text-muted-foreground">
        {done} / {total}
      </span>
    </div>
  );
}

export function Choice({
  preposition,
  compact,
  state,
  disabled,
  onPick,
  shortcut,
}: {
  preposition: string;
  compact: boolean;
  state: "idle" | "correct" | "wrong";
  disabled: boolean;
  onPick: () => void;
  // The number key that picks it, when the page listens for one.
  shortcut?: number;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-keyshortcuts={shortcut ? String(shortcut) : undefined}
      aria-label={
        state === "correct"
          ? `${preposition}（正解）`
          : state === "wrong"
            ? `${preposition}（不正解）`
            : preposition
      }
      onClick={onPick}
      className={cn(
        "relative min-h-14 font-medium disabled:opacity-100 roomy:min-h-20",
        compact
          ? "h-auto whitespace-normal px-6 py-3 text-lg leading-relaxed roomy:py-4 roomy:text-xl"
          : "h-14 text-2xl roomy:h-20 roomy:text-3xl",
        state === "correct" &&
          "border-primary bg-primary text-primary-foreground dark:border-primary dark:bg-primary",
        state === "wrong" &&
          "border-destructive/50 bg-destructive/10 text-destructive line-through dark:border-destructive/50 dark:bg-destructive/20",
      )}
    >
      {preposition}
      {state === "correct" ? (
        <Check className="absolute top-2 right-2 size-5" />
      ) : state === "wrong" ? (
        <X className="absolute top-2 right-2 size-5" />
      ) : null}
    </Button>
  );
}
