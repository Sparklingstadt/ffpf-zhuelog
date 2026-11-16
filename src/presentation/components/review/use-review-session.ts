"use client";

import { useState } from "react";

import type { ReviewRating } from "@/domain/review/review-item";
import type {
  AnswerReviewInput,
  AnswerReviewResult,
} from "@/presentation/actions/review-actions";
import { useChoicePicks } from "@/presentation/components/practice/choice-parts";
import type { ReviewCard } from "@/presentation/components/review/review-session";

export type SendState =
  { status: "idle" | "sending" } | { status: "error"; message: string };

// One pass over the reviews due now: the card on screen, its picks (or
// whether it is turned over) and sending its rating. The rating is sent
// under a log id made for the card, so a retried send counts once.
//
// The cards are held for the whole pass. A server action that revalidates
// (saving a word from a card does) re-renders the page with the due list
// as it is now, without the cards already answered; taking it mid-pass
// would slide the next card under the open one, shown as solved. A new list
// is taken only once the pass is over, as 続けて復習する brings.
export function useReviewSession({
  cards: loadedCards,
  remaining: loadedRemaining,
  answerReview,
}: {
  cards: ReviewCard[];
  remaining: number;
  answerReview: (input: AnswerReviewInput) => Promise<AnswerReviewResult>;
}) {
  const [session, setSession] = useState({
    cards: loadedCards,
    remaining: loadedRemaining,
  });
  const [lastLoaded, setLastLoaded] = useState(loadedCards);
  const [index, setIndex] = useState(0);
  const {
    wrong,
    solved,
    pick: pickChoice,
    reset: resetPicks,
    reveal,
  } = useChoicePicks();
  const [logId, setLogId] = useState(() => crypto.randomUUID());
  const [send, setSend] = useState<SendState>({ status: "idle" });

  if (lastLoaded !== loadedCards) {
    setLastLoaded(loadedCards);
    if (index >= session.cards.length) {
      setSession({ cards: loadedCards, remaining: loadedRemaining });
      setIndex(0);
      resetPicks();
    }
  }
  const { cards, remaining } = session;

  const card = index < cards.length ? cards[index] : null;

  function pick(choice: string) {
    if (card?.type === "choice") pickChoice(card.question, choice);
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
    resetPicks();
    setLogId(crypto.randomUUID());
    setSend({ status: "idle" });
  }

  // A wrong pick suggests もう一度, a clean pick or a turned word できた.
  const suggested: ReviewRating = wrong.length > 0 ? 1 : 3;
  // The ratings show and take an answer.
  const ratingOpen = card !== null && solved && send.status !== "sending";

  return {
    cards,
    remaining,
    index,
    card,
    wrong,
    solved,
    send,
    suggested,
    ratingOpen,
    pick,
    reveal,
    rate,
  };
}
