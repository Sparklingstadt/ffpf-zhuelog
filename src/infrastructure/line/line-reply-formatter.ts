import { CsvParseLearningParser } from "../csv/csv-parse-learning-parser";

// Split only for presentation. Keep punctuation and closing quotes, and do
// not split decimal numbers or dots within words/URLs.
function sentences(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const flush = (end: number) => {
    const part = value.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  };
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") {
      flush(i + 1);
      continue;
    }
    const end =
      /[。！？!?]/u.test(value[i]) ||
      (value[i] === "." &&
        (i + 1 === value.length || /[\s"'”’」』）)]/u.test(value[i + 1])));
    if (!end) continue;
    while (i + 1 < value.length && /[。！？!?．.]/u.test(value[i + 1])) i++;
    while (i + 1 < value.length && /["'”’」』）)]/u.test(value[i + 1])) i++;
    flush(i + 1);
  }
  flush(value.length);
  return parts;
}

function pairedCorrection(correctedText: string, pinyin: string): string {
  const chinese = sentences(correctedText);
  const pronunciation = sentences(pinyin);
  // Legacy CSVs can have different sentence boundaries. Never drop text or
  // guess a one-to-one alignment when the counts differ.
  if (chinese.length !== pronunciation.length)
    return `${correctedText}\n${pinyin}`;
  return chinese
    .map((sentence, index) => `${sentence}\n${pronunciation[index]}`)
    .join("\n");
}

// Render only at the LINE boundary. The durable CSV and saved learning note
// remain unchanged. Keep this deterministic so retries have identical text.
export function formatLineLearningReply(csv: string): string {
  const entries = new CsvParseLearningParser().parse(csv);
  if (entries.length !== 1) throw new Error("INVALID_LINE_REPLY");
  const entry = entries[0];
  const sections = [
    `【元の文】\n${entry.originalText}`,
    `【添削後】\n${pairedCorrection(entry.correctedText, entry.pinyin)}`,
  ];
  if (entry.hints.length) {
    sections.push(
      `【ヒント】\n${entry.hints.map((hint, index) => `${index + 1}. ${hint}`).join("\n")}`,
    );
  }
  const text = sections.join("\n\n");
  // LINE's text-message limit is 5,000 UTF-16 code units. Never truncate notes.
  if (text.length > 5000) throw new Error("LINE_REPLY_TOO_LONG");
  return text;
}
