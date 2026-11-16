"use client";

import { useEffect, useState } from "react";

import type { ChoiceQuestion } from "@/domain/practice/choice-question";
import type { HskLevel } from "@/domain/practice/hsk-level";
import type { PracticeQuizKind } from "@/domain/practice/practice-quiz";
import {
  answerOf,
  scoreRound,
  type ChoiceAnswer,
} from "@/domain/practice/practice-record";
import type {
  SavePracticeRoundInput,
  SavePracticeRoundResult,
} from "@/presentation/actions/practice-record-actions";
import {
  nextPracticeQuizAction,
  type NextPracticeQuizResult,
} from "@/presentation/actions/practice-quiz-actions";
import { useChoicePicks } from "@/presentation/components/practice/choice-parts";

export type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

export type NextRoundState =
  { status: "idle" | "loading" } | { status: "error"; message: string };

type FinishedRound = {
  id: string;
  startedAt: Date;
  elapsedMs: number;
  questions: ChoiceAnswer[];
};

// The round as it stands when its last question is answered, under a new id
// that a retried save reuses.
function finishRound(
  startedAt: number,
  questions: ChoiceAnswer[],
): FinishedRound {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(startedAt),
    elapsedMs: Date.now() - startedAt,
    questions,
  };
}

// One four-choice round: the question on screen, the picks, the answers so
// far and the clock. When the last question is answered a member's or
// admin's round is saved (`canSave`); `restart` asks the server for the next
// round.
export function usePracticeRound({
  initialQuiz,
  canSave,
  quizKind,
  level,
  saveRound,
}: {
  initialQuiz: ChoiceQuestion[];
  canSave: boolean;
  quizKind: PracticeQuizKind;
  level: HskLevel | null;
  saveRound: (
    input: SavePracticeRoundInput,
  ) => Promise<SavePracticeRoundResult>;
}) {
  const [quiz, setQuiz] = useState(initialQuiz);
  const [index, setIndex] = useState(0);
  const {
    wrong,
    solved,
    pick: pickChoice,
    reset: resetPicks,
  } = useChoicePicks();
  // The questions answered so far, with their misses.
  const [answers, setAnswers] = useState<ChoiceAnswer[]>([]);
  // Both start at the same moment, so the server and the browser show 0:00.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [round, setRound] = useState<FinishedRound | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [nextRound, setNextRound] = useState<NextRoundState>({
    status: "idle",
  });

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

  function pick(choice: string) {
    if (!question || pickChoice(question, choice) !== "solved") return;
    const answered = [...answers, answerOf(question, wrong)];
    setAnswers(answered);
    if (index + 1 < total) return;
    const finishedRound = finishRound(startedAt, answered);
    setNow(startedAt + finishedRound.elapsedMs);
    setRound(finishedRound);
    if (canSave) void store(finishedRound);
  }

  function next() {
    setIndex((current) => current + 1);
    resetPicks();
  }

  // Saves the finished round again under the same id; undefined until the
  // round is finished.
  const retrySave = round ? () => void store(round) : undefined;

  // Resolves to true once the next round is on screen.
  async function restart() {
    if (nextRound.status === "loading") return false;
    setNextRound({ status: "loading" });
    let result: NextPracticeQuizResult;
    try {
      result = await nextPracticeQuizAction(quizKind, level);
    } catch {
      result = {
        ok: false,
        message:
          "次の問題を用意できませんでした。通信を確かめて、もう一度押してください。",
      };
    }
    if (!result.ok || result.quiz.length === 0) {
      setNextRound({
        status: "error",
        message: result.ok
          ? "この級で出せる問題がありません。"
          : result.message,
      });
      return false;
    }
    setNextRound({ status: "idle" });
    const startAt = Date.now();
    setQuiz(result.quiz);
    setIndex(0);
    resetPicks();
    setAnswers([]);
    setStartedAt(startAt);
    setNow(startAt);
    setRound(null);
    setSave({ status: "idle" });
    return true;
  }

  return {
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
    next,
    retrySave,
    restart,
  };
}
