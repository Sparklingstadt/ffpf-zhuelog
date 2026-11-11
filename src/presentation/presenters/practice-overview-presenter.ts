import {
  roundModeLabel,
  type ComplementRecordSummary,
} from "@/domain/practice/complement-record";
import {
  accuracyPercent,
  type PrepositionRecordSummary,
} from "@/domain/practice/preposition-record";

// The four practices on the practice page.
export type PracticeKind = "preposition" | "complement" | "measure" | "aspect";

// Which practice a saved complement round belongs to: measure words and
// 了・过・着 are kept with the complements.
export function practiceKindOf(
  record: Pick<ComplementRecordSummary, "mode">,
): PracticeKind {
  if (record.mode === "measure") return "measure";
  if (record.mode === "aspect") return "aspect";
  return "complement";
}

export type RoundRow = {
  id: string;
  kind: PracticeKind;
  // 「介詞」「補語・結果補語」「量詞」.
  label: string;
  href: string;
  createdAt: Date;
  accuracy: number;
  missCount: number;
  elapsedMs: number;
};

// Both kinds of saved rounds as one list, newest first.
export function mergeRounds(
  prepositions: readonly PrepositionRecordSummary[],
  complements: readonly ComplementRecordSummary[],
): RoundRow[] {
  const rows: RoundRow[] = [
    ...prepositions.map((r) => ({
      id: r.id,
      kind: "preposition" as const,
      label: "介詞",
      href: `/practice/prepositions/records/${r.id}`,
      createdAt: r.createdAt,
      accuracy: accuracyPercent(r.firstTryCount, r.questionCount) ?? 0,
      missCount: r.missCount,
      elapsedMs: r.elapsedMs,
    })),
    ...complements.map((r) => {
      const kind = practiceKindOf(r);
      return {
        id: r.id,
        kind,
        label:
          kind === "complement"
            ? `補語・${roundModeLabel(r.mode)}`
            : roundModeLabel(r.mode),
        href: `/practice/complements/records/${r.id}`,
        createdAt: r.createdAt,
        accuracy: accuracyPercent(r.firstTryCount, r.questionCount) ?? 0,
        missCount: r.missCount,
        elapsedMs: r.elapsedMs,
      };
    }),
  ];
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// The latest round of each practice, from rows newest first.
export function latestByKind(
  rows: readonly RoundRow[],
): Partial<Record<PracticeKind, RoundRow>> {
  const out: Partial<Record<PracticeKind, RoundRow>> = {};
  for (const row of rows) out[row.kind] ??= row;
  return out;
}
