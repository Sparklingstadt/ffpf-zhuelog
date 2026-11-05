import { ArrowRight, BookA, CalendarDays, Flame, Repeat } from "lucide-react";
import Link from "next/link";

import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

// The home's way into today's reviews: how many are due, how many days in a
// row the user has reviewed, and a link.
export function ReviewDueCard({
  count,
  streakDays,
}: {
  count: number;
  streakDays: number;
}) {
  return (
    <Card className="py-5">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-muted p-2.5">
            <Repeat className="size-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">
              今日の復習{" "}
              <span className="font-mono" data-testid="review-due-count">
                {count}
              </span>
              問
            </p>
            <p className="text-sm text-muted-foreground">
              {count > 0
                ? "練習で間違えた問題や単語帳の語句の期日が来ています。"
                : "期日が来ている問題はありません。練習で間違えた問題と単語帳の語句がここに入ります。"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <p
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
            title="1問以上復習した日が続いている日数"
          >
            <Flame className="size-4" />
            連続{" "}
            <span
              className="font-mono text-base text-foreground"
              data-testid="review-streak-days"
            >
              {streakDays}
            </span>
            日
          </p>
          <Button asChild variant="outline">
            <Link href="/study-log">
              <CalendarDays /> 学習ログ
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/vocabulary">
              <BookA /> 単語帳
            </Link>
          </Button>
          {count > 0 ? (
            <Button asChild>
              <Link href="/review">
                復習する <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
