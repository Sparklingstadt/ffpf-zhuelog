import {
  HSK_BASES,
  HSK_BASIS_LABELS,
  type HskBasis,
} from "@/domain/practice/hsk-level";
import { setHskBasisAction } from "@/presentation/actions/hsk-basis-actions";
import { cn } from "@/presentation/lib/utils";

// Chooses how a question's HSK level is decided: the hand-made list of hard
// words, or the official HSK 3.0 word list. The choice is remembered. On
// small screens it moves below the practice, which needs the room above the tabs.
export function HskBasisSwitch({
  current,
  returnTo,
}: {
  current: HskBasis;
  returnTo: string;
}) {
  return (
    <form
      action={setHskBasisAction}
      className="flex flex-wrap items-center gap-2 text-sm cramped:order-last"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <span id="hsk-basis-label" className="text-muted-foreground">
        級の決め方
      </span>
      <div
        role="group"
        aria-labelledby="hsk-basis-label"
        className="inline-flex overflow-hidden rounded-md border"
      >
        {HSK_BASES.map((basis) => (
          <button
            key={basis}
            type="submit"
            name="basis"
            value={basis}
            aria-pressed={basis === current}
            className={cn(
              "px-3 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&+&]:border-l",
              basis === current
                ? "bg-secondary font-medium text-secondary-foreground"
                : "bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            {HSK_BASIS_LABELS[basis]}
          </button>
        ))}
      </div>
    </form>
  );
}
