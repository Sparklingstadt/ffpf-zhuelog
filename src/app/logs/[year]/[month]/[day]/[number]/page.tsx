import { ArrowLeft, CalendarDays, Languages } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getRecordOwner } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import {
  parseLogDate,
  parseLogNumber,
} from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
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
  const { user, owner } = await getRecordOwner(
    requestedRecordOwner((await searchParams).user),
  );
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const entryNumber = parseLogNumber(number);
  if (!date || !entryNumber) notFound();
  const dateHref = getLogDateHref(date);
  if (owner.kind === "redirect-self") redirect(`${dateHref}/${entryNumber}`);

  const header = (
    <div className="space-y-3">
      <Badge variant="secondary" className="gap-1.5">
        <Languages className="size-3.5" /> Daily learning log
      </Badge>
      <h1 className="text-3xl font-semibold tracking-tight">
        {formatLogDate(date)} · #{entryNumber}
      </h1>
    </div>
  );
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={withRecordOwner(dateHref, owner)}>
          <ArrowLeft /> この日の一覧へ
        </Link>
      </Button>
      <AuthControls user={user} />
    </div>
  );

  if (owner.kind === "denied") {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
            {header}
            {actions}
          </header>
          <ReauthNotice subject="学習ノート" />
        </div>
      </main>
    );
  }

  const [result, view] = await Promise.all([
    learningUseCases.getDailyEntry.execute(owner.ownerId, date, entryNumber),
    loadRecordOwnerView(user, owner),
  ]);
  if (!result) notFound();
  const { entry, total } = result;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            {header}
            <p className="text-sm text-muted-foreground">
              この日の{entryNumber}件目／全{total}件
            </p>
          </div>
          {actions}
        </header>

        {/* Switching owners lands on the day's list: the other person may
            have fewer entries that day, so this number could be missing. */}
        <RecordOwnerControls owner={owner} view={view} path={dateHref} />

        <LearningEntryCard
          entry={entry}
          numberLabel={`#${entryNumber}`}
          defaultOpen
        />

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
      </div>
    </main>
  );
}
