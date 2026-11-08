"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import type { PrepositionQuestion } from "@/domain/practice/preposition-quiz";
import { REVIEW_RATINGS, type ReviewRating } from "@/domain/review/review-item";
import type { VocabularyCard } from "@/domain/vocabulary/vocabulary-entry";
import type {
  AnswerReviewInput,
  AnswerReviewResult,
} from "@/presentation/actions/review-actions";
import {
  Choice,
  focusInPlace,
  SolvedExample,
} from "@/presentation/components/practice/choice-practice";
import { SpeakButton } from "@/presentation/components/speech/speak-button";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

export type ReviewCard =
  | {
      type: "choice";
      itemId: string;
      // "介詞", "補語" (the verb mode) or the complement's kind, shown
      // above the question.
      label: string;
      question: PrepositionQuestion;
      // The hand-written complement modes' prompts are whole sentences and
      // use the smaller heading; prepositions and the verb mode show their
      // noun or verb large.
      compact: boolean;
    }
  | {
      // A word from the vocabulary book: shown, then turned over.
      type: "word";
      itemId: string;
      word: VocabularyCard;
    }
  | {
      // A learning note: the sentence as written (the Japanese for a
      // translation) is shown, the corrected Chinese recalled, then turned
      // over.
      type: "note";
      itemId: string;
      entry: LearningEntry;
    };

// The front and, once turned, the back of a learning note's card.
function NoteCardContent({
  entry,
  turned,
  onTurn,
  ratings,
}: {
  entry: LearningEntry;
  turned: boolean;
  onTurn: () => void;
  ratings: ReactNode;
}) {
  const translation = entry.kind === "translation";
  return (
    <CardContent className="flex flex-col items-center gap-10">
      <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <Badge variant="secondary">学習ノート</Badge>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {translation ? "日本語" : "書いた文"}
          </p>
          <p
            lang={translation ? "ja" : "zh-CN"}
            className="text-xl leading-9 font-medium sm:text-2xl"
          >
            {entry.originalText}
          </p>
        </div>
        {turned ? (
          <div className="w-full space-y-3" aria-live="polite">
            <div className="space-y-1">
              <p className="text-xs font-medium text-primary">
                {translation ? "中国語訳" : "添削後"}
              </p>
              <p
                lang="zh-CN"
                className="text-xl leading-9 font-semibold sm:text-2xl"
              >
                {entry.correctedText}
                <SpeakButton
                  text={entry.correctedText}
                  className="ml-1 align-middle"
                />
              </p>
              <p className="text-sm text-muted-foreground">{entry.pinyin}</p>
            </div>
            {entry.hints.length > 0 ? (
              <ol className="mx-auto max-w-md list-decimal space-y-1 pl-5 text-left text-sm">
                {entry.hints.map((hint) => (
                  <li key={hint.id}>{hint.content}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translation
              ? "中国語でどう言うかを思い出してから、めくってください。"
              : "添削後の文を思い出してから、めくってください。"}
          </p>
        )}
      </div>
      <div className="flex min-h-9 flex-col items-center gap-4 text-center">
        {turned ? (
          ratings
        ) : (
          <Button size="lg" onClick={onTurn} ref={focusInPlace}>
            めくる
          </Button>
        )}
      </div>
    </CardContent>
  );
}

type SendState =
  { status: "idle" | "sending" } | { status: "error"; message: string };

// One pass over the reviews due now. A practice card is the question again:
// pick until the answer is found. A word card shows the word: recall its
// meaning, then turn it over. Either way, then say how well it was recalled
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
    if (!card || card.type !== "choice" || solved || wrong.includes(choice))
      return;
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

  // A wrong pick suggests もう一度, a clean pick or a turned word できた.
  const suggested: ReviewRating = wrong.length > 0 ? 1 : 3;
  const ratings = (
    <>
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
            variant={rating === suggested ? "default" : "outline"}
            ref={rating === suggested ? focusInPlace : undefined}
            disabled={send.status === "sending"}
            onClick={() => void rate(rating)}
          >
            {label}
          </Button>
        ))}
      </div>
      {send.status === "sending" ? (
        <p className="text-sm text-muted-foreground">保存しています…</p>
      ) : send.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {send.message}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-right font-mono text-sm text-muted-foreground">
        {index + 1} / {cards.length}
      </p>
      <Card className="py-10 sm:py-14">
        {card.type === "note" ? (
          <NoteCardContent
            entry={card.entry}
            turned={solved}
            onTurn={() => setSolved(true)}
            ratings={ratings}
          />
        ) : card.type === "word" ? (
          <CardContent className="flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <Badge variant="secondary">単語</Badge>
              <p
                lang="zh-CN"
                className="text-5xl font-semibold tracking-tight sm:text-6xl"
              >
                {card.word.word}
              </p>
              {solved ? (
                <div className="space-y-1" aria-live="polite">
                  <p className="flex items-center justify-center gap-1 font-mono text-lg text-muted-foreground">
                    {card.word.pinyin}
                    <SpeakButton text={card.word.word} />
                  </p>
                  <p className="text-lg">{card.word.meaning}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  意味を思い出してから、めくってください。
                </p>
              )}
            </div>
            <div className="flex min-h-9 flex-col items-center gap-4 text-center">
              {solved ? (
                ratings
              ) : (
                <Button
                  size="lg"
                  onClick={() => setSolved(true)}
                  ref={focusInPlace}
                >
                  めくる
                </Button>
              )}
            </div>
          </CardContent>
        ) : (
          <ChoiceCard
            card={card}
            wrong={wrong}
            solved={solved}
            onPick={pick}
            ratings={ratings}
          />
        )}
      </Card>
    </div>
  );
}

// A practice question: four choices, then its answer and the ratings.
function ChoiceCard({
  card,
  wrong,
  solved,
  onPick,
  ratings,
}: {
  card: Extract<ReviewCard, { type: "choice" }>;
  wrong: string[];
  solved: boolean;
  onPick: (choice: string) => void;
  ratings: ReactNode;
}) {
  const { question } = card;
  return (
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
            onPick={() => onPick(choice)}
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
              <SolvedExample question={question} />
              <p className="text-sm text-muted-foreground">
                {question.translation}
              </p>
            </div>
            {ratings}
          </>
        ) : wrong.length > 0 ? (
          <p className="text-sm text-destructive">
            ちがいます。もう一度選んでください。
          </p>
        ) : null}
      </div>
    </CardContent>
  );
}
