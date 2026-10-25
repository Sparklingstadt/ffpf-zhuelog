import { getTokyoDateParts } from "@/domain/calendar/value-objects/log-date";
import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

// The CSV the import accepts back: the header row it recognises, then the
// original, corrected and pinyin columns and one column per hint. Every field
// is quoted, so commas and line breaks inside a value stay in one field.
const BASE_HEADER = ["最初の文", "添削後の文", "ピン音"];

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function row(values: string[]) {
  return `${values.map(quote).join(",")}\r\n`;
}

function hintsInOrder(entry: LearningEntry) {
  return [...entry.hints]
    .sort((a, b) => a.position - b.position)
    .map((hint) => hint.content);
}

export function toLearningCsv(entries: LearningEntry[]): string {
  const rows = entries.map((entry) => [
    entry.originalText,
    entry.correctedText,
    entry.pinyin,
    ...hintsInOrder(entry),
  ]);
  const hintColumns = Math.max(
    0,
    ...rows.map((values) => values.length - BASE_HEADER.length),
  );
  const header = [
    ...BASE_HEADER,
    ...Array.from({ length: hintColumns }, (_, i) => `ヒント${i + 1}`),
  ];
  return [header, ...rows].map(row).join("");
}

// Named after the Japan date the file was made.
export function learningCsvFileName(now: Date): string {
  const { year, month, day } = getTokyoDateParts(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `xuexilu-${year}-${pad(month)}-${pad(day)}.csv`;
}
