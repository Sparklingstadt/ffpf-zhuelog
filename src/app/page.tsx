import { BookOpenText, Database, Languages } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { learningNotes } from "@/composition/learning-container";
import { reviews } from "@/composition/review-container";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import {
  isEntrySearchEmpty,
  parseEntrySearch,
  type EntrySearch,
} from "@/domain/learning/entry-search";
import { GoApiError } from "@/infrastructure/go-api/client";
import type { ViewedOwner } from "@/infrastructure/go-api/learning-gateway";
import { loadRecordOwnerView } from "@/composition/record-owner-options";
import { ReauthNotice } from "@/presentation/components/auth/reauth-notice";
import { PageShell } from "@/presentation/components/layout/page-shell";
import { EntrySearchForm } from "@/presentation/components/learning/entry-search-form";
import { LearningEntryCard } from "@/presentation/components/learning/learning-entry-card";
import { RecordOwnerControls } from "@/presentation/components/records/record-owner-controls";
import { ReviewDueCard } from "@/presentation/components/review/review-due-card";
import { Alert, AlertDescription } from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { requireSignedInOwner } from "@/presentation/guards/record-owner-guard";
import { genericErrorMessage } from "@/presentation/presenters/generic-error-message";
import { getLogDateHref } from "@/presentation/presenters/log-date-presenter";
import { recentEntryNumberLabel } from "@/presentation/presenters/recent-entry-number";
import {
  requestedRecordOwner,
  withRecordOwner,
} from "@/presentation/presenters/record-owner-href";

export const dynamic = "force-dynamic";

// Go being unavailable (or failing) still shows the home with a notice. Any
// other error, including the redirect to /signin, is rethrown.
async function loadEntries(
  owner: ViewedOwner,
  search: EntrySearch,
): Promise<{
  entries: LearningEntry[];
  total: number;
  loadFailed: boolean;
}> {
  try {
    const result = await learningNotes.listRecent(owner, 100, search);
    return { ...result, loadFailed: false };
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("LEARNING_ENTRIES_UNAVAILABLE", error.status, error.code);
    return { entries: [], total: 0, loadFailed: true };
  }
}

// How many reviews are due and the review streak, or null when Go cannot
// say: the home then just leaves the card out.
async function loadDueReviews(): Promise<{
  count: number;
  streakDays: number;
} | null> {
  try {
    const { count, streakDays } = await reviews.listDue(1);
    return { count, streakDays };
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error("REVIEW_COUNT_UNAVAILABLE", error.status, error.code);
    return null;
  }
}

type HomeProps = {
  searchParams: Promise<{
    user?: string | string[];
    q?: string | string[];
    kind?: string | string[];
    hint?: string | string[];
  }>;
};

function HomeHeader() {
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
            自分が書いた文と添削後の文を、ピンインや覚えるべきヒントと一緒に蓄積します。
          </p>
        </div>
      </div>
    </header>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const { user, owner } = await requireSignedInOwner(
    requestedRecordOwner(params.user),
    "/signin",
  );
  const search = parseEntrySearch(params);
  const searching = !isEntrySearchEmpty(search);
  if (owner.kind === "redirect-self") redirect("/");

  // Guests have no notes of their own.
  if (owner.kind === "denied" && owner.reason === "guest") {
    return (
      <PageShell user={user} width="6xl" spacious>
        <HomeHeader />
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
        <HomeHeader />
        <ReauthNotice subject="学習ノート" />
      </PageShell>
    );
  }

  const ownNotes = owner.kind === "self";
  const [{ entries, total, loadFailed }, view, dueReviews] = await Promise.all([
    loadEntries(owner, search),
    loadRecordOwnerView(user, owner),
    // Only the user's own queue; an admin viewing a member sees no card.
    ownNotes ? loadDueReviews() : Promise.resolve(null),
  ]);

  return (
    <PageShell user={user} width="6xl" spacious>
      <HomeHeader />

      <RecordOwnerControls owner={owner} view={view} path="/" />

      {dueReviews === null ? null : (
        <ReviewDueCard
          count={dueReviews.count}
          streakDays={dueReviews.streakDays}
        />
      )}

      {loadFailed ? (
        <Alert variant="destructive">
          <Database />
          <AlertDescription>{genericErrorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {searching ? "検索結果" : "学習ノート"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {searching
              ? total > 0
                ? `条件に合う学習ノートが${total}件あります。新しい順に最大100件を表示します。`
                : "条件を変えて探せます。"
              : "新しく登録された文から最大100件を表示します。"}
          </p>
        </div>

        {total > 0 || searching ? (
          <EntrySearchForm
            search={search}
            viewedOwnerId={owner.kind === "other" ? owner.ownerId : undefined}
            clearHref={withRecordOwner("/", owner)}
          />
        ) : null}

        {searching && entries.length === 0 && !loadFailed ? (
          <Card className="border-dashed py-10 text-center shadow-none">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                条件に合う学習ノートはありません。語句を短くするか、条件を減らしてください。
              </p>
            </CardContent>
          </Card>
        ) : entries.length === 0 ? (
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
                numberLabel={
                  searching
                    ? `${index + 1} / ${total}`
                    : recentEntryNumberLabel(total, entries.length, index)
                }
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
