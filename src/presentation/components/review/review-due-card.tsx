import { ArrowRight, BookA, CalendarDays, Flame } from "lucide-react";
import Link from "next/link";

import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { cn } from "@/presentation/lib/utils";
import {
  dueByGroup,
  recentDays,
} from "@/presentation/presenters/review-schedule-presenter";

// The top of the home: today's reviews as the main card, with its count
// large, what it is made of and the one primary button, and beside it the
// review streak, the last 7 days and the ways to the study log and the
// vocabulary book.
export function ReviewDueCard({
  count,
  streakDays,
  byKind = {},
  recent = [],
  now,
}: {
  count: number;
  streakDays: number;
  byKind?: Readonly<Record<string, number>>;
  // Whether each of the last days had a review, oldest first.
  recent?: readonly boolean[];
  now: Date;
}) {
  const groups = dueByGroup(byKind);
  const days = recentDays(recent, now);
  return (
    <section
      aria-labelledby="review-due-heading"
      className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <Card className="py-6">
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <h2
              id="review-due-heading"
              className="text-sm font-medium text-muted-foreground"
            >
              今日の復習
            </h2>
            <p className="flex items-baseline gap-1.5">
              <span
                className="text-5xl leading-none font-semibold tracking-tight tabular-nums"
                data-testid="review-due-count"
              >
                {count}
              </span>
              <span className="text-base">問</span>
            </p>
            {count > 0 && groups.length > 0 ? (
              <ul
                aria-label="復習の内訳"
                className="flex flex-wrap gap-1.5 pt-1 text-xs"
              >
                {groups.map((group) => (
                  <li
                    key={group.label}
                    className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground"
                  >
                    {group.label}{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {group.count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {count > 0
                  ? "練習で間違えた問題、単語帳の語句、復習に入れた学習ノートの期日が来ています。"
                  : "期日が来ているものはありません。練習で間違えた問題、単語帳の語句、復習に入れた学習ノートがここに入ります。"}
              </p>
            )}
          </div>
          {count > 0 ? (
            <Button asChild size="lg" className="h-12 px-7 text-base">
              <Link href="/review">
                復習する <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Card className="py-4 md:py-6">
        <CardContent className="flex h-full flex-wrap items-center justify-between gap-3 md:flex-col md:flex-nowrap md:items-start">
          <p
            className="flex items-baseline gap-1.5 text-sm text-muted-foreground"
            title="1問以上復習した日が続いている日数"
          >
            <Flame className="size-4 self-center" />
            連続
            <span
              className="text-2xl font-semibold text-foreground tabular-nums"
              data-testid="review-streak-days"
            >
              {streakDays}
            </span>
            日
          </p>
          {days.length > 0 ? (
            <ol
              aria-label="この7日間"
              className="grid w-full grid-cols-7 gap-1.5 text-center text-[11px] text-muted-foreground max-md:order-last"
            >
              {days.map((day, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex flex-col items-center gap-1",
                    i === days.length - 1 && "font-semibold text-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-6 rounded-md",
                      day.reviewed ? "bg-primary" : "bg-muted",
                    )}
                  />
                  <span aria-hidden="true">{day.label}</span>
                  <span className="sr-only">
                    {day.date} {day.reviewed ? "復習した" : "復習なし"}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/study-log">
                <CalendarDays /> 学習ログ
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/vocabulary">
                <BookA /> 単語帳
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
