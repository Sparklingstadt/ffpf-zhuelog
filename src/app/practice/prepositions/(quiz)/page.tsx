import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { parseHskLevel } from "@/domain/practice/hsk-level";
import {
  buildQuiz,
  countPrepositionQuestionsByLevel,
} from "@/domain/practice/preposition-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { readHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";
import { HskBasisSwitch } from "@/presentation/components/practice/hsk-basis-switch";
import { HskLevelPicker } from "@/presentation/components/practice/hsk-level-picker";
import { PrepositionPractice } from "@/presentation/components/practice/preposition-practice";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

const QUESTION_COUNT = 25;

// Uses no notes, so guests can practice too; only members' and admins'
// rounds are recorded.
export default async function PrepositionPracticePage({
  searchParams,
}: PageProps<"/practice/prepositions">) {
  const level = parseHskLevel((await searchParams).hsk);
  const user = await getCurrentViewerUser();
  if (!user)
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/practice/prepositions${level ? `?hsk=${level}` : ""}`)}`,
    );
  const canSave = isMemberRole(user.role);
  const basis = await readHskBasis();
  const filter = level ? { level, basis } : null;
  const counts = countPrepositionQuestionsByLevel(basis);
  // Shuffled here so the server and browser render the same quiz.
  const quiz = buildQuiz(QUESTION_COUNT, Math.random, undefined, filter);

  return (
    <PageShell user={user} width="4xl" dense>
      <PageHeader
        dense
        title="介詞の練習"
        description="名詞と日本語の意味に合う介詞を、4つの中から選んでください。HSK の級は、例文と句のいちばん難しい語で決めています。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/practice">
                <ArrowLeft /> 練習へ
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
      <HskLevelPicker
        path="/practice/prepositions"
        current={level}
        counts={counts}
        total={counts[4] + counts[5] + counts[6]}
      />
      <HskBasisSwitch
        current={basis}
        returnTo={`/practice/prepositions${level ? `?hsk=${level}` : ""}`}
      />
      {quiz.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          この級の問題はまだありません。
        </p>
      ) : (
        <PrepositionPractice
          key={`${basis}:${level ?? "all"}`}
          initialQuiz={quiz}
          canSave={canSave}
          filter={filter}
        />
      )}
    </PageShell>
  );
}
