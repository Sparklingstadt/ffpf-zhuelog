import { ArrowLeft, CalendarDays, Languages } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentAdminUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { parseLogDate, parseLogNumber } from "@/domain/learning/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { formatLogDate } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type LogDetailPageProps = {
  params: Promise<{ year: string; month: string; day: string; number: string }>;
};

export default async function LogDetailPage({ params }: LogDetailPageProps) {
  const user = await getCurrentAdminUser();
  if (!user) redirect("/signin");

  const { year, month, day, number } = await params;
  const date = parseLogDate(year, month, day);
  const entryNumber = parseLogNumber(number);
  if (!date || !entryNumber) notFound();

  const result = await learningUseCases.getDailyEntry.execute(date, entryNumber);
  if (!result) notFound();
  const { entry, total } = result;

  const dateHref = `/logs/${date.year}/${date.month}/${date.day}`;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Languages className="size-3.5" /> Daily learning log
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{formatLogDate(date)} · #{entryNumber}</h1>
              <p className="mt-2 text-sm text-muted-foreground">この日の{entryNumber}件目／全{total}件</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={dateHref}><ArrowLeft /> この日の一覧へ</Link>
            </Button>
            <AuthControls githubLogin={user.githubLogin} />
          </div>
        </header>

        <LearningEntryCard entry={entry} numberLabel={`#${entryNumber}`} defaultOpen />

        <nav className="flex items-center justify-between gap-3" aria-label="同じ日の学習ノート">
          {entryNumber > 1 ? (
            <Button asChild variant="outline">
              <Link href={`${dateHref}/${entryNumber - 1}`}><ArrowLeft /> 前のノート</Link>
            </Button>
          ) : <span />}
          {entryNumber < total ? (
            <Button asChild variant="outline">
              <Link href={`${dateHref}/${entryNumber + 1}`}><CalendarDays /> 次のノート</Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </main>
  );
}
