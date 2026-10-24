import { ArrowLeft, ChevronRight, History, Shuffle } from "lucide-react";
import Link from "next/link";

import { prepositionRecords } from "@/composition/practice-container";
import {
  accuracyPercent,
  formatElapsed,
} from "@/domain/practice/preposition-record";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requirePracticeRecordUser } from "@/presentation/guards/practice-guard";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

export default async function PrepositionRecordsPage() {
  const user = await requirePracticeRecordUser(
    "/signin?callbackUrl=/practice/prepositions/records",
  );
  const records = await prepositionRecords.list();

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={History}
        eyebrow="Preposition records"
        title="介詞の練習記録"
        description="終えた練習の正答率・ミス数・経過時間を、新しい順に見返せます。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/practice/prepositions">
                <ArrowLeft /> 練習へ
              </Link>
            </Button>
          </>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon={Shuffle}
          title="まだ練習の記録がありません"
          description="介詞の練習を最後まで解くと、ここに記録が残ります。"
        />
      ) : (
        <div className="grid gap-3">
          {records.map((record) => (
            <Link
              key={record.id}
              href={`/practice/prepositions/records/${record.id}`}
              className="group"
            >
              <Card className="transition-colors group-hover:bg-muted/40">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {formatTokyoDateTime(record.createdAt)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {record.questionCount}問
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <dl className="flex gap-4 text-right font-mono text-sm tabular-nums sm:gap-6">
                      <div>
                        <dt className="font-sans text-xs text-muted-foreground">
                          正答率
                        </dt>
                        <dd className="font-semibold">
                          {accuracyPercent(
                            record.firstTryCount,
                            record.questionCount,
                          ) ?? 0}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt className="font-sans text-xs text-muted-foreground">
                          ミス
                        </dt>
                        <dd className="font-semibold">{record.missCount}回</dd>
                      </div>
                      <div>
                        <dt className="font-sans text-xs text-muted-foreground">
                          時間
                        </dt>
                        <dd className="font-semibold">
                          {formatElapsed(record.elapsedMs)}
                        </dd>
                      </div>
                    </dl>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
