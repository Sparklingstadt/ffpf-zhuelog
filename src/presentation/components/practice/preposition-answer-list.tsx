import { Check, X } from "lucide-react";

import type { PrepositionAnswer } from "@/domain/practice/preposition-record";
import { BLANK } from "@/domain/practice/preposition-quiz";
import { cn } from "@/presentation/lib/utils";

// A round's questions with the answer filled in and the wrong picks crossed
// out: only those with a wrong pick (`onlyMissed`), or all of them in the
// order asked.
export function PrepositionAnswerList({
  answers,
  onlyMissed = false,
  className,
}: {
  answers: readonly PrepositionAnswer[];
  onlyMissed?: boolean;
  className?: string;
}) {
  const numbered = answers.map((answer, index) => ({
    answer,
    number: index + 1,
  }));
  const missed = numbered.filter(({ answer }) => answer.misses.length > 0);
  if (onlyMissed && missed.length === 0)
    return <p className="text-sm font-medium">全問、1回目で正解しました！</p>;
  const shown = onlyMissed ? missed : numbered;
  return (
    <section className={cn("w-full space-y-2", className)}>
      <h2 className="text-sm font-medium">
        {onlyMissed
          ? `ミスした問題（${missed.length}問）`
          : `すべての問題（${answers.length}問）`}
      </h2>
      <ol className="divide-y rounded-lg border">
        {shown.map(({ answer, number }) => {
          const ok = answer.misses.length === 0;
          return (
            <li
              key={number}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {number}
                </span>
                {ok ? (
                  <Check
                    aria-label="1回目で正解"
                    className="size-4 shrink-0 text-primary"
                  />
                ) : (
                  <X
                    aria-label="ミスあり"
                    className="size-4 shrink-0 text-destructive"
                  />
                )}
                <span lang="zh-CN" className="text-base">
                  <FilledPrompt answer={answer} />
                </span>
              </span>
              {ok ? null : (
                <span
                  lang="zh-CN"
                  className="flex shrink-0 gap-2 text-sm text-destructive"
                  aria-label={`選んだ介詞: ${answer.misses.join("、")}`}
                >
                  {answer.misses.map((miss) => (
                    <s key={miss}>{miss}</s>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// The prompt with its blank filled by the answer, which stands out.
function FilledPrompt({ answer }: { answer: PrepositionAnswer }) {
  const at = answer.prompt.indexOf(BLANK);
  if (at < 0) return answer.prompt;
  return (
    <>
      {answer.prompt.slice(0, at)}
      <strong className="text-primary">{answer.answer}</strong>
      {answer.prompt.slice(at + BLANK.length)}
    </>
  );
}
