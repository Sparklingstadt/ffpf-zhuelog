// One data row of an imported learning-note CSV, checked and trimmed.
export type LearningCsvDraft = {
  originalText: string;
  correctedText: string;
  pinyin: string;
  // The non-empty hint columns, in column order.
  hints: string[];
};

// A problem with the uploaded CSV. The message is meant for the user and is
// shown as it is.
export class CsvValidationError extends Error {
  override name = "CsvValidationError";
}

export const CSV_MESSAGES = {
  noFile: "CSVファイルを選択してください。",
  tooLarge: "ファイルは4MB以下にしてください。",
  notCsv: "拡張子が.csvのファイルを選択してください。",
  format:
    "CSVの形式を確認してください。引用符が閉じていないか、1行が長すぎる可能性があります。",
  noData: "CSVにデータ行がありません。",
  tooManyRows: "一度にインポートできるのは1000件までです。",
  tooFewColumns: (line: number) => `${line}行目は3列未満です。`,
  overLimit: (line: number) =>
    `${line}行目は上限（各項目1万文字・ヒント100列）を超えています。`,
  required: (line: number) =>
    `${line}行目の「最初の文」「添削後の文」「ピンイン」は必須です。`,
} as const;
