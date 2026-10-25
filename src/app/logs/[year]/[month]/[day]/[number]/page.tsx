import {
  ArrowLeft,
  CalendarDays,
  Languages,
  Share2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { learningNotes } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import {
  parseLogDate,
  parseLogNumber,
} from "@/domain/calendar/value-objects/log-date";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { shareLearningEntryAction } from "@/presentation/actions/follow-actions";
import { trashLearningEntryAction } from "@/presentation/actions/note-trash-actions";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Badge } from "@/presentation/components/ui/badge";
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

type LogDetailPageProps = {
  params: Promise<{ year: string; month: string; day: string; number: string }>;
  searchParams: Promise<{ user?: string | string[] }>;
};

export default async function LogDetailPage({
  params,
  searchParams,
}: LogDetailPageProps) {
  const { user, owner } = await requireNonGuestOwner(
    requestedRecordOwner((await searchParams).user),
    "/signin",
  );

  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const entryNumber = parseLogNumber(number);
  if (!date || !entryNumber) notFound();
  const dateHref = getLogDateHref(date);
  if (owner.kind === "redirect-self") redirect(`${dateHref}/${entryNumber}`);

  const header = {
    icon: Languages,
    eyebrow: "Daily learning log",
    title: `${formatLogDate(date)} · #${entryNumber}`,
    actions: (
      <Button asChild variant="outline" size="sm">
        <Link href={withRecordOwner(dateHref, owner)}>
          <ArrowLeft /> この日の一覧へ
        </Link>
      </Button>
    ),
  };

  if (owner.kind === "denied") {
    return (
      <PageShell user={user} width="5xl">
        <PageHeader {...header} />
        <ReauthNotice subject="学習ノート" />
      </PageShell>
    );
  }

  const [result, view] = await Promise.all([
    learningNotes.getDailyEntry(owner, date, entryNumber),
    loadRecordOwnerView(user, owner),
  ]);
  if (!result) notFound();
  const { entry, total } = result;
  // Only a member shares: an admin is never followed.
  const canShare = owner.kind === "self" && user.role === "member";

  return (
    <PageShell user={user} width="5xl">
      <PageHeader
        {...header}
        description={`この日の${entryNumber}件目／全${total}件`}
      />

      {/* Switching owners lands on the day's list: the other person may
          have fewer entries that day, so this number could be missing. */}
      <RecordOwnerControls owner={owner} view={view} path={dateHref} />

      {canShare && entry.sharedAt ? (
        <div>
          <Badge variant="secondary">共有中（フォロワーが見られます）</Badge>
        </div>
      ) : null}

      <LearningEntryCard
        entry={entry}
        numberLabel={`#${entryNumber}`}
        defaultOpen
      />

      {/* Only your own notes: an admin viewing someone else reads only. */}
      {owner.kind === "self" ? (
        <div className="flex flex-wrap items-start justify-end gap-2">
          {canShare ? (
            <NoteActionForm
              action={shareLearningEntryAction}
              fields={{ id: entry.id, shared: String(!entry.sharedAt) }}
              label={entry.sharedAt ? "共有をやめる" : "共有する"}
              pendingLabel="変更中…"
              icon={<Share2 />}
            />
          ) : null}
          <NoteActionForm
            action={trashLearningEntryAction}
            fields={{
              id: entry.id,
              year: String(date.year),
              month: String(date.month),
              day: String(date.day),
            }}
            label="ゴミ箱に入れる"
            pendingLabel="移動中…"
            icon={<Trash2 />}
          />
        </div>
      ) : null}

      <nav
        className="flex items-center justify-between gap-3"
        aria-label="同じ日の学習ノート"
      >
        {entryNumber > 1 ? (
          <Button asChild variant="outline">
            <Link
              href={withRecordOwner(`${dateHref}/${entryNumber - 1}`, owner)}
            >
              <ArrowLeft /> 前のノート
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {entryNumber < total ? (
          <Button asChild variant="outline">
            <Link
              href={withRecordOwner(`${dateHref}/${entryNumber + 1}`, owner)}
            >
              <CalendarDays /> 次のノート
            </Link>
          </Button>
        ) : null}
      </nav>
    </PageShell>
  );
}
