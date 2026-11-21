import { notFound } from "next/navigation";

import { prepositionRecords } from "@/composition/practice-container";
import { accuracyPercent } from "@/domain/practice/practice-record";
import { PRACTICE_RECORD_ID } from "@/domain/practice/practice-round";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { ChoiceAnswerList } from "@/presentation/components/practice/choice-answer-list";
import { RoundStats } from "@/presentation/components/practice/round-stats";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type PrepositionRecordPageProps = { params: Promise<{ id: string }> };

export default async function PrepositionRecordPage({
  params,
}: PrepositionRecordPageProps) {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/prepositions/records",
  );
  const { id } = await params;
  if (!PRACTICE_RECORD_ID.test(id)) notFound();
  const record = await prepositionRecords.get(id);
  if (!record) notFound();

  return (
    <PageShell user={user} width="4xl">
      <Breadcrumbs
        items={[
          { label: "練習", href: "/practice" },
          { label: "介詞の記録", href: "/practice/prepositions/records" },
          { label: formatTokyoDateTime(record.createdAt) },
        ]}
      />
      <PageHeader
        title={`${formatTokyoDateTime(record.createdAt)} の練習`}
        description={`${record.questionCount}問中 ${record.firstTryCount}問を1回目で正解`}
        actions={null}
        dense
      />
      <Card>
        <CardContent className="flex flex-col items-center gap-6">
          <RoundStats
            accuracy={accuracyPercent(
              record.firstTryCount,
              record.questionCount,
            )}
            missCount={record.missCount}
            elapsedMs={record.elapsedMs}
            size="lg"
          />
          <ChoiceAnswerList answers={record.questions} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
