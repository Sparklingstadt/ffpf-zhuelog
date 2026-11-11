import {
  BookPlus,
  ChevronLeft,
  ChevronRight,
  Repeat,
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
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import { GoApiError } from "@/infrastructure/go-api/client";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { shareLearningEntryAction } from "@/presentation/actions/follow-actions";
import { setNoteReviewAction } from "@/presentation/actions/note-review-actions";
import { trashLearningEntryAction } from "@/presentation/actions/note-trash-actions";
import {
  draftVocabularyAction,
  saveVocabularyAction,
} from "@/presentation/actions/vocabulary-actions";
import { Breadcrumbs } from "@/presentation/components/layout/breadcrumbs";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { NoteActionForm } from "@/presentation/components/records/note-action-form";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { VocabularyAddForm } from "@/presentation/components/vocabulary/vocabulary-add-form";
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

// Whether the note is in the user's review queue. Go failing hides the
// control rather than the note; any other error is rethrown.
async function loadInReview(id: string): Promise<boolean | null> {
  try {
    return await learningNotes.isInReview(id);
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("NOTE_REVIEW_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

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

  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "学習ノート", href: withRecordOwner("/", owner) },
        { label: formatLogDate(date), href: withRecordOwner(dateHref, owner) },
        { label: `#${entryNumber}` },
      ]}
    />
  );

  if (owner.kind === "denied") {
    return (
      <PageShell user={user} width="5xl">
        {crumbs}
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
  // Only your own notes go into your queue, and only members and admins
  // have one.
  const inReview =
    owner.kind === "self" && isMemberRole(user.role)
      ? await loadInReview(entry.id)
      : null;
  // Only a member shares: an admin is never followed.
  const canShare = owner.kind === "self" && user.role === "member";

  const sameDay = (n: number) => withRecordOwner(`${dateHref}/${n}`, owner);

  return (
    <PageShell user={user} width="6xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">{crumbs}</div>
        <nav
          className="flex items-center gap-1"
          aria-label="同じ日の学習ノート"
        >
          {entryNumber > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={sameDay(entryNumber - 1)}>
                <ChevronLeft /> 前のノート
              </Link>
            </Button>
          ) : null}
          <span className="px-2 text-sm text-muted-foreground tabular-nums">
            {entryNumber} / {total}
          </span>
          {entryNumber < total ? (
            <Button asChild variant="outline" size="sm">
              <Link href={sameDay(entryNumber + 1)}>
                次のノート <ChevronRight />
              </Link>
            </Button>
          ) : null}
        </nav>
      </div>

      {/* Switching owners lands on the day's list: the other person may
          have fewer entries that day, so this number could be missing. */}
      <RecordOwnerControls owner={owner} view={view} path={dateHref} />

      {/* Phones put the note's actions right under it, before the form;
          wide screens keep them in the right column. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 lg:col-start-1">
          <LearningEntryCard
            entry={entry}
            numberLabel={`#${entryNumber}`}
            defaultOpen
          />
        </div>
        <aside
          className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          aria-label="このノート"
        >
          {(canShare && entry.sharedAt) || inReview ? (
            <div className="flex flex-wrap gap-2">
              {canShare && entry.sharedAt ? (
                <Badge variant="secondary">
                  共有中（フォロワーが見られます）
                </Badge>
              ) : null}
              {inReview ? (
                <Badge variant="secondary">今日の復習に入っています</Badge>
              ) : null}
            </div>
          ) : null}
          {/* Only your own notes: an admin viewing someone else reads only. */}
          {owner.kind === "self" ? (
            <div className="flex flex-col gap-1 rounded-xl border bg-card p-2 [&_button]:w-full [&_button]:justify-start [&>*]:w-full">
              {inReview !== null ? (
                <NoteActionForm
                  action={setNoteReviewAction}
                  fields={{ id: entry.id, inReview: String(!inReview) }}
                  label={inReview ? "復習から外す" : "復習に入れる"}
                  pendingLabel="変更中…"
                  icon={<Repeat />}
                  variant="ghost"
                />
              ) : null}
              {canShare ? (
                <NoteActionForm
                  action={shareLearningEntryAction}
                  fields={{ id: entry.id, shared: String(!entry.sharedAt) }}
                  label={entry.sharedAt ? "共有をやめる" : "共有する"}
                  pendingLabel="変更中…"
                  icon={<Share2 />}
                  variant="ghost"
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
                variant="ghost"
              />
            </div>
          ) : null}
          <p className="px-1 text-xs text-muted-foreground">
            この日の{entryNumber}件目／全{total}件
          </p>
        </aside>
        <div className="min-w-0 lg:col-start-1">
          {/* Words go into the user's own book, so only from their own
              notes. A <details> would count as a note card. */}
          {owner.kind === "self" ? (
            <section
              aria-labelledby="add-word"
              className="space-y-3 rounded-xl border bg-card px-5 py-4"
            >
              <div>
                <h2
                  id="add-word"
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <BookPlus className="size-4 text-muted-foreground" />
                  単語帳に入れる
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  添削後の文から覚えたい語句を選んで「選んだ語句を入れる」を押すか、語句を入力してください。
                </p>
              </div>
              <VocabularyAddForm
                sentence={entry.correctedText}
                sourceEntryId={entry.id}
                draftVocabulary={draftVocabularyAction}
                saveVocabulary={saveVocabularyAction}
              />
            </section>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
