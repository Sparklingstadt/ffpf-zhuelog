import { ArrowRight, BookA, CalendarDays, Flame } from "lucide-react";
import Link from "next/link";

import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

// The top of the home: today's reviews as the main card, with its count
// large and the one primary button, and beside it the review streak and the
// ways to the study log and the vocabulary book.
export function ReviewDueCard({
  count,
  streakDays,
}: {
  count: number;
  streakDays: number;
}) {
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
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {count > 0
                ? "練習で間違えた問題、単語帳の語句、復習に入れた学習ノートの期日が来ています。"
                : "期日が来ているものはありません。練習で間違えた問題、単語帳の語句、復習に入れた学習ノートがここに入ります。"}
            </p>
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
