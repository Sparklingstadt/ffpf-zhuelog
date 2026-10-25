import type {
  PrepositionAnswer,
  PrepositionRecord,
  PrepositionRecordSummary,
} from "@/domain/practice/preposition-record";

import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";

type SummaryJson = Omit<PrepositionRecordSummary, "startedAt" | "createdAt"> & {
  startedAt: string;
  createdAt: string;
};
type RecordJson = SummaryJson & { questions: PrepositionAnswer[] };

const toSummary = (json: SummaryJson): PrepositionRecordSummary => ({
  id: json.id,
  questionCount: json.questionCount,
  firstTryCount: json.firstTryCount,
  missCount: json.missCount,
  elapsedMs: json.elapsedMs,
  startedAt: new Date(json.startedAt),
  createdAt: new Date(json.createdAt),
});

const toRecord = (json: RecordJson): PrepositionRecord => ({
  ...toSummary(json),
  questions: json.questions,
});

// Rounds are always the signed-in user's own (the token's owner in Go),
// newest first.
export function createPrepositionRecordGateway(call: GoApiCall = goApiAuthed) {
  const path = (id: string) =>
    `/v1/preposition-records/${encodeURIComponent(id)}`;

  return {
    async list(): Promise<PrepositionRecordSummary[]> {
      const json = await call<{ records: SummaryJson[] }>(
        "/v1/preposition-records",
        { method: "GET" },
      );
      return json.records.map(toSummary);
    },

    async get(id: string): Promise<PrepositionRecord | null> {
      try {
        return toRecord(await call<RecordJson>(path(id), { method: "GET" }));
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },

    // Go counts the misses and sets createdAt; saving the same id again
    // returns the round already saved.
    async save(round: {
      id: string;
      startedAt: Date;
      elapsedMs: number;
      questions: PrepositionAnswer[];
    }): Promise<PrepositionRecord> {
      return toRecord(
        await call<RecordJson>(path(round.id), {
          method: "PUT",
          body: {
            startedAt: round.startedAt.toISOString(),
            elapsedMs: round.elapsedMs,
            questions: round.questions,
          },
        }),
      );
    },
  };
}

export type PrepositionRecordGateway = ReturnType<
  typeof createPrepositionRecordGateway
>;
