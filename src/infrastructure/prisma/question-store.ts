import type { PrismaClient } from "../../generated/prisma/client";
import {
  QUESTION_ID,
  type QuestionNote,
  type QuestionSummary,
  type SaveQuestionInput,
} from "../../domain/chat/question";

// Pure: the row a checked (trimmed) note is saved as. modelName is the
// server's chat model, never the browser's; createdAt is now.
export function questionNoteRow(
  ownerId: string,
  note: SaveQuestionInput,
  modelName: string,
  now: Date,
): {
  id: string;
  ownerId: string;
  question: string;
  answer: string;
  modelName: string;
  createdAt: Date;
} {
  return {
    id: note.id,
    ownerId,
    question: note.question,
    answer: note.answer,
    modelName,
    createdAt: now,
  };
}

// Newest first; notes saved in the same millisecond by the larger id.
const NEWEST_FIRST = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies {
  createdAt?: "desc";
  id?: "desc";
}[];

// Reads and writes the owner's question notes. Every query names the owner;
// `now` comes from the caller, read once per request.
export function createQuestionStore(db: () => PrismaClient) {
  return {
    // Without the answers.
    async list(ownerId: string, limit: number): Promise<QuestionSummary[]> {
      return db().quickQuestion.findMany({
        where: { ownerId },
        orderBy: NEWEST_FIRST,
        take: limit,
        select: { id: true, question: true, modelName: true, createdAt: true },
      });
    },

    // null: not the owner's note (or not a note id at all).
    async get(ownerId: string, id: string): Promise<QuestionNote | null> {
      if (!QUESTION_ID.test(id)) return null;
      // The table's only unique key is id, so the owner is a plain filter.
      const row = await db().quickQuestion.findFirst({
        where: { id, ownerId },
        select: {
          id: true,
          question: true,
          answer: true,
          modelName: true,
          createdAt: true,
        },
      });
      return row;
    },

    // Saves the note unless its id is taken. true: the note is saved under
    // the id, by this save or by an identical earlier one (which is kept as
    // it was, its modelName and createdAt too). false: the id is taken by
    // another owner or by other content, and nothing changed.
    //
    // Prisma cannot insert and get back the row already under the id in one
    // statement, so this inserts with ON CONFLICT DO NOTHING and reads the
    // row back by id. That is safe because a row is never changed once
    // saved.
    async save(
      ownerId: string,
      note: SaveQuestionInput,
      modelName: string,
      now: Date,
    ): Promise<boolean> {
      await db().quickQuestion.createMany({
        data: [questionNoteRow(ownerId, note, modelName, now)],
        skipDuplicates: true,
      });
      const saved = await db().quickQuestion.findUnique({
        where: { id: note.id },
        select: { ownerId: true, question: true, answer: true },
      });
      return (
        saved !== null &&
        saved.ownerId === ownerId &&
        saved.question === note.question &&
        saved.answer === note.answer
      );
    },
  };
}

export type QuestionStore = ReturnType<typeof createQuestionStore>;
