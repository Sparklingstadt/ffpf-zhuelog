import type { VocabularyEntry } from "@/domain/vocabulary/vocabulary-entry";

// Lower case without tone marks, so "renzhen" finds "rènzhēn" and "LV" finds
// "lǜ" (ü is written v on keyboards).
function fold(text: string): string {
  return (
    text
      .normalize("NFD")
      // ǖǘǚǜ come apart as u, the diaeresis and the tone mark.
      .replace(/[uU]\u0308/g, "v")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, "")
  );
}

// Whether a word of the book matches what was typed: its word, pinyin or
// meaning contains it. An empty search matches every word.
export function matchesVocabulary(
  entry: Pick<VocabularyEntry, "word" | "pinyin" | "meaning">,
  query: string,
): boolean {
  const wanted = fold(query.normalize("NFC")).replace(/u:/g, "v");
  if (wanted === "") return true;
  return [entry.word, entry.pinyin, entry.meaning].some((field) =>
    fold(field).includes(wanted),
  );
}
