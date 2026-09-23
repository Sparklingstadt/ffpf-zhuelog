import { CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import Link from "next/link";

import type { LearningEntry } from "@/domain/learning/entities/learning-entry";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/presentation/components/ui/card";
import { Separator } from "@/presentation/components/ui/separator";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

type LearningEntryCardProps = {
  entry: LearningEntry;
  numberLabel: string;
  href?: string;
  linkLabel?: string;
  defaultOpen?: boolean;
};

export function LearningEntryCard({
  entry,
  numberLabel,
  href,
  linkLabel = "ノートを開く",
  defaultOpen = true,
}: LearningEntryCardProps) {
  return (
    <Card
      asChild
      className="group/card min-w-0 max-w-full gap-0 overflow-hidden py-0 shadow-xs"
    >
      <details open={defaultOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {numberLabel}
          </span>
          <span lang="zh-Hans" className="min-w-0 flex-1 truncate font-medium">
            {entry.originalText}
          </span>
          <time
            dateTime={entry.createdAt.toISOString()}
            className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex"
          >
            <Clock3 className="size-3.5" />
            {formatTokyoDateTime(entry.createdAt)} JST
          </time>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/card:rotate-180" />
          <span className="sr-only">学習ノートを開閉</span>
        </summary>

        <div className="min-w-0 border-t [overflow-wrap:anywhere]">
          <CardContent className="p-0">
            <div className="grid min-w-0 grid-cols-1 md:grid-cols-2">
              <div className="min-w-0 space-y-3 bg-muted/40 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    最初の文
                  </p>
                  <span className="font-mono text-xs text-muted-foreground">
                    {numberLabel}
                  </span>
                </div>
                <p lang="zh-Hans" className="text-lg leading-8">
                  {entry.originalText}
                </p>
              </div>
              <div className="min-w-0 space-y-3 border-t p-5 sm:p-6 md:border-t-0 md:border-l">
                <div>
                  <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    添削後の文
                  </p>
                  <p
                    lang="zh-Hans"
                    className="mt-2 text-lg font-medium leading-8"
                  >
                    {entry.correctedText}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.pinyin}
                  </p>
                </div>
                {entry.hints.length > 0 ? (
                  <>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      {entry.hints.map((hint) => (
                        <Badge
                          key={hint.id}
                          variant="outline"
                          className="h-auto min-w-0 max-w-full shrink rounded-lg text-left leading-5 font-normal whitespace-normal"
                        >
                          <span className="min-w-0">{hint.content}</span>
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3 py-3 sm:justify-end">
            <time
              dateTime={entry.createdAt.toISOString()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground sm:hidden"
            >
              <Clock3 className="size-3.5" />
              {formatTokyoDateTime(entry.createdAt)} JST
            </time>
            {href ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={href}>
                  <CalendarDays /> {linkLabel}
                </Link>
              </Button>
            ) : null}
          </CardFooter>
        </div>
      </details>
    </Card>
  );
}
