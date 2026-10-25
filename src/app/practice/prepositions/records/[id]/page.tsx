import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prepositionRecords } from "@/composition/practice-container";
import { accuracyPercent } from "@/domain/practice/preposition-record";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PrepositionAnswerList } from "@/presentation/components/practice/preposition-answer-list";
import { PrepositionStats } from "@/presentation/components/practice/preposition-stats";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PrepositionRecordPageProps = { params: Promise<{ id: string }> };

export default async function PrepositionRecordPage({
  params,
}: PrepositionRecordPageProps) {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/prepositions/records",
  );
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const record = await prepositionRecords.get(id);
  if (!record) notFound();

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={History}
        eyebrow="Preposition record"
        title={`${formatTokyoDateTime(record.createdAt)} の練習`}
        description={`${record.questionCount}問中 ${record.firstTryCount}問を1回目で正解`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/practice/prepositions/records">
              <ArrowLeft /> 記録の一覧へ
            </Link>
          </Button>
        }
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
          <PrepositionAnswerList answers={record.questions} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
