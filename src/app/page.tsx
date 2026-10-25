import {
  BookOpenText,
  CalendarDays,
  Database,
  Download,
  FileUp,
  Languages,
  MessageCircle,
  MessagesSquare,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  showsRecords,
  type RecordOwner,
} from "@/application/identity/use-cases/resolve-record-owner";
import { learningNotes } from "@/composition/learning-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import { GoApiError } from "@/infrastructure/go-api/client";
import type { ViewedOwner } from "@/infrastructure/go-api/learning-gateway";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requireSignedInOwner } from "@/presentation/guards/record-owner-guard";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";
import { getLogDateHref } from "@/presentation/presenters/log-date-presenter";
import {
  recentEntriesTotal,
  recentEntryNumberLabel,
} from "@/presentation/presenters/recent-entry-number";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

// Go being unavailable (or failing) still shows the home with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadEntries(owner: ViewedOwner): Promise<{
  entries: LearningEntry[];
  total: number;
  loadFailed: boolean;
}> {
  try {
    const result = await learningNotes.listRecent(owner, 100);
    return { ...result, loadFailed: false };
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("LEARNING_ENTRIES_UNAVAILABLE", error.status, error.code);
    return { entries: [], total: 0, loadFailed: true };
  }
}

type HomeProps = {
  searchParams: Promise<{ user?: string | string[] }>;
};

function HomeHeader({
  owner,
  total,
  canChat,
}: {
  owner: RecordOwner;
  // Number of entries for the viewed owner; null when no notes are shown.
  total: number | null;
  // Members and admins also get the ChatGPT chat and its conversation notes.
  canChat: boolean;
}) {
  const hasNotes = showsRecords(owner);
  return (
    <header className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <Badge variant="secondary" className="gap-1.5">
          <Languages className="size-3.5" /> Chinese learning log
        </Badge>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            学习録
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            自分が書いた文と添削後の文を、ピン音や覚えるべきヒントと一緒に蓄積します。
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {total === null ? null : (
          <div className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-xs">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">登録済み</span>
            <strong className="font-mono text-base">{total}</strong>
            <span className="text-muted-foreground">文</span>
          </div>
        )}
        {hasNotes ? (
          <Button asChild variant="outline" size="lg">
            <Link href={withRecordOwner("/logs", owner)}>
              <CalendarDays /> 日付から見る
            </Link>
          </Button>
        ) : null}
        {canChat ? (
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/chat">
                <MessageCircle /> ChatGPT と話す
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/conversations">
                <MessagesSquare /> 会話ノート
              </Link>
            </Button>
          </>
        ) : null}
        {/* Import and export act on the signed-in user's own notes only. */}
        {owner.kind === "self" ? (
          <>
            <Button asChild variant="outline" size="lg">
              <Link href="/import">
                <FileUp /> CSVをインポート
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/export">
                <Download /> CSVでエクスポート
              </Link>
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const { user, owner } = await requireSignedInOwner(
    requestedRecordOwner((await searchParams).user),
    "/signin",
  );
  if (owner.kind === "redirect-self") redirect("/");

  // Guests have no notes of their own.
  if (owner.kind === "denied" && owner.reason === "guest") {
    return (
      <PageShell user={user} width="6xl" spacious>
        <HomeHeader
          owner={owner}
          total={null}
          canChat={isMemberRole(user.role)}
        />
        <Card className="border-dashed py-14 text-center shadow-none">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="rounded-full bg-muted p-3">
              <BookOpenText className="size-6 text-muted-foreground" />
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              学習ノートは、ログインしたユーザーごとの記録です。ゲストは学習ノートを利用できません。
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (owner.kind === "denied") {
    return (
      <PageShell user={user} width="6xl" spacious>
        <HomeHeader
          owner={owner}
          total={null}
          canChat={isMemberRole(user.role)}
        />
        <ReauthNotice subject="学習ノート" />
      </PageShell>
    );
  }

  const [{ entries, total, loadFailed }, view] = await Promise.all([
    loadEntries(owner),
    loadRecordOwnerView(user, owner),
  ]);
  const ownNotes = owner.kind === "self";

  return (
    <PageShell user={user} width="6xl" spacious>
      <HomeHeader
        owner={owner}
        total={recentEntriesTotal(total, entries.length)}
        canChat={isMemberRole(user.role)}
      />

      <RecordOwnerControls owner={owner} view={view} path="/" />

      {loadFailed ? (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">学習ノート</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            新しく登録された文から最大100件を表示します。
          </p>
        </div>

        {entries.length === 0 ? (
          <Card className="border-dashed py-14 text-center shadow-none">
            <CardContent className="flex flex-col items-center gap-3">
              <div className="rounded-full bg-muted p-3">
                <BookOpenText className="size-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">まだ学習文がありません</p>
                {ownNotes ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Link
                      href="/import"
                      className="font-medium text-foreground underline underline-offset-4"
                    >
                      CSVをインポート
                    </Link>
                    すると、ここに学習カードが並びます。
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {entries.map((entry, index) => (
              <LearningEntryCard
                key={entry.id}
                entry={entry}
                numberLabel={recentEntryNumberLabel(
                  total,
                  entries.length,
                  index,
                )}
                href={withRecordOwner(getLogDateHref(entry.createdAt), owner)}
                linkLabel="この日の一覧"
              />
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
