"use client";

import { ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import {
  buildQuiz,
  progressPercent,
  type Preposition,
  type PrepositionQuestion,
} from "@/domain/practice/preposition-quiz";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { cn } from "@/presentation/lib/utils";

// Moves focus to the button that just appeared. Unlike autoFocus it keeps
// the scroll position, so the progress bar stays in view.
function focusInPlace(button: HTMLButtonElement | null) {
  button?.focus({ preventScroll: true });
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
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

function Choice({
  preposition,
  state,
  disabled,
  onPick,
}: {
  preposition: Preposition;
  state: "idle" | "correct" | "wrong";
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={
        state === "correct"
          ? `${preposition}（正解）`
          : state === "wrong"
            ? `${preposition}（不正解）`
            : preposition
      }
      onClick={onPick}
      className={cn(
        "relative h-20 text-3xl font-medium disabled:opacity-100",
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

// One quiz round: a noun with four prepositions, one of which fits. A wrong
// pick is crossed out and the question stays until the right one is picked.
export function PrepositionPractice({
  initialQuiz,
}: {
  initialQuiz: PrepositionQuestion[];
}) {
  const [quiz, setQuiz] = useState(initialQuiz);
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState<Preposition[]>([]);
  const [solved, setSolved] = useState(false);
  // Questions answered without a wrong pick.
  const [firstTry, setFirstTry] = useState(0);

  const total = quiz.length;
  const finished = index >= total;
  const done = Math.min(total, index + (solved ? 1 : 0));
  const question = finished ? null : quiz[index];

  function pick(preposition: Preposition) {
    if (!question || solved) return;
    if (preposition === question.answer) {
      setSolved(true);
      if (wrong.length === 0) setFirstTry((count) => count + 1);
    } else {
      setWrong((picked) => [...picked, preposition]);
    }
  }

  function next() {
    setIndex((current) => current + 1);
    setWrong([]);
    setSolved(false);
  }

  function restart() {
    setQuiz(buildQuiz(total));
    setIndex(0);
    setWrong([]);
    setSolved(false);
    setFirstTry(0);
  }

  return (
    <div className="flex flex-col gap-8">
      <ProgressBar done={done} total={total} />

      {question ? (
        <Card className="py-10 sm:py-14">
          <CardContent className="flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                {question.meaning}
              </p>
              <p
                lang="zh-CN"
                className="text-6xl font-semibold tracking-tight sm:text-7xl"
              >
                {question.noun}
              </p>
              <p className="font-mono text-sm text-muted-foreground">
                {question.pinyin}
              </p>
            </div>

            <div
              role="group"
              aria-label="介詞を選ぶ"
              lang="zh-CN"
              className="grid w-full max-w-md grid-cols-2 gap-3"
            >
              {question.choices.map((preposition) => (
                <Choice
                  key={preposition}
                  preposition={preposition}
                  state={
                    solved && preposition === question.answer
                      ? "correct"
                      : wrong.includes(preposition)
                        ? "wrong"
                        : "idle"
                  }
                  disabled={solved || wrong.includes(preposition)}
                  onPick={() => pick(preposition)}
                />
              ))}
            </div>

            <div className="flex min-h-9 items-center gap-3" aria-live="polite">
              {solved ? (
                <>
                  <p className="text-sm font-medium">
                    正解！{" "}
                    <span lang="zh-CN" className="text-base">
                      {question.answer}
                      {question.noun}
                    </span>
                  </p>
                  <Button size="lg" onClick={next} ref={focusInPlace}>
                    {index + 1 < total ? "次へ" : "結果を見る"} <ArrowRight />
                  </Button>
                </>
              ) : wrong.length > 0 ? (
                <p className="text-sm text-destructive">
                  ちがいます。もう一度選んでください。
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-14 text-center">
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-2xl font-semibold tracking-tight">
              {total}問 終了！
            </p>
            <p className="text-sm text-muted-foreground">
              1回目で正解した問題:{" "}
              <strong className="font-mono text-base text-foreground">
                {firstTry}
              </strong>{" "}
              / {total}
            </p>
            <Button size="lg" onClick={restart} ref={focusInPlace}>
              <RotateCcw /> もう一度
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
