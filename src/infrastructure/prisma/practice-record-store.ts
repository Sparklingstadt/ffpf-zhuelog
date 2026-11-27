import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type {
  ComplementRecord,
  ComplementRecordSummary,
  ComplementRoundMode,
} from "../../domain/practice/complement-record";
import type {
  ChoiceAnswer,
  PracticeRecord,
  PracticeRecordSummary,
} from "../../domain/practice/practice-record";
import {
  type CheckedRound,
  PRACTICE_RECORD_ID,
  choiceAnswersFrom,
  practiceReviewTargets,
} from "../../domain/practice/practice-round";
import { TRANSACTION_OPTIONS } from "./learning-note-writes";
import { enqueueReviewItems } from "./review-store";

// Pure: the row a checked round is saved as. The counts are the round's
// (counted from its questions when it was checked); createdAt is now.
export function practiceRecordRow(
  userId: string,
  round: CheckedRound,
  now: Date,
): {
  id: string;
  userId: string;
  questionCount: number;
  firstTryCount: number;
  missCount: number;
  elapsedMs: number;
  questions: ChoiceAnswer[];
  startedAt: Date;
  createdAt: Date;
} {
  return {
    id: round.id,
    userId,
    questionCount: round.questionCount,
    firstTryCount: round.firstTryCount,
    missCount: round.missCount,
    elapsedMs: round.elapsedMs,
    questions: round.questions,
    startedAt: round.startedAt,
    createdAt: now,
  };
}

// Every column but the questions, for the lists.
const SUMMARY = {
  id: true,
  questionCount: true,
  firstTryCount: true,
  missCount: true,
  elapsedMs: true,
  startedAt: true,
  createdAt: true,
} as const;

// Newest first; rounds saved in the same millisecond by the larger id.
const NEWEST_FIRST = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies {
  createdAt?: "desc";
  id?: "desc";
}[];

type SummaryRow = PracticeRecordSummary;
type RecordRow = SummaryRow & { questions: Prisma.JsonValue };

function toSummary(row: SummaryRow): PracticeRecordSummary {
  return {
    id: row.id,
    questionCount: row.questionCount,
    firstTryCount: row.firstTryCount,
    missCount: row.missCount,
    elapsedMs: row.elapsedMs,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
  };
}

function toRecord(row: RecordRow): PracticeRecord {
  return { ...toSummary(row), questions: choiceAnswersFrom(row.questions) };
}

// The table's CHECK constraint keeps mode to the round modes.
const modeOf = (row: { mode: string }) => row.mode as ComplementRoundMode;

// Reads and writes the owner's preposition and complement rounds. Every
// query names the owner; `now` comes from the caller, read once per request.
export function createPracticeRecordStore(db: () => PrismaClient) {
  // Saves the row unless its id is taken, reads back the row saved under the
  // id for this owner, and queues that row's misses, in one transaction so a
  // save never half-succeeds. The first save of an id wins: a retry changes nothing
  // and queues the first save's misses again. null: the id is another
  // owner's, and nothing changed or was queued.
  async function save<Row extends RecordRow>(
    userId: string,
    kind: "preposition" | "complement",
    now: Date,
    insert: (tx: Prisma.TransactionClient) => Promise<unknown>,
    read: (tx: Prisma.TransactionClient) => Promise<Row | null>,
  ): Promise<Row | null> {
    return db().$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING on the primary key, whoever owns the row.
      await insert(tx);
      const saved = await read(tx);
      if (!saved) return null;
      await enqueueReviewItems(
        tx,
        userId,
        practiceReviewTargets(kind, choiceAnswersFrom(saved.questions)),
        now,
      );
      return saved;
    }, TRANSACTION_OPTIONS);
  }

  return {
    async listPrepositions(
      userId: string,
      limit: number,
    ): Promise<PracticeRecordSummary[]> {
      const rows = await db().prepositionPracticeRecord.findMany({
        where: { userId },
        orderBy: NEWEST_FIRST,
        take: limit,
        select: SUMMARY,
      });
      return rows.map(toSummary);
    },

    async listComplements(
      userId: string,
      limit: number,
    ): Promise<ComplementRecordSummary[]> {
      const rows = await db().complementPracticeRecord.findMany({
        where: { userId },
        orderBy: NEWEST_FIRST,
        take: limit,
        select: { ...SUMMARY, mode: true },
      });
      return rows.map((row) => ({ ...toSummary(row), mode: modeOf(row) }));
    },

    // null: not the owner's round (or not a round id at all).
    async getPreposition(
      userId: string,
      id: string,
    ): Promise<PracticeRecord | null> {
      if (!PRACTICE_RECORD_ID.test(id)) return null;
      const row = await db().prepositionPracticeRecord.findUnique({
        where: { id_userId: { id, userId } },
      });
      return row ? toRecord(row) : null;
    },

    async getComplement(
      userId: string,
      id: string,
    ): Promise<ComplementRecord | null> {
      if (!PRACTICE_RECORD_ID.test(id)) return null;
      const row = await db().complementPracticeRecord.findUnique({
        where: { id_userId: { id, userId } },
      });
      return row ? { ...toRecord(row), mode: modeOf(row) } : null;
    },

    // Saves the round unless the id is taken, then queues the saved round's
    // misses, in one transaction. null: the id is another owner's (nothing
    // changed, nothing queued).
    async savePreposition(
      userId: string,
      round: CheckedRound,
      now: Date,
    ): Promise<PracticeRecord | null> {
      const row = practiceRecordRow(userId, round, now);
      const saved = await save(
        userId,
        "preposition",
        now,
        (tx) =>
          tx.prepositionPracticeRecord.createMany({
            data: [row],
            skipDuplicates: true,
          }),
        (tx) =>
          tx.prepositionPracticeRecord.findUnique({
            where: { id_userId: { id: round.id, userId } },
          }),
      );
      return saved ? toRecord(saved) : null;
    },

    async saveComplement(
      userId: string,
      round: CheckedRound & { mode: ComplementRoundMode },
      now: Date,
    ): Promise<ComplementRecord | null> {
      const row = {
        ...practiceRecordRow(userId, round, now),
        mode: round.mode,
      };
      const saved = await save(
        userId,
        "complement",
        now,
        (tx) =>
          tx.complementPracticeRecord.createMany({
            data: [row],
            skipDuplicates: true,
          }),
        (tx) =>
          tx.complementPracticeRecord.findUnique({
            where: { id_userId: { id: round.id, userId } },
          }),
      );
      return saved ? { ...toRecord(saved), mode: modeOf(saved) } : null;
    },
  };
}

export type PracticeRecordStore = ReturnType<typeof createPracticeRecordStore>;
