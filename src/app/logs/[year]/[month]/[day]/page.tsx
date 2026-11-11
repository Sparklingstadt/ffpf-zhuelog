import { CalendarDays } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { showsRecords } from "@/application/identity/use-cases/resolve-record-owner";
import { learningNotes } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { parseLogDate } from "@/domain/calendar/value-objects/log-date";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { NoteCalendar } from "@/presentation/components/records/note-calendar";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import {
  TrashLink,
  TrashNotice,
} from "@/presentation/components/records/trash-notice";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";
import {
  formatLogDate,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  formatMonthParam,
  shiftMonth,
} from "@/presentation/presenters/note-calendar-presenter";
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
  const [entries, view, dates] = hasNotes
    ? await Promise.all([
        learningNotes.listDailyEntries(owner, date),
        loadRecordOwnerView(user, owner),
        learningNotes.listLogDates(owner),
      ])
    : [[], null, []];
  const shownMonth = { year: date.year, month: date.month };

  return (
    <PageShell user={user} width="6xl">
      <Breadcrumbs
        items={[
          {
            label: "日付別の学習ノート",
            href: withRecordOwner("/logs", owner),
          },
          { label: formatLogDate(date) },
        ]}
      />
      <PageHeader
        title={formatLogDate(date)}
        description={
          hasNotes ? `この日に追加した学習ノート：${entries.length}件` : null
        }
        dense
        actions={
          owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null
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
        <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="max-lg:hidden">
            <NoteCalendar
              month={shownMonth}
              counts={dates}
              selected={date}
              dayHref={(d) => withRecordOwner(getLogDateHref(d), owner)}
              monthHref={(by) =>
                withRecordOwner(
                  `/logs?month=${formatMonthParam(shiftMonth(shownMonth, by))}`,
                  owner,
                )
              }
            />
          </div>
          <div className="grid min-w-0 gap-4">
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
        </div>
      )}
    </PageShell>
  );
}
