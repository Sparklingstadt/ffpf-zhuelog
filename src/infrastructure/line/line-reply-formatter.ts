import { CsvParseLearningParser } from "../csv/csv-parse-learning-parser";

// Render only at the LINE boundary. The durable CSV and saved learning note
// remain unchanged. Keep this deterministic so retries have identical text.
export function formatLineLearningReply(csv: string): string {
  const entries = new CsvParseLearningParser().parse(csv);
  if (entries.length !== 1) throw new Error("INVALID_LINE_REPLY");
  const entry = entries[0];
  const sections = [
    "添削しました。",
    `【あなたの文】\n${entry.originalText}`,
    `【添削後の文】\n${entry.correctedText}`,
    `【ピン音】\n${entry.pinyin}`,
  ];
  if (entry.hints.length) {
    sections.push(
      `【学習ヒント】\n${entry.hints.map((hint, index) => `${index + 1}. ${hint}`).join("\n\n")}`,
    );
  }
  sections.push("学習ノートに保存しました。");
  const text = sections.join("\n\n");
  // LINE's text-message limit is 5,000 UTF-16 code units. Never truncate notes.
  if (text.length > 5000) throw new Error("LINE_REPLY_TOO_LONG");
  return text;
}
