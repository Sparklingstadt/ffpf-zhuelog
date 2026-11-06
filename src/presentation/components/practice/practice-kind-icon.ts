import { MoveRight, Shuffle, type LucideIcon } from "lucide-react";

import type { PracticeKind } from "@/domain/practice/practice-quiz";

// The icon of each kind of practice, in the header and the page headers.
// Kept out of the domain so it stays free of React.
const ICONS: Record<PracticeKind, LucideIcon> = {
  preposition: Shuffle,
  complement: MoveRight,
};

export function practiceKindIcon(kind: PracticeKind): LucideIcon {
  return ICONS[kind];
}
