import { parse } from "csv-parse/sync";

import type { CsvLearningParser } from "@/application/learning/ports/csv-learning-parser";
import type { LearningEntryDraft } from "@/domain/learning/entities/learning-entry";

const MAX_ROWS = 1_000;
const normalizeHeader = (value: string) => value.trim().replaceAll(" ", "").toLowerCase();

function isHeader(row: string[]) {
  if (row.length < 3) return false;
  const [first, second, third] = row.map(normalizeHeader);
  return (
    ["最初の文", "原文", "original"].includes(first) &&
    ["添削後の文", "添削文", "corrected"].includes(second) &&
    ["ピン音", "拼音", "pinyin"].includes(third)
  );
}

export class CsvParseLearningParser implements CsvLearningParser {
  parse(source: string): LearningEntryDraft[] {
    let records: string[][];
    try {
      records = parse(source, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as string[][];
    } catch {
      throw new Error("CSVの形式を確認してください。引用符が閉じていない可能性があります。");
    }

    if (records.length === 0) throw new Error("CSVにデータ行がありません。");
    const headerOffset = isHeader(records[0]) ? 1 : 0;
    const dataRows = records.slice(headerOffset);
    if (dataRows.length === 0) throw new Error("CSVにデータ行がありません。");
    if (dataRows.length > MAX_ROWS) {
      throw new Error(`一度にインポートできるのは${MAX_ROWS}件までです。`);
    }

    return dataRows.map((row, index) => {
      const csvLine = index + headerOffset + 1;
      if (row.length < 3) throw new Error(`${csvLine}行目は3列未満です。`);
      const [originalText, correctedText, pinyin, ...hintColumns] = row.map((cell) => cell.trim());
      if (!originalText || !correctedText || !pinyin) {
        throw new Error(`${csvLine}行目の「最初の文」「添削後の文」「ピン音」は必須です。`);
      }
      return {
        originalText,
        correctedText,
        pinyin,
        hints: hintColumns.filter(Boolean),
      };
    });
  }
}
