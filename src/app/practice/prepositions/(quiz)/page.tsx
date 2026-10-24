import { ArrowLeft, History, Shuffle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { buildQuiz } from "@/domain/practice/preposition-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PrepositionPractice } from "@/presentation/components/practice/preposition-practice";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

const QUESTION_COUNT = 25;

// Uses no notes, so guests can practice too; only members' and admins'
// rounds are recorded.
export default async function PrepositionPracticePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice/prepositions");
  const canSave = isMemberRole(user.role);

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={Shuffle}
        eyebrow="Preposition practice"
        title="介詞の練習"
        description="名詞と日本語の意味に合う介詞を、4つの中から選んでください。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> ホームへ
              </Link>
            </Button>
            {canSave ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/practice/prepositions/records">
                  <History /> 過去の記録
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {/* Shuffled here so the server and browser render the same quiz. */}
      <PrepositionPractice
        initialQuiz={buildQuiz(QUESTION_COUNT)}
        canSave={canSave}
      />
    </PageShell>
  );
}
