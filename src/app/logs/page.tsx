import { ArrowLeft, CalendarDays, ChevronRight, Languages } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRecordOwner } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { AuthControls } from "@/presentation/components/auth/auth-controls";
import { ReauthNotice } from "@/presentation/components/chat/reauth-notice";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { TrashLink } from "@/presentation/components/records/trash-notice";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import {
  formatLogDateKey,
  getLogDateHref,
} from "@/presentation/presenters/log-date-presenter";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

type LogsPageProps = {
  searchParams: Promise<{ user?: string | string[] }>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const { user, owner } = await getRecordOwner(
    requestedRecordOwner((await searchParams).user),
  );
  if (!user || (owner.kind === "denied" && owner.reason === "unauthenticated"))
    redirect("/signin?callbackUrl=/logs");
  if (owner.kind === "denied" && owner.reason === "guest") redirect("/");
  if (owner.kind === "redirect-self") redirect("/logs");

  const hasNotes = owner.kind === "self" || owner.kind === "other";
  const [dates, view] = hasNotes
    ? await Promise.all([
        learningUseCases.listLogDates.execute(owner.ownerId),
        loadRecordOwnerView(user, owner),
      ])
    : [[], null];

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
              <Link href={withRecordOwner("/", owner)}>
                <ArrowLeft /> 学習ノートへ
              </Link>
            </Button>
            {owner.kind === "self" ? <TrashLink href="/logs/trash" /> : null}
            <AuthControls user={user} />
          </div>
        </header>

        {view ? (
          <RecordOwnerControls owner={owner} view={view} path="/logs" />
        ) : null}

        {!hasNotes ? (
          <ReauthNotice subject="学習ノート" />
        ) : dates.length === 0 ? (
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
                href={withRecordOwner(getLogDateHref(group.date), owner)}
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
