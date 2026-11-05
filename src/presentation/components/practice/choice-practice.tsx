"use client";

import { ArrowRight, Check, History, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  accuracyPercent,
  scoreRound,
  type PrepositionAnswer,
} from "@/domain/practice/preposition-record";
import {
  progressPercent,
  type PrepositionQuestion,
} from "@/domain/practice/preposition-quiz";
import type {
  SavePrepositionRoundInput,
  SavePrepositionRoundResult,
} from "@/presentation/actions/preposition-record-actions";
import { PrepositionAnswerList } from "@/presentation/components/practice/preposition-answer-list";
import { PrepositionStats } from "@/presentation/components/practice/preposition-stats";
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
  compact,
  state,
  disabled,
  onPick,
}: {
  preposition: string;
  compact: boolean;
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
        "relative min-h-20 font-medium disabled:opacity-100",
        compact
          ? "h-auto whitespace-normal px-6 py-4 text-lg leading-relaxed sm:text-xl"
          : "h-20 text-3xl",
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

type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

type FinishedRound = {
  id: string;
  startedAt: Date;
  elapsedMs: number;
  questions: PrepositionAnswer[];
};

// The round as it stands when its last question is answered, under a new id
// that a retried save reuses.
function finishRound(
  startedAt: number,
  questions: PrepositionAnswer[],
): FinishedRound {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(startedAt),
    elapsedMs: Date.now() - startedAt,
    questions,
  };
}

