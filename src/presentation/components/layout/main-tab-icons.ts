import {
  BookA,
  BookOpen,
  CircleHelp,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Repeat,
  type LucideIcon,
} from "lucide-react";

import type {
  BottomPage,
  MainPage,
} from "@/presentation/presenters/site-navigation";

// One icon per main page in the header.
export const MAIN_TAB_ICONS: Record<MainPage, LucideIcon> = {
  notes: BookOpen,
  review: Repeat,
  practice: ListChecks,
  vocabulary: BookA,
};

// One icon per bottom tab; the notes and the review match the header.
export const BOTTOM_TAB_ICONS: Record<BottomPage, LucideIcon> = {
  notes: BookOpen,
  review: Repeat,
  line: MessageCircle,
  quickQuestion: CircleHelp,
  conversations: MessagesSquare,
};
