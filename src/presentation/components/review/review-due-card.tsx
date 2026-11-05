import { ArrowRight, Repeat } from "lucide-react";
import Link from "next/link";

import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";

// The home's way into today's reviews: how many are due, and a link.
export function ReviewDueCard({ count }: { count: number }) {
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
                ? "練習で間違えた問題の期日が来ています。"
                : "期日が来ている問題はありません。練習で間違えた問題がここに入ります。"}
            </p>
          </div>
        </div>
        {count > 0 ? (
          <Button asChild>
            <Link href="/review">
              復習する <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
