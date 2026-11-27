import {
  aiUsageMonthOf,
  aiUsageMonthRange,
  isAiUsageMonth,
  type AiUsageMonth,
  type AiUsageTotal,
} from "../../domain/ai-usage/monthly-usage";
import type { AuthenticatedUser } from "../../domain/identity/entities/authenticated-user";

// Only admins read the AI usage (not while impersonating a member: the
// admin is then that member).
export class AiUsageForbiddenError extends Error {
  override name = "AiUsageForbiddenError";
}

export type AiUsageSummaryDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // Every owner's totals of the calls in [from, to), most tokens first.
  store: { monthTotals(from: Date, to: Date): Promise<AiUsageTotal[]> };
  now: () => Date;
};

// The admin's monthly summary of OpenAI usage. The admin is checked first,
// so anyone else is refused before the month is checked.
export function createAiUsageSummary(deps: AiUsageSummaryDeps) {
  return {
    // month: "YYYY-MM" in Japan time; without it, the Japan month of now.
    // RangeError when it is not isAiUsageMonth.
    async month(month?: string): Promise<AiUsageMonth> {
      const user = await deps.currentUser();
      if (user?.role !== "admin") throw new AiUsageForbiddenError();
      const read = month ?? aiUsageMonthOf(deps.now());
      if (!isAiUsageMonth(read)) throw new RangeError("not a month");
      const { from, to } = aiUsageMonthRange(read);
      return { month: read, totals: await deps.store.monthTotals(from, to) };
    },
  };
}
