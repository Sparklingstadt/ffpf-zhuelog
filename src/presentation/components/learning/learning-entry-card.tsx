import { CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import Link from "next/link";

import type { LearningEntry } from "@ffpf-zhuelog/core/domain/learning/entities/learning-entry";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/presentation/components/ui/card";
import {
  diffCorrection,
  type DiffSegment,
} from "@/presentation/presenters/correction-diff-presenter";
import { formatTokyoDateTime } from "@/presentation/presenters/log-date-presenter";

type LearningEntryCardProps = {
  entry: LearningEntry;
  numberLabel: string;
  href?: string;
  linkLabel?: string;
  defaultOpen?: boolean;
};

const deletedClassName =
  "rounded-[3px] bg-destructive/10 text-destructive line-through decoration-destructive/60 box-decoration-clone dark:bg-destructive/20";
const insertedClassName =
  "rounded-[3px] bg-primary/12 font-semibold text-primary underline decoration-primary/60 decoration-2 underline-offset-[5px] box-decoration-clone";
const sectionLabelClassName =
  "text-xs font-medium tracking-wider text-muted-foreground";

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return segments.map((segment, index) =>
    segment.kind === "delete" ? (
      <del key={index} className={deletedClassName}>
        {segment.text}
      </del>
    ) : segment.kind === "insert" ? (
      <ins key={index} className={insertedClassName}>
        {segment.text}
      </ins>
    ) : (
      segment.text
    ),
  );
}

export function LearningEntryCard({
  entry,
  numberLabel,
  href,
  linkLabel = "ノートを開く",
  defaultOpen = true,
}: LearningEntryCardProps) {
  const diff = diffCorrection(entry.originalText, entry.correctedText);
  const hasHints = entry.hints.length > 0;
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
          {diff.changeCount > 0 ? (
            <Badge className="bg-primary/12 font-normal text-primary">
              {diff.changeCount}箇所を添削
            </Badge>
          ) : (
            <Badge variant="secondary" className="font-normal">
              添削なし
            </Badge>
          )}
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
          <CardContent
            className={
              hasHints
                ? "grid min-w-0 grid-cols-1 p-0 md:grid-cols-[minmax(0,1fr)_16rem]"
                : "min-w-0 p-0"
            }
          >
            <div className="min-w-0 space-y-4 p-5 sm:p-6">
              <div className="space-y-1.5">
                <p className={sectionLabelClassName}>添削前</p>
                <p
                  lang="zh-Hans"
                  className="text-base leading-7 text-muted-foreground"
                >
                  <DiffText segments={diff.original} />
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium tracking-wider text-primary">
                  <span className="size-1.5 rounded-full bg-primary" />
                  添削後
                </p>
                <p
                  lang="zh-Hans"
                  className="text-xl leading-9 font-medium sm:text-[1.375rem]"
                >
                  <DiffText segments={diff.corrected} />
                </p>
                <p className="text-sm text-muted-foreground">{entry.pinyin}</p>
              </div>
            </div>
            {hasHints ? (
              <div className="min-w-0 space-y-3 border-t bg-muted/40 p-5 sm:p-6 md:border-t-0 md:border-l">
                <p className={sectionLabelClassName}>覚えるポイント</p>
                <ol className="space-y-2.5">
                  {entry.hints.map((hint, index) => (
                    <li
                      key={hint.id}
                      className="flex gap-2.5 text-sm leading-6"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-[11px] text-primary"
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">{hint.content}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {diff.changeCount > 0 ? (
                <span className="flex items-center gap-3" aria-hidden="true">
                  <span className={deletedClassName}>削除</span>
                  <span className={insertedClassName}>追加</span>
                </span>
              ) : null}
              <time
                dateTime={entry.createdAt.toISOString()}
                className="flex items-center gap-1.5 text-muted-foreground sm:hidden"
              >
                <Clock3 className="size-3.5" />
                {formatTokyoDateTime(entry.createdAt)} JST
              </time>
            </div>
            {href ? (
              <Button asChild variant="ghost" size="sm" className="ml-auto">
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
