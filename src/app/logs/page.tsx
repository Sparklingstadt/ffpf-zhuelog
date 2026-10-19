import { ArrowLeft, CalendarDays, ChevronRight, Languages } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { showsRecords } from "@/application/identity/use-cases/resolve-record-owner";
import { learningUseCases } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { TrashLink } from "@/presentation/components/records/trash-notice";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type LogsPageProps = {
  searchParams: Promise<{ user?: string | string[] }>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const { user, owner } = await requireNonGuestOwner(
    requestedRecordOwner((await searchParams).user),
    "/signin?callbackUrl=/logs",
  );
  if (owner.kind === "redirect-self") redirect("/logs");

  const hasNotes = showsRecords(owner);
  const [dates, view] = hasNotes
    ? await Promise.all([
        learningUseCases.listLogDates.execute(owner.ownerId),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];

  return (
    <PageShell width="4xl">
      <PageHeader
        icon={Languages}
        eyebrow="Chinese learning log"
        title="日付別の学習ノート"
        description="学習文を登録した日から一覧を開けます。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={withRecordOwner("/", owner)}>
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            {owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null}
            <AuthControls user={user} />
          </>
        }
      />

      {view ? (
        <RecordOwnerControls owner={owner} view={view} path="/logs" />
      ) : null}

      {!hasNotes ? (
        <ReauthNotice subject="学習ノート" />
      ) : dates.length === 0 ? (
        <EmptyState icon={CalendarDays} title="まだ学習ノートがありません" />
      ) : (
        <div className="grid gap-3">
          {dates.map((group) => (
            <Link
              key={formatLogDateKey(group.date)}
              href={withRecordOwner(getLogDateHref(group.date), owner)}
              className="group"
            >
              <Card className="transition-colors group-hover:bg-muted/40">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {formatLogDateKey(group.date)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {group.count}件の学習ノート
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
