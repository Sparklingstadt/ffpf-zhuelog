import { ArrowLeft, CalendarDays, Languages } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { parseLogDate } from "@/domain/learning/value-objects/log-date";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { formatLogDate } from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

type LogDatePageProps = {
  params: Promise<{ year: string; month: string; day: string }>;
};

export default async function LogDatePage({ params }: LogDatePageProps) {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin");

  const { year, month, day } = await params;
  const date = parseLogDate(year, month, day);
  if (!date) notFound();

  const entries = await learningUseCases.listDailyEntries.execute(date);

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
              <p className="mt-2 text-sm text-muted-foreground">
                この日に追加した学習ノート：{entries.length}件
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/logs">
                <ArrowLeft /> 日付一覧へ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {entries.length === 0 ? (
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
                href={`/logs/${date.year}/${date.month}/${date.day}/${index + 1}`}
                linkLabel="詳細を開く"
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
