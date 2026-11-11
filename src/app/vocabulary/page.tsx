import { Database } from "lucide-react";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { vocabulary } from "@/composition/vocabulary-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import type { VocabularyEntry } from "@/domain/vocabulary/vocabulary-entry";
import { GoApiError } from "@/infrastructure/go-api/client";
import {
  deleteVocabularyAction,
  draftVocabularyAction,
  saveVocabularyAction,
} from "@/presentation/actions/vocabulary-actions";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { VocabularyAddForm } from "@/presentation/components/vocabulary/vocabulary-add-form";
import { VocabularyList } from "@/presentation/components/vocabulary/vocabulary-list";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";
import { formatNextReview } from "@/presentation/presenters/review-schedule-presenter";

export const dynamic = "force-dynamic";

// Go being unavailable (or failing) still shows the page with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadVocabulary(): Promise<VocabularyEntry[] | null> {
  try {
    return await vocabulary.list();
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("VOCABULARY_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

// When each word with a review card comes back, labelled by Tokyo day.
function nextReviewLabels(
  entries: VocabularyEntry[],
  now: Date,
): Record<string, string> {
  return Object.fromEntries(
    entries.flatMap((entry) =>
      entry.nextReview
        ? [[entry.id, formatNextReview(entry.nextReview, now)]]
        : [],
    ),
  );
}

// Members' and admins' own words. Guests have no book, so they go home.
export default async function VocabularyPage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/vocabulary");
  if (!isMemberRole(user.role)) redirect("/");
  const entries = await loadVocabulary();

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="単語帳"
        description="入れた語句は今日の復習に出てきます。学習ノートの詳細からも入れられます。"
        actions={null}
        dense
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">語句を入れる</CardTitle>
        </CardHeader>
        <CardContent>
          <VocabularyAddForm
            layout="row"
            draftVocabulary={draftVocabularyAction}
            saveVocabulary={saveVocabularyAction}
          />
        </CardContent>
      </Card>

      {entries === null ? (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ単語がありません。</p>
      ) : (
        <VocabularyList
          entries={entries}
          nextReviews={nextReviewLabels(entries, new Date())}
          deleteVocabulary={deleteVocabularyAction}
        />
      )}
    </PageShell>
  );
}
