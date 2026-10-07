import { ArrowLeft, CalendarDays, Languages } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getRecordOwner } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { parseLogDate } from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import {
  TrashLink,
  TrashNotice,
} from "@/presentation/components/records/trash-notice";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
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
  const { user, owner } = await getRecordOwner(
    requestedRecordOwner(query.user),
  );
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");

  const { year, month, day } = await params;
  const date = parseLogDate(year, month, day);
  if (!date) notFound();
  const dateHref = getLogDateHref(date);
  if (owner.kind === "redirect-self") redirect(dateHref);

  const hasNotes = owner.kind === "self" || owner.kind === "other";
  const [entries, view] = hasNotes
    ? await Promise.all([
        learningUseCases.listDailyEntries.execute(owner.ownerId, date),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Languages className="size-3.5" /> Daily learning log
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {formatLogDate(date)}
              </h1>
              {hasNotes ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  この日に追加した学習ノート：{entries.length}件
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={withRecordOwner("/logs", owner)}>
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            {owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null}
            <AuthControls user={user} />
          </div>
        </header>

        {view ? (
          <RecordOwnerControls owner={owner} view={view} path={dateHref} />
        ) : null}

        {owner.kind === "self" && query.trashed === "1" ? (
          <TrashNotice href="/logs/trash" />
        ) : null}

        {!hasNotes ? (
          <ReauthNotice subject="学習ノート" />
        ) : entries.length === 0 ? (
          <Card className="border-dashed py-12 text-center shadow-none">
            <CardContent>
              <CalendarDays className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">この日の学習ノートはありません</p>
            </CardContent>
          </Card>
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
      </div>
    </main>
  );
}
