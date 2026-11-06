import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { practiceRecords } from "@/composition/practice-container";
import { accuracyPercent } from "@/domain/practice/practice-record";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { PracticeAnswerList } from "@/presentation/components/practice/practice-answer-list";
import { PracticeStats } from "@/presentation/components/practice/practice-stats";
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
  const record = await practiceRecords("preposition").get(id);
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
          <PracticeStats
            accuracy={accuracyPercent(
              record.firstTryCount,
              record.questionCount,
            )}
            missCount={record.missCount}
            elapsedMs={record.elapsedMs}
            size="lg"
          />
          <PracticeAnswerList answers={record.questions} wordLabel="介詞" />
        </CardContent>
      </Card>
    </PageShell>
  );
}
