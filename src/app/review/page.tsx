import { ArrowLeft, Database, Repeat } from "lucide-react";
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
// question is gone from the data are skipped.
function toCards(due: DueReviews): ReviewCard[] {
  return due.items.flatMap((item): ReviewCard[] => {
    if (item.kind === "vocabulary")
      return item.vocabulary
        ? [{ type: "word", itemId: item.id, word: item.vocabulary }]
        : [];
    if (item.kind === "entry")
      return item.entry
        ? [{ type: "note", itemId: item.id, entry: item.entry }]
        : [];
    const choice = reviewChoice(item.kind, item.targetId);
    if (!choice) return [];
    return [{ type: "choice", itemId: item.id, ...choice }];
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
        icon={Repeat}
        eyebrow="Review"
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
          cards={toCards(due)}
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
