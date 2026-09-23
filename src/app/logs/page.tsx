import { ArrowLeft, CalendarDays, ChevronRight, Languages } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const user = await getCurrentViewerUser();
  if (!user) redirect("/signin?callbackUrl=/logs");

  const dates = await learningUseCases.listLogDates.execute();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Languages className="size-3.5" /> Chinese learning log
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                日付別の学習ノート
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                学習文を登録した日から一覧を開けます。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            <AuthControls user={user} />
          </div>
        </header>

        {dates.length === 0 ? (
          <Card className="border-dashed py-12 text-center shadow-none">
            <CardContent>
              <CalendarDays className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">まだ学習ノートがありません</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {dates.map((group) => (
              <Link
                key={formatLogDateKey(group.date)}
                href={getLogDateHref(group.date)}
                className="group"
              >
                <Card className="transition-colors group-hover:bg-muted/40">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                        <CalendarDays className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {formatLogDateKey(group.date)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {group.count}件の学習ノート
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
