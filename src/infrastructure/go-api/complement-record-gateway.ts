import type { ComplementMode } from "@/domain/practice/complement-quiz";
import type {
  ComplementAnswer,
  ComplementRecord,
  ComplementRecordSummary,
} from "@/domain/practice/complement-record";

import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";

type SummaryJson = Omit<ComplementRecordSummary, "startedAt" | "createdAt"> & {
  startedAt: string;
  createdAt: string;
};
type RecordJson = SummaryJson & { questions: ComplementAnswer[] };

const toSummary = (json: SummaryJson): ComplementRecordSummary => ({
  id: json.id,
  mode: json.mode,
  questionCount: json.questionCount,
  firstTryCount: json.firstTryCount,
  missCount: json.missCount,
  elapsedMs: json.elapsedMs,
  startedAt: new Date(json.startedAt),
  createdAt: new Date(json.createdAt),
});

const toRecord = (json: RecordJson): ComplementRecord => ({
  ...toSummary(json),
  questions: json.questions,
});

// Rounds are always the signed-in user's own (the token's owner in Go),
// newest first.
export function createComplementRecordGateway(call: GoApiCall = goApiAuthed) {
  const path = (id: string) =>
    `/v1/complement-records/${encodeURIComponent(id)}`;

  return {
    async list(): Promise<ComplementRecordSummary[]> {
      const json = await call<{ records: SummaryJson[] }>(
        "/v1/complement-records",
        { method: "GET" },
      );
      return json.records.map(toSummary);
    },

    async get(id: string): Promise<ComplementRecord | null> {
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
      mode: ComplementMode;
      startedAt: Date;
      elapsedMs: number;
      questions: ComplementAnswer[];
    }): Promise<ComplementRecord> {
      return toRecord(
        await call<RecordJson>(path(round.id), {
          method: "PUT",
          body: {
            mode: round.mode,
            startedAt: round.startedAt.toISOString(),
            elapsedMs: round.elapsedMs,
            questions: round.questions,
          },
        }),
      );
    },
  };
}

export type ComplementRecordGateway = ReturnType<
  typeof createComplementRecordGateway
>;
