// What OpenAI calls used in one Japan month, as the admin reads it: one row
// per person, with the feature and model rows that make it up.

export type AiUsageTotal = {
  ownerId: string;
  // The member's name; "" for an admin, who has no account row.
  displayName: string;
  feature: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

export type AiUsageMonth = {
  // "YYYY-MM" in Japan time.
  month: string;
  totals: AiUsageTotal[];
};

export type AiUsagePerson = {
  ownerId: string;
  name: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  rows: AiUsageTotal[];
};

const FEATURE_LABELS: Record<string, string> = {
  line: "LINE の添削・翻訳",
  chat: "ChatGPT と話す",
  quick_question: "クイック質問",
  vocabulary_draft: "単語帳の下書き",
};

// The Japanese name of a feature; an unknown one is shown as it is.
export function aiUsageFeatureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isAiUsageMonth(value: string): boolean {
  const match = MONTH.exec(value);
  return match !== null && Number(match[1]) >= 2000;
}

// The month before or after "YYYY-MM".
export function shiftAiUsageMonth(month: string, by: -1 | 1): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + by;
  const y = Math.floor(index / 12);
  return `${y}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Groups the totals by person, keeping Go's order (most tokens first).
export function summarizeAiUsage(totals: AiUsageTotal[]): {
  people: AiUsagePerson[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
} {
  const people = new Map<string, AiUsagePerson>();
  for (const row of totals) {
    let person = people.get(row.ownerId);
    if (!person) {
      person = {
        ownerId: row.ownerId,
        name: row.displayName || "管理者",
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        rows: [],
      };
      people.set(row.ownerId, person);
    }
    person.requests += row.requests;
    person.inputTokens += row.inputTokens;
    person.outputTokens += row.outputTokens;
    person.rows.push(row);
  }
  const list = [...people.values()];
  return {
    people: list,
    requests: list.reduce((sum, p) => sum + p.requests, 0),
    inputTokens: list.reduce((sum, p) => sum + p.inputTokens, 0),
    outputTokens: list.reduce((sum, p) => sum + p.outputTokens, 0),
  };
}
