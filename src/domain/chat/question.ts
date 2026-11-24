export type QuestionSummary = {
  id: string;
  question: string;
  modelName: string;
  createdAt: Date;
};
export type QuestionNote = QuestionSummary & { answer: string };
export type SaveQuestionInput = {
  id: string;
  question: string;
  answer: string;
};
export const MAX_QUESTION_CHARS = 4000;
// The longest answer, in code points, that the web keeps in a question note;
// a longer one is refused when saved.
export const MAX_ANSWER_CHARS = 20_000;
export const QUESTION_LIST_LIMIT = 100;
// A lower-case UUID, as the browser's crypto.randomUUID() makes them.
export const QUESTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Lengths are counted in code points, so a character outside the BMP is one.
function chars(text: string): number {
  return [...text].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

// The question of a POST /api/quick-question body, untrimmed, or null when
// the body is refused with a 400: unknown keys refused, exactly one message,
// role and length rules.
export function quickQuestionText(body: unknown): string | null {
  // Unknown keys are refused at every level.
  if (!isRecord(body) || !hasOnlyKeys(body, ["messages"])) return null;
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length !== 1) return null;
  const message: unknown = messages[0];
  if (!isRecord(message) || !hasOnlyKeys(message, ["role", "text"]))
    return null;
  const { role, text } = message;
  if (role !== "user" || typeof text !== "string") return null;
  if (text.trim() === "" || chars(text) > MAX_QUESTION_CHARS) return null;
  return text;
}

// The note as it is saved (trimmed), or null when it must be refused.
export function checkQuestionNote(
  input: SaveQuestionInput,
): SaveQuestionInput | null {
  if (!QUESTION_ID.test(input.id)) return null;
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (question === "" || chars(question) > MAX_QUESTION_CHARS) return null;
  if (answer === "" || chars(answer) > MAX_ANSWER_CHARS) return null;
  return { id: input.id, question, answer };
}
