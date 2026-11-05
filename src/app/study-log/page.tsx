import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { studyLog } from "@/composition/study-log-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  formatMonth,
  monthGrid,
  monthOf,
  parseMonth,
  shiftMonth,
  summarize,
  todayInJapan,
  type StudyDay,
} from "@/domain/study-log/study-log";
import { GoApiError } from "@/infrastructure/go-api/client";
import { PageHeader } from "@/presentation/components/layout/page-header";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { StudyCalendar } from "@/presentation/components/study-log/study-calendar";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";

export const dynamic = "force-dynamic";

type StudyLogPageProps = {
  searchParams: Promise<{ month?: string | string[] }>;
};

// Go being unavailable (or failing) still shows the page with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadDays(from: string, to: string): Promise<StudyDay[] | null> {
  try {
    return await studyLog.list(from, to);
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("STUDY_LOG_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

// A month of the signed-in member's or admin's study, as a calendar. Guests
// have no log, so they go home.
export default async function StudyLogPage({
  searchParams,
}: StudyLogPageProps) {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/study-log");
  if (!isMemberRole(user.role)) redirect("/");

  const today = todayInJapan();
  const month = parseMonth((await searchParams).month) ?? monthOf(today);
  const weeks = monthGrid(month);
  const days = await loadDays(weeks[0][0].date, weeks.at(-1)!.at(-1)!.date);
  const monthKey = formatMonth(month);
  const inMonth = (days ?? []).filter((d) => d.date.startsWith(monthKey));
  const total = summarize(inMonth);
  const isCurrent = monthKey === formatMonth(monthOf(today));

  const stats = [
    { label: "学習した日", value: total.activeDays, unit: "日" },
    { label: "復習", value: total.reviews, unit: "回" },
    { label: "練習", value: total.practiceQuestions, unit: "問" },
    { label: "ノート", value: total.notes, unit: "件" },
    { label: "単語", value: total.words, unit: "語" },
  ];

  return (
    <PageShell user={user} width="4xl">
      <PageHeader
        icon={CalendarDays}
        eyebrow="Study log"
        title="学習ログ"
        description="日本時間の日ごとに、復習・練習・学習ノート・単語帳でしたことを数えます。色が濃いほど多く学習した日です。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft /> ホームへ
            </Link>
          </Button>
        }
      />

      <nav
        aria-label="月の切り替え"
        className="flex items-center justify-between gap-3"
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/study-log?month=${formatMonth(shiftMonth(month, -1))}`}>
            <ChevronLeft /> 前の月
          </Link>
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">
          {month.year}年{month.month}月
        </h2>
        {isCurrent ? (
          <span className="w-[5.5rem]" />
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/study-log?month=${formatMonth(shiftMonth(month, 1))}`}
            >
              次の月 <ChevronRight />
            </Link>
          </Button>
        )}
      </nav>

      {days === null ? (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      ) : (
        <>
          <dl
            aria-label="この月の合計"
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            {stats.map((s) => (
              <Card key={s.label} className="py-3">
                <CardContent className="px-4">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className="text-xl font-semibold">
                    <span className="font-mono">{s.value}</span>
                    <span className="ml-0.5 text-sm font-normal">{s.unit}</span>
                  </dd>
                </CardContent>
              </Card>
            ))}
          </dl>
          <StudyCalendar month={month} days={days} today={today} />
        </>
      )}
    </PageShell>
  );
}
