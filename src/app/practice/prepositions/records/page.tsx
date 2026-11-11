import { ArrowRight, Shuffle } from "lucide-react";
import Link from "next/link";

import { prepositionRecords } from "@/composition/practice-container";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { AccuracyTrend } from "@/presentation/components/practice/accuracy-trend";
import { RecordList } from "@/presentation/components/practice/record-list";
import { Button } from "@/presentation/components/ui/button";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";

export const dynamic = "force-dynamic";

export default async function PrepositionRecordsPage() {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/prepositions/records",
  );
  const records = await prepositionRecords.list();

  return (
    <PageShell user={user} width="5xl">
      <Breadcrumbs
        items={[{ label: "練習", href: "/practice" }, { label: "介詞の記録" }]}
      />
      <PageHeader
        title="介詞の練習記録"
        description="終えた練習の正答率・ミス数・経過時間を、新しい順に見返せます。"
        dense
        actions={
          <Button asChild>
            <Link href="/practice/prepositions">
              練習する <ArrowRight />
            </Link>
          </Button>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon={Shuffle}
          title="まだ練習の記録がありません"
          description="介詞の練習を最後まで解くと、ここに記録が残ります。"
        />
      ) : (
        <>
          <AccuracyTrend records={records} />
          <RecordList
            records={records}
            hrefOf={(id) => `/practice/prepositions/records/${id}`}
            labelOf={(record) => `${record.questionCount}問`}
          />
        </>
      )}
    </PageShell>
  );
}
