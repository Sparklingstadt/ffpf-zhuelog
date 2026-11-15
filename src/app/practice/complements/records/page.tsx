import { ArrowRight, Shuffle } from "lucide-react";
import Link from "next/link";

import { complementRecords } from "@/composition/practice-container";
import { roundModeLabel } from "@/domain/practice/complement-record";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { AccuracyTrend } from "@/presentation/components/practice/accuracy-trend";
import { RecordList } from "@/presentation/components/practice/record-list";
import { Button } from "@/presentation/components/ui/button";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";

export const dynamic = "force-dynamic";

export default async function ComplementRecordsPage() {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/complements/records",
  );
  const records = await complementRecords.list();

  return (
    <PageShell user={user} width="5xl">
      <Breadcrumbs
        items={[
          { label: "練習", href: "/practice" },
          { label: "補語、量詞、了・过・着の記録" },
        ]}
      />
      <PageHeader
        title="補語、量詞、了・过・着の練習記録"
        description="終えた練習の正答率・ミス数・経過時間を、新しい順に見返せます。"
        dense
        actions={
          <Button asChild>
            <Link href="/practice">
              練習する <ArrowRight />
            </Link>
          </Button>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon={Shuffle}
          title="まだ練習の記録がありません"
          description="補語、量詞、了・过・着のどれかの練習を最後まで解くと、ここに記録が残ります。"
        />
      ) : (
        <>
          <AccuracyTrend records={records} />
          <RecordList
            records={records}
            hrefOf={(id) => `/practice/complements/records/${id}`}
            labelOf={(record) =>
              `${roundModeLabel(record.mode)} · ${record.questionCount}問`
            }
          />
        </>
      )}
    </PageShell>
  );
}
