import { ArrowLeft, CalendarDays, Languages } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { showsRecords } from "@/application/identity/use-cases/resolve-record-owner";
import { learningReads } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { parseLogDate } from "@/domain/calendar/value-objects/log-date";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import {
  TrashLink,
  TrashNotice,
} from "@/presentation/components/records/trash-notice";
import { Button } from "@/presentation/components/ui/button";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";
import {
  formatLogDate,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type LogDatePageProps = {
  params: Promise<{ year: string; month: string; day: string }>;
  searchParams: Promise<{
    user?: string | string[];
    trashed?: string | string[];
  }>;
};

export default async function LogDatePage({
  params,
  searchParams,
}: LogDatePageProps) {
  const query = await searchParams;
  const { user, owner } = await requireNonGuestOwner(
    requestedRecordOwner(query.user),
    "/signin",
  );

  const { year, month, day } = await params;
  const date = parseLogDate(year, month, day);
  if (!date) notFound();
  const dateHref = getLogDateHref(date);
  if (owner.kind === "redirect-self") redirect(dateHref);

  const hasNotes = showsRecords(owner);
  const [entries, view] = hasNotes
    ? await Promise.all([
        learningReads.listDailyEntries(owner, date),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        icon={Languages}
        eyebrow="Daily learning log"
        title={formatLogDate(date)}
        description={
          hasNotes ? `この日に追加した学習ノート：${entries.length}件` : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={withRecordOwner("/logs", owner)}>
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            {owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null}
          </>
        }
      />

      {view ? (
        <RecordOwnerControls owner={owner} view={view} path={dateHref} />
      ) : null}

      {owner.kind === "self" && query.trashed === "1" ? (
        <TrashNotice href="/logs/trash" />
      ) : null}

      {!hasNotes ? (
        <ReauthNotice subject="学習ノート" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="この日の学習ノートはありません"
        />
      ) : (
        <div className="grid gap-4">
          {entries.map((entry, index) => (
            <LearningEntryCard
              key={entry.id}
              entry={entry}
              numberLabel={`#${index + 1}`}
              href={withRecordOwner(`${dateHref}/${index + 1}`, owner)}
              linkLabel="詳細を開く"
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
