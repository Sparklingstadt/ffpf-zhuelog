import { History, Ruler } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  buildMeasureWordQuiz,
  countMeasureWordQuestions,
  MEASURE_WORD_PRACTICE,
} from "@/domain/practice/measure-word-quiz";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { MeasureWordPractice } from "@/presentation/components/practice/measure-word-practice";
import { Button } from "@/presentation/components/ui/button";

export const dynamic = "force-dynamic";

export default async function MeasureWordPracticePage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/practice/measure-words");
  const canSave = isMemberRole(user.role);
  return (
    <PageShell user={user} width="4xl" dense>
      <PageHeader
        dense
        icon={Ruler}
        eyebrow="Measure word practice"
        title="量詞の練習"
        description={`${MEASURE_WORD_PRACTICE.description} 全${countMeasureWordQuestions()}問から毎回25問を、4つの中から選んでください。`}
        actions={
          canSave ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/practice/complements/records">
                <History />
                過去の記録
              </Link>
            </Button>
          ) : undefined
        }
      />
      <MeasureWordPractice
        initialQuiz={buildMeasureWordQuiz()}
        canSave={canSave}
      />
    </PageShell>
  );
}
