import { ArrowLeft, Database } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { reviews } from "@/composition/review-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { reviewChoice } from "@/domain/practice/review-question";
import type { DueReviews } from "@/domain/review/review-item";
import { GoApiError } from "@/infrastructure/go-api/client";
import { answerReviewAction } from "@/presentation/actions/review-actions";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import {
  ReviewSession,
  type ReviewCard,
} from "@/presentation/components/review/review-session";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";
import { formatInterval } from "@/presentation/presenters/review-schedule-presenter";

export const dynamic = "force-dynamic";

// How many due items one visit asks for; the rest wait for the next visit.
const SESSION_SIZE = 20;

// Go being unavailable (or failing) still shows the page with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadDue(): Promise<DueReviews | null> {
  try {
    return await reviews.listDue(SESSION_SIZE);
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("REVIEWS_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

// The questions are shuffled here, so the server and the browser render the
// same choices. Words and learning notes are flashcards. Items whose
// question is gone from the data are skipped. How long each answer puts an
// item off is worked out here too, from the same moment.
function toCards(due: DueReviews, now: Date): ReviewCard[] {
  return due.items.flatMap((item): ReviewCard[] => {
    const nextIn = item.nextDue
      ? ([
          formatInterval(now, item.nextDue[0]),
          formatInterval(now, item.nextDue[1]),
          formatInterval(now, item.nextDue[2]),
          formatInterval(now, item.nextDue[3]),
        ] as const)
      : null;
    if (item.kind === "vocabulary")
      return item.vocabulary
        ? [{ type: "word", itemId: item.id, word: item.vocabulary, nextIn }]
        : [];
    if (item.kind === "entry")
      return item.entry
        ? [{ type: "note", itemId: item.id, entry: item.entry, nextIn }]
        : [];
    const choice = reviewChoice(item.kind, item.targetId);
    if (!choice) return [];
    return [{ type: "choice", itemId: item.id, ...choice, nextIn }];
  });
}

// Members and admins review what their practice got wrong. Guests have no
// queue, so they go home.
export default async function ReviewPage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/review");
  if (!isMemberRole(user.role)) redirect("/");
  const due = await loadDue();

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        title="今日の復習"
        description="忘れかけたころにもう一度出します。答えたら、どのくらい思い出せたかを選んでください。"
        dense
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft /> ホームへ
            </Link>
          </Button>
        }
      />
      {due ? (
        <ReviewSession
          cards={toCards(due, new Date())}
          remaining={due.count - due.items.length}
          answerReview={answerReviewAction}
        />
      ) : (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      )}
    </PageShell>
  );
}
