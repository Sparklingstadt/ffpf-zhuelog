import type { PrismaClient } from "../../generated/prisma/client";
import type { LearningCsvDraft } from "../../domain/learning/learning-csv";
import { newId } from "./new-id";

// Hints per createMany call. Each hint has 4 columns, so a call binds
// 4 x 5,000 = 20,000 parameters, under Postgres's limit of 65,535. The largest
// import (1000 rows x 100 hints = 100,000 hints) is split here instead of
// relying on Prisma to split it.
const HINT_CHUNK = 5_000;

// Transaction limits for the array-form $transaction. Prisma 7's defaults
// (maxWait 2 s, timeout 5 s) are too short for the worst case: 1000 notes and
// 100,000 hints in about 22 statements, possibly after a cold Neon start (Go
// allowed 4 minutes; stage 2 already found 5 s too short in
// learning-note-writes.ts). Kept well below the function's maximum duration.
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 60_000 };

// Pure: the rows one import inserts. Entry i is created at now + i ms so that
// (createdAt, id) order follows the file; hints are numbered from 0.
export function importRows(
  ownerId: string,
  fileName: string,
  drafts: LearningCsvDraft[],
  now: Date,
  id: () => string,
) {
  const batch = {
    id: id(),
    fileName,
    rowCount: drafts.length,
    importedAt: now,
  };
  const entries: {
    id: string;
    kind: "correction";
    originalText: string;
    correctedText: string;
    pinyin: string;
    createdAt: Date;
    ownerId: string;
    batchId: string;
  }[] = [];
  const hints: {
    id: string;
    content: string;
    position: number;
    learningEntryId: string;
  }[] = [];
  drafts.forEach((draft, i) => {
    const entryId = id();
    entries.push({
      id: entryId,
      kind: "correction",
      originalText: draft.originalText,
      correctedText: draft.correctedText,
      pinyin: draft.pinyin,
      createdAt: new Date(now.getTime() + i),
      ownerId,
      batchId: batch.id,
    });
    draft.hints.forEach((content, position) => {
      hints.push({ id: id(), content, position, learningEntryId: entryId });
    });
  });
  return { batch, entries, hints };
}

export function chunks<T>(items: T[], size: number): T[][] {
  if (!(size > 0)) throw new RangeError("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createLearningCsvImport(
  db: () => PrismaClient,
  now: () => Date = () => new Date(),
  id: () => string = newId,
) {
  return {
    // Stores the drafts as one batch in one transaction; returns how many notes.
    async importBatch(
      ownerId: string,
      fileName: string,
      drafts: LearningCsvDraft[],
    ): Promise<number> {
      const rows = importRows(ownerId, fileName, drafts, now(), id);
      const client = db();
      // Array form: one transaction, sent in order (batch, notes, hints).
      await client.$transaction(
        [
          client.importBatch.create({ data: rows.batch }),
          client.learningEntry.createMany({ data: rows.entries }),
          ...chunks(rows.hints, HINT_CHUNK).map((data) =>
            client.hint.createMany({ data }),
          ),
        ],
        TRANSACTION_OPTIONS,
      );
      return rows.entries.length;
    },
  };
}
