import { roundModeLabel } from "@/domain/practice/complement-record";
import { notFound } from "next/navigation";

import { complementRecords } from "@/composition/practice-container";
import { accuracyPercent } from "@/domain/practice/preposition-record";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PrepositionAnswerList } from "@/presentation/components/practice/preposition-answer-list";
import { PrepositionStats } from "@/presentation/components/practice/preposition-stats";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ComplementRecordPageProps = { params: Promise<{ id: string }> };

export default async function ComplementRecordPage({
  params,
}: ComplementRecordPageProps) {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/complements/records",
  );
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const record = await complementRecords.get(id);
  if (!record) notFound();

  return (
    <PageShell user={user} width="4xl">
      <Breadcrumbs
        items={[
          { label: "練習", href: "/practice" },
          {
            label: "補語、量詞、了・过・着の記録",
            href: "/practice/complements/records",
          },
          { label: formatTokyoDateTime(record.createdAt) },
        ]}
      />
      <PageHeader
        title={`${formatTokyoDateTime(record.createdAt)} の練習`}
        description={`${roundModeLabel(record.mode)} · ${record.questionCount}問中 ${record.firstTryCount}問を1回目で正解`}
        actions={null}
        dense
      />
      <Card>
        <CardContent className="flex flex-col items-center gap-6">
          <PrepositionStats
            accuracy={accuracyPercent(
              record.firstTryCount,
              record.questionCount,
            )}
            missCount={record.missCount}
            elapsedMs={record.elapsedMs}
            size="lg"
          />
          <PrepositionAnswerList
            answers={record.questions}
            choiceLabel="補語を選ぶ"
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
