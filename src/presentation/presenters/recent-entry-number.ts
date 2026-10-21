// The home page lists the newest notes first and numbers them down from the
// total. Go counts before it lists, so total is normally at least the number
// shown; taking the larger keeps the numbers at 1 or above even if it is not.
export function recentEntriesTotal(total: number, shown: number): number {
  return Math.max(total, shown);
}

export function recentEntryNumberLabel(
  total: number,
  shown: number,
  index: number,
): string {
  return `#${Math.max(1, recentEntriesTotal(total, shown) - index)}`;
}
