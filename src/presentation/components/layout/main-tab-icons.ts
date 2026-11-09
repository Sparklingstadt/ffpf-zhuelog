import {
  BookA,
  BookOpen,
  ListChecks,
  Repeat,
  type LucideIcon,
} from "lucide-react";

import type { MainPage } from "@/presentation/presenters/site-navigation";

// One icon per main page, the same in the header and the bottom tabs.
export const MAIN_TAB_ICONS: Record<MainPage, LucideIcon> = {
  notes: BookOpen,
  review: Repeat,
  practice: ListChecks,
  vocabulary: BookA,
};
