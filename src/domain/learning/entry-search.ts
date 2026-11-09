import { LEARNING_KINDS, type LearningKind } from "./entities/learning-entry";

// What the learner searches their notes for. Every field is optional; the
// ones given must all match. query matches the written text, the corrected
// text, the pinyin or a hint; hint matches a hint only.
export type EntrySearch = {
  query: string;
  kind: LearningKind | null;
  hint: string;
};

// Go's limit for query and hint.
export const ENTRY_SEARCH_MAX_LENGTH = 100;

const EMPTY: EntrySearch = { query: "", kind: null, hint: "" };

function firstValue(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
}

function text(value: unknown): string {
  return [...firstValue(value).trim()]
    .slice(0, ENTRY_SEARCH_MAX_LENGTH)
    .join("");
}

// Reads ?q=, ?kind= and ?hint= of a page. Unknown kinds are ignored and long
// texts are cut to Go's limit, so a hand-edited URL still searches.
export function parseEntrySearch(params: {
  q?: unknown;
  kind?: unknown;
  hint?: unknown;
}): EntrySearch {
  const kind = firstValue(params.kind);
  return {
    query: text(params.q),
    kind: (LEARNING_KINDS as readonly string[]).includes(kind)
      ? (kind as LearningKind)
      : null,
    hint: text(params.hint),
  };
}

export function isEntrySearchEmpty(search: EntrySearch): boolean {
  return (
    search.query === EMPTY.query &&
    search.kind === EMPTY.kind &&
    search.hint === EMPTY.hint
  );
}

// The query string Go and the page both read, without the leading "?".
export function entrySearchQuery(search: EntrySearch): string {
  const params = new URLSearchParams();
  if (search.query) params.set("q", search.query);
  if (search.kind) params.set("kind", search.kind);
  if (search.hint) params.set("hint", search.hint);
  return params.toString();
}
