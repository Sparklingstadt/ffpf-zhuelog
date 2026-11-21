import { parse } from "csv-parse/sync";

import {
  CSV_MESSAGES,
  CsvValidationError,
  type LearningCsvDraft,
} from "@/domain/learning/learning-csv";

export const MAX_CSV_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 1_000;
const MAX_CELL_LENGTH = 10_000;
const MAX_COLUMNS = 3 + 100;
const MAX_FILE_NAME_LENGTH = 255;

const HEADER_NAMES = [
  ["最初の文", "原文", "original"],
  ["添削後の文", "添削文", "corrected"],
  ["ピンイン", "ピン音", "拼音", "pinyin"],
];

const normalizeHeader = (value: string) =>
  value.trim().replaceAll(" ", "").toLowerCase();

function isHeader(row: string[]) {
  return (
    row.length >= 3 &&
    HEADER_NAMES.every((names, i) => names.includes(normalizeHeader(row[i])))
  );
}

// Postgres cannot store NUL.
const hasNul = (value: string) => value.includes("\0");

// The checks made before the file is read, in order; null when it may be read.
export function checkCsvFile(file: {
  name: string;
  size: number;
}): string | null {
  if (file.size === 0) return CSV_MESSAGES.noFile;
  if (file.size > MAX_CSV_FILE_BYTES) return CSV_MESSAGES.tooLarge;
  if (!file.name.toLowerCase().endsWith(".csv")) return CSV_MESSAGES.notCsv;
  return null;
}

// Reads the text of a learning-note CSV (as File.text() decodes it) into one
// draft per data row. Throws CsvValidationError with the message to show.
export function parseLearningCsv(text: string): LearningCsvDraft[] {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 100_000,
      // Enough to tell more than MAX_ROWS data rows after a header.
      to: MAX_ROWS + 2,
    }) as string[][];
  } catch {
    throw new CsvValidationError(CSV_MESSAGES.format);
  }

  if (records.length === 0) throw new CsvValidationError(CSV_MESSAGES.noData);
  const headerOffset = isHeader(records[0]) ? 1 : 0;
  const rows = records.slice(headerOffset);
  if (rows.length === 0) throw new CsvValidationError(CSV_MESSAGES.noData);
  if (rows.length > MAX_ROWS)
    throw new CsvValidationError(CSV_MESSAGES.tooManyRows);

  const drafts = rows.map((row, index) => {
    // Numbered by record, so blank lines and quoted line breaks do not count.
    const line = index + headerOffset + 1;
    if (row.length < 3)
      throw new CsvValidationError(CSV_MESSAGES.tooFewColumns(line));
    if (
      row.length > MAX_COLUMNS ||
      row.some((cell) => cell.length > MAX_CELL_LENGTH)
    )
      throw new CsvValidationError(CSV_MESSAGES.overLimit(line));
    const [originalText, correctedText, pinyin, ...hintColumns] = row.map(
      (cell) => cell.trim(),
    );
    if (!originalText || !correctedText || !pinyin)
      throw new CsvValidationError(CSV_MESSAGES.required(line));
    return {
      originalText,
      correctedText,
      pinyin,
      hints: hintColumns.filter(Boolean),
    };
  });

  // Checked after every row so the row messages above still come first.
  if (
    drafts.some(
      (draft) =>
        hasNul(draft.originalText) ||
        hasNul(draft.correctedText) ||
        hasNul(draft.pinyin) ||
        draft.hints.some(hasNul),
    )
  )
    throw new CsvValidationError(CSV_MESSAGES.format);
  return drafts;
}

// The file name stored with the import batch.
export function importFileName(name: string): string {
  if (hasNul(name)) throw new CsvValidationError(CSV_MESSAGES.format);
  return name.slice(0, MAX_FILE_NAME_LENGTH);
}
