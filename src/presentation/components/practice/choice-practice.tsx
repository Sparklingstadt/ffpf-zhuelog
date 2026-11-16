"use client";

import { ArrowRight, History, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import type { ChoiceQuestion } from "@/domain/practice/choice-question";
import type { HskLevel } from "@/domain/practice/hsk-level";
import type { PracticeQuizKind } from "@/domain/practice/practice-quiz";
import { accuracyPercent } from "@/domain/practice/practice-record";
import type {
  SavePracticeRoundInput,
  SavePracticeRoundResult,
} from "@/presentation/actions/practice-record-actions";
import {
  ChoiceGrid,
  ProgressBar,
  SolvedExample,
  WrongPickNotice,
} from "@/presentation/components/practice/choice-parts";
import { ChoiceAnswerList } from "@/presentation/components/practice/choice-answer-list";
import { RoundStats } from "@/presentation/components/practice/round-stats";
import {
  usePracticeRound,
  type SaveState,
} from "@/presentation/components/practice/use-practice-round";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { focusInPlace, scrollBehavior } from "@/presentation/lib/focus";
import { isOnControl, isTypingOrShortcut } from "@/presentation/lib/keyboard";
import { cn } from "@/presentation/lib/utils";

// Shared four-choice round for prepositions and complements. A wrong pick is crossed out and the
// question stays until the right one is picked. The accuracy, misses and time
// run above the question; when the last one is answered a member's or
// admin's round is saved (`canSave`), and the result shows them again. The
// round itself lives in usePracticeRound; this draws it and handles the
// scrolling and the keys.
export function ChoicePractice({
  initialQuiz,
  canSave,
  quizKind,
  level,
  saveRound,
  recordsHref,
  choiceLabel,
  compactHeading = false,
}: {
  initialQuiz: ChoiceQuestion[];
  canSave: boolean;
  // Which practice and HSK level "もう一度" asks the server for.
  quizKind: PracticeQuizKind;
  level: HskLevel | null;
  saveRound: (
    input: SavePracticeRoundInput,
  ) => Promise<SavePracticeRoundResult>;
  recordsHref: string;
  choiceLabel: string;
  compactHeading?: boolean;
}) {
  const {
    question,
    index,
    total,
    finished,
    done,
    wrong,
    solved,
    answers,
    score,
    elapsedMs,
    save,
    nextRound,
    pick,
    next: nextQuestion,
    retrySave,
    restart: restartRound,
  } = usePracticeRound({ initialQuiz, canSave, quizKind, level, saveRound });
  const progress = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);

  // On a short screen the page header can push the choices out of sight
  // (below the bottom tabs, or the window's edge). Then the round starts
  // scrolled to its progress bar, so the question and all four choices
  // show without scrolling; the header is still above.
  useEffect(() => {
    const choices = choicesRef.current;
    if (!choices) return;
    const reserved = parseFloat(
      getComputedStyle(document.documentElement).scrollPaddingBottom,
    );
    const bottom = window.innerHeight - (Number.isNaN(reserved) ? 0 : reserved);
    if (choices.getBoundingClientRect().bottom > bottom)
      progress.current?.scrollIntoView({ block: "start" });
  }, []);

  // After scrolling down to "next" on a phone, the next question starts out
  // of sight; bring the round back from the progress bar down.
  function showQuestion() {
    progress.current?.scrollIntoView({
      block: "nearest",
      behavior: scrollBehavior(),
    });
  }

  function next() {
    nextQuestion();
    showQuestion();
  }

  async function restart() {
    if (await restartRound()) showQuestion();
  }

  // The keys 1 to 4 pick the choices in the order they show, and Enter goes
  // on once the answer is found. Keys on a button or link are left to it, so
  // Enter on the focused "next" counts once.
  useEffect(() => {
    if (!question) return;
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingOrShortcut(event)) return;
      if (event.key === "Enter") {
        if (!solved || isOnControl(event)) return;
        event.preventDefault();
        next();
        return;
      }
      const position = Number(event.key);
      if (!Number.isInteger(position) || position < 1) return;
      const choice = question!.choices[position - 1];
      if (choice === undefined) return;
      event.preventDefault();
      pick(choice);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="flex flex-col gap-3 roomy:gap-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <ProgressBar
          ref={progress}
          done={done}
          total={total}
          className="min-w-48 flex-1"
        />
        {/* The result shows them again, larger. */}
        {finished ? null : (
          <RoundStats
            accuracy={accuracyPercent(score.firstTryCount, score.questionCount)}
            missCount={score.missCount + (solved ? 0 : wrong.length)}
            elapsedMs={elapsedMs}
          />
        )}
      </div>

      {question ? (
        // Wide screens put the explanation beside the question, so it shows
        // without scrolling; narrower ones put it under the choices.
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-5">
          <Card className="py-4 roomy:py-12">
            <CardContent className="flex flex-col items-center gap-5 roomy:gap-10">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  {question.meaning}
                </p>
                {/* With compactHeading this is the complement mode's name,
                    which the page title already gives on small screens. */}
                <p
                  lang="zh-CN"
                  className={cn(
                    "font-semibold tracking-tight",
                    compactHeading
                      ? "text-xl cramped:hidden roomy:text-2xl"
                      : "text-5xl roomy:text-7xl",
                  )}
                >
                  {question.noun}
                </p>
                <p
                  lang="zh-CN"
                  className="text-lg leading-relaxed text-muted-foreground roomy:text-2xl"
                >
                  {question.prompt}
                </p>
              </div>

              <ChoiceGrid
                ref={choicesRef}
                question={question}
                wrong={wrong}
                solved={solved}
                compact={compactHeading}
                label={choiceLabel}
                onPick={pick}
                shortcuts
              />
              <WrongPickNotice wrong={wrong} solved={solved} />
              {/* Only where a keyboard is likely: wide screens with a mouse. */}
              <p className="hidden text-xs text-muted-foreground lg:pointer-fine:block">
                キーボードの 1〜4 で選べます · Enter で次の問題
              </p>
            </CardContent>
          </Card>

          <div aria-live="polite" className="contents">
            {solved ? (
              <Card className="gap-0 py-0">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="order-1 space-y-1">
                    <p className="text-sm font-medium text-primary">正解！</p>
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span
                        lang="zh-CN"
                        className="text-2xl font-semibold tracking-tight"
                      >
                        {question.answer}
                      </span>
                      <span className="text-muted-foreground">
                        {question.pinyin}
                      </span>
                      <span lang="zh-CN" className="text-sm">
                        {question.phrase}
                      </span>
                    </p>
                  </div>
                  <div className="order-3 space-y-1 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      例文
                    </p>
                    <SolvedExample question={question} />
                  </div>
                  {/* On phones and tablets "next" comes right under the
                      answer, so it shows without scrolling past the example
                      and covers nothing; wide screens end the panel with it. */}
                  <div className="order-2 xl:order-4">
                    <Button
                      size="lg"
                      onClick={next}
                      ref={focusInPlace}
                      className="w-full"
                    >
                      {index + 1 < total ? "次へ" : "結果を見る"} <ArrowRight />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="hidden rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground lg:block">
                選ぶと、ここに正解と例文が出ます。
              </p>
            )}
          </div>
        </div>
      ) : (
        <Card className="py-12">
          <CardContent className="flex flex-col items-center gap-6">
            <p className="text-2xl font-semibold tracking-tight">
              {total}問 終了！
            </p>
            <RoundStats
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
            <ChoiceAnswerList
              answers={answers}
              choiceLabel={choiceLabel}
              onlyMissed
              className="max-w-md"
            />
            <SaveStatus canSave={canSave} save={save} onRetry={retrySave} />
            {nextRound.status === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {nextRound.message}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-3">
              {/* Stays enabled while loading, so focus does not drop; a
                  second press is ignored. */}
              <Button
                size="lg"
                onClick={() => void restart()}
                ref={focusInPlace}
                aria-busy={nextRound.status === "loading"}
              >
                <RotateCcw />
                {nextRound.status === "loading"
                  ? "用意しています…"
                  : "もう一度"}
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
