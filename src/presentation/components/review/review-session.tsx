"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { REVIEW_RATINGS, type ReviewRating } from "@/domain/review/review-item";
import type {
  AnswerReviewInput,
  AnswerReviewResult,
} from "@/presentation/actions/review-actions";
import {
  Choice,
  focusInPlace,
} from "@/presentation/components/practice/choice-practice";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

export type ReviewCard = {
  itemId: string;
  // "介詞" or the complement's kind, shown above the question.
  label: string;
  question: PrepositionQuestion;
  // Complement prompts are whole sentences and use the smaller heading.
  compact: boolean;
};

type SendState =
  { status: "idle" | "sending" } | { status: "error"; message: string };

// One pass over the reviews due now. Each card is the practice question
// again: pick until the answer is found, then say how well it was recalled
// (もう一度・難しい・できた・簡単). The rating goes to Go under a log id made
// for the card, so a retried send counts once.
export function ReviewSession({
  cards,
  remaining,
  answerReview,
}: {
  cards: ReviewCard[];
  // Items due now beyond those the page loaded.
  remaining: number;
  answerReview: (input: AnswerReviewInput) => Promise<AnswerReviewResult>;
}) {
  const [index, setIndex] = useState(0);
  const [wrong, setWrong] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [logId, setLogId] = useState(() => crypto.randomUUID());
  const [send, setSend] = useState<SendState>({ status: "idle" });

  const card = index < cards.length ? cards[index] : null;

  function pick(choice: string) {
    if (!card || solved || wrong.includes(choice)) return;
    if (choice !== card.question.answer) {
      setWrong((picked) => [...picked, choice]);
      return;
    }
    setSolved(true);
  }

  async function rate(rating: ReviewRating) {
    if (!card || send.status === "sending") return;
    setSend({ status: "sending" });
    let result: AnswerReviewResult;
    try {
      result = await answerReview({ itemId: card.itemId, logId, rating });
    } catch {
      result = {
        ok: false,
        message: "回答を保存できませんでした。もう一度お試しください。",
      };
    }
    if (!result.ok) {
      setSend({ status: "error", message: result.message });
      return;
    }
    setIndex((i) => i + 1);
    setWrong([]);
    setSolved(false);
    setLogId(crypto.randomUUID());
    setSend({ status: "idle" });
  }

  if (!card) {
    const left = Math.max(0, remaining);
    return (
      <Card className="py-12">
        <CardContent className="flex flex-col items-center gap-6 text-center">
          <p className="text-2xl font-semibold tracking-tight">
            {cards.length > 0
              ? `${cards.length}問 復習しました`
              : "今日の復習はありません"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {left > 0
              ? `期日が来ている問題が、まだ${left}問あります。`
              : cards.length > 0
                ? "「もう一度」や「難しい」にした問題は、少したつとまた出てきます。"
                : "練習で間違えた問題が、ここに出てきます。"}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {left > 0 || cards.length > 0 ? (
              <Button asChild size="lg">
                <Link href="/review">
                  <RotateCcw /> 続けて復習する
                </Link>
              </Button>
            ) : null}
            <Button asChild size="lg" variant="outline">
              <Link href="/">
                <Home /> ホームへ
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { question } = card;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-right font-mono text-sm text-muted-foreground">
        {index + 1} / {cards.length}
      </p>
      <Card className="py-10 sm:py-14">
        <CardContent className="flex flex-col items-center gap-10">
          <div className="flex flex-col items-center gap-2 text-center">
            <Badge variant="secondary">{card.label}</Badge>
            <p className="text-sm text-muted-foreground">{question.meaning}</p>
            <p
              lang="zh-CN"
              className={
                card.compact
                  ? "text-xl font-semibold tracking-tight sm:text-2xl"
                  : "text-6xl font-semibold tracking-tight sm:text-7xl"
              }
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
            aria-label="選択肢"
            lang="zh-CN"
            className="grid w-full max-w-md grid-cols-2 gap-3"
          >
            {question.choices.map((choice) => (
              <Choice
                key={choice}
                preposition={choice}
                compact={card.compact}
                state={
                  solved && choice === question.answer
                    ? "correct"
                    : wrong.includes(choice)
                      ? "wrong"
                      : "idle"
                }
                disabled={solved || wrong.includes(choice)}
                onPick={() => pick(choice)}
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
                  <p className="text-sm text-muted-foreground">
                    {question.translation}
                  </p>
                </div>
                <p className="text-sm">どのくらい思い出せましたか？</p>
                <div
                  role="group"
                  aria-label="思い出せた度合い"
                  className="grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-4"
                >
                  {REVIEW_RATINGS.map(({ rating, label }) => (
                    <Button
                      key={rating}
                      type="button"
                      // A wrong pick suggests もう一度, a clean one できた.
                      variant={
                        rating === (wrong.length > 0 ? 1 : 3)
                          ? "default"
                          : "outline"
                      }
                      ref={
                        rating === (wrong.length > 0 ? 1 : 3)
                          ? focusInPlace
                          : undefined
                      }
                      disabled={send.status === "sending"}
                      onClick={() => void rate(rating)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {send.status === "sending" ? (
                  <p className="text-sm text-muted-foreground">
                    保存しています…
                  </p>
                ) : send.status === "error" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {send.message}
                  </p>
                ) : null}
              </>
            ) : wrong.length > 0 ? (
              <p className="text-sm text-destructive">
                ちがいます。もう一度選んでください。
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