// Shared four-choice round for prepositions and complements. A wrong pick is crossed out and the
// question stays until the right one is picked. The accuracy, misses and time
// run above the question; when the last one is answered a member's or
// admin's round is saved (`canSave`), and the result shows them again.
export function ChoicePractice({
  initialQuiz,
  canSave,
  buildNextQuiz,
  saveRound,
  recordsHref,
  choiceLabel,
  compactHeading = false,
}: {
  initialQuiz: PrepositionQuestion[];
  canSave: boolean;
  buildNextQuiz: () => PrepositionQuestion[];
  saveRound: (
    input: SavePrepositionRoundInput,
  ) => Promise<SavePrepositionRoundResult>;
  recordsHref: string;
  choiceLabel: string;
  compactHeading?: boolean;
}) {
  const [quiz, setQuiz] = useState(initialQuiz);
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  // The questions answered so far, with their misses.
  const [answers, setAnswers] = useState<PrepositionAnswer[]>([]);
  // Both start at the same moment, so the server and the browser show 0:00.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [round, setRound] = useState<FinishedRound | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const total = quiz.length;
  const finished = index >= total;
  const done = Math.min(total, index + (solved ? 1 : 0));
  const question = finished ? null : quiz[index];
  const score = scoreRound(answers);
  const elapsedMs = round ? round.elapsedMs : now - startedAt;

  // The clock ticks until the last question is answered.
  useEffect(() => {
    if (round) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [round]);

  async function store(finishedRound: FinishedRound) {
    setSave({ status: "saving" });
    try {
      const result = await saveRound({
        ...finishedRound,
        startedAt: finishedRound.startedAt.toISOString(),
      });
      setSave(result.ok ? { status: "saved" } : { status: "error", ...result });
    } catch {
      setSave({
        status: "error",
        message: "記録を保存できませんでした。もう一度お試しください。",
      });
    }
  }

  function pick(preposition: string) {
    if (!question || solved || wrong.includes(preposition)) return;
    if (preposition !== question.answer) {
      setWrong((picked) => [...picked, preposition]);
      return;
    }
    setSolved(true);
    const answered = [
      ...answers,
      {
        answer: question.answer,
        noun: question.noun,
        prompt: question.prompt,
        misses: wrong,
      },
    ];
    setAnswers(answered);
    if (index + 1 < total) return;
    const finishedRound = finishRound(startedAt, answered);
    setNow(startedAt + finishedRound.elapsedMs);
    setRound(finishedRound);
    if (canSave) void store(finishedRound);
  }

  function next() {
    setIndex((current) => current + 1);
    setWrong([]);
    setSolved(false);
  }

  function restart() {
    const startAt = Date.now();
    setQuiz(buildNextQuiz());
    setIndex(0);
    setWrong([]);
    setSolved(false);
    setAnswers([]);
    setStartedAt(startAt);
    setNow(startAt);
    setRound(null);
    setSave({ status: "idle" });
  }

  return (
    <div className="flex flex-col gap-6">
      <ProgressBar done={done} total={total} />
      {/* The result shows them again, larger. */}
      {finished ? null : (
        <PrepositionStats
          accuracy={accuracyPercent(score.firstTryCount, score.questionCount)}
          missCount={score.missCount + (solved ? 0 : wrong.length)}
          elapsedMs={elapsedMs}
        />
      )}

      {question ? (
        <Card className="py-10 sm:py-14">
          <CardContent className="flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">
                {question.meaning}
              </p>
              <p
                lang="zh-CN"
                className={cn(
                  "font-semibold tracking-tight",
                  compactHeading
                    ? "text-xl sm:text-2xl"
                    : "text-6xl sm:text-7xl",
                )}
              >
                {question.noun}
              </p>
              <p
                lang="zh-CN"
                className="text-lg leading-relaxed text-muted-foreground sm:text-2xl"
              >
                {question.prompt}
              </p>
            </div>

            <div
              role="group"
              aria-label={choiceLabel}
              lang="zh-CN"
              className="grid w-full max-w-md grid-cols-2 gap-3"
            >
              {question.choices.map((preposition) => (
                <Choice
                  key={preposition}
                  preposition={preposition}
                  compact={compactHeading}
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

            <div
              className="flex min-h-9 flex-col items-center gap-4 text-center"
              aria-live="polite"
            >
              {solved ? (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      正解！{" "}
                      <span lang="zh-CN" className="text-base">
                        {question.phrase}
                      </span>{" "}
                      <span className="font-mono text-muted-foreground">
                        {question.answer} {question.pinyin}
                      </span>
                    </p>
                    <p lang="zh-CN" className="text-sm">
                      {question.example}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {question.translation}
                    </p>
                  </div>
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
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-6">
            <p className="text-2xl font-semibold tracking-tight">
              {total}問 終了！
            </p>
            <PrepositionStats
              accuracy={accuracyPercent(
                score.firstTryCount,
                score.questionCount,
              )}
              missCount={score.missCount}
              elapsedMs={elapsedMs}
              size="lg"
            />
            <p className="text-sm text-muted-foreground">
              1回目で正解した問題:{" "}
              <strong className="font-mono text-base text-foreground">
                {score.firstTryCount}
              </strong>{" "}
              / {total}
            </p>
            <PrepositionAnswerList
              answers={answers}
              choiceLabel={choiceLabel}
              onlyMissed
              className="max-w-md"
            />
            <SaveStatus
              canSave={canSave}
              save={save}
              onRetry={round ? () => void store(round) : undefined}
            />
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={restart} ref={focusInPlace}>
                <RotateCcw /> もう一度
              </Button>
              {canSave ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={recordsHref}>
                    <History /> 過去の記録
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SaveStatus({
  canSave,
  save,
  onRetry,
}: {
  canSave: boolean;
  save: SaveState;
  onRetry?: () => void;
}) {
  if (!canSave)
    return (
      <p className="text-sm text-muted-foreground">
        ゲストの練習は記録に残りません。
      </p>
    );
  return (
    <div aria-live="polite" className="flex flex-col items-center gap-2">
      {save.status === "saving" ? (
        <p className="text-sm text-muted-foreground">記録を保存しています…</p>
      ) : save.status === "saved" ? (
        <p className="text-sm text-muted-foreground">記録に保存しました。</p>
      ) : save.status === "error" ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {save.message}
          </p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              保存し直す
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
