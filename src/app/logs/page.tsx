import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { showsRecords } from "@/application/identity/use-cases/resolve-record-owner";
import { getTokyoDateParts } from "@/domain/calendar/value-objects/log-date";
import { learningNotes } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { EmptyState } from "@/presentation/components/layout/empty-state";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { NoteCalendar } from "@/presentation/components/records/note-calendar";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { TrashLink } from "@/presentation/components/records/trash-notice";
import { requireNonGuestOwner } from "@/presentation/guards/record-owner-guard";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  formatMonthParam,
  parseMonthParam,
  shiftMonth,
} from "@/presentation/presenters/note-calendar-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type LogsPageProps = {
  searchParams: Promise<{
    user?: string | string[];
    month?: string | string[];
  }>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const query = await searchParams;
  const { user, owner } = await requireNonGuestOwner(
    requestedRecordOwner(query.user),
    "/signin?callbackUrl=/logs",
  );
  if (owner.kind === "redirect-self") redirect("/logs");

  const hasNotes = showsRecords(owner);
  const [dates, view] = hasNotes
    ? await Promise.all([
        learningNotes.listLogDates(owner),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];
  // The month asked for, else the newest note's, else this month.
  const newest = dates[0]?.date ?? getTokyoDateParts(new Date());
  const month = parseMonthParam(query.month) ?? {
    year: newest.year,
    month: newest.month,
  };
  const inMonth = dates.filter(
    (group) =>
      group.date.year === month.year && group.date.month === month.month,
  );

  return (
    <PageShell user={user} width="6xl">
      <PageHeader
        title="日付別の学習ノート"
        description="カレンダーで日を選ぶと、その日の学習ノートを開けます。"
        dense
        actions={
          owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null
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
        <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <NoteCalendar
            month={month}
            counts={dates}
            dayHref={(date) => withRecordOwner(getLogDateHref(date), owner)}
            monthHref={(by) =>
              withRecordOwner(
                `/logs?month=${formatMonthParam(shiftMonth(month, by))}`,
                owner,
              )
            }
          />
          <section
            aria-labelledby="month-days"
            className="overflow-hidden rounded-xl border bg-card"
          >
            <h2 id="month-days" className="px-5 py-4 text-base font-semibold">
              {month.year}年{month.month}月の学習ノート
            </h2>
            {inMonth.length === 0 ? (
              <p className="border-t px-5 py-6 text-sm text-muted-foreground">
                この月の学習ノートはありません。
              </p>
            ) : (
              <ul>
                {inMonth.map((group) => (
                  <li key={formatLogDateKey(group.date)} className="border-t">
                    <Link
                      href={withRecordOwner(getLogDateHref(group.date), owner)}
                      className="group flex items-center gap-3 px-5 py-3.5 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                    >
                      <CalendarDays
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                      <span className="flex-1 font-medium tabular-nums">
                        {formatLogDateKey(group.date)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {group.count}件の学習ノート
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
