import type { PrismaClient } from "../../generated/prisma/client";
import type {
  VocabularyEntry,
  VocabularyInput,
} from "../../domain/vocabulary/vocabulary-entry";
import { newId } from "./new-id";

const LANGUAGE = "zh";
const REVIEW_KIND = "vocabulary";
const LIST_LIMIT = 1000;

export class VocabularyNotFoundError extends Error {}
export class VocabularyExistsError extends Error {}

// What to do with a save, given who owns the row already stored under the id
// (null when there is none).
export function decideSave(
  existingOwnerId: string | null,
  ownerId: string,
): "create" | "update" | "not-found" {
  if (existingOwnerId === null) return "create";
  return existingOwnerId === ownerId ? "update" : "not-found";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

type Row = {
  id: string;
  language: string;
  word: string;
  pinyin: string;
  meaning: string;
  sourceEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toEntry(row: Row, nextReview: Date | null): VocabularyEntry {
  return {
    id: row.id,
    language: row.language,
    word: row.word,
    pinyin: row.pinyin,
    meaning: row.meaning,
    sourceEntryId: row.sourceEntryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    nextReview,
  };
}

// Reads and writes the vocabulary book the way the Go API's store does.
export function createVocabularyStore(
  db: () => PrismaClient,
  now: () => Date = () => new Date(),
) {
  return {
    // Newest first, with when each word's review card is next due.
    async list(ownerId: string): Promise<VocabularyEntry[]> {
      const client = db();
      const rows = await client.vocabularyEntry.findMany({
        where: { ownerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIST_LIMIT,
      });
      if (rows.length === 0) return [];
      const cards = await client.reviewItem.findMany({
        where: {
          ownerId,
          language: LANGUAGE,
          kind: REVIEW_KIND,
          targetId: { in: rows.map((row) => row.id) },
        },
        select: { targetId: true, due: true },
      });
      const due = new Map(cards.map((card) => [card.targetId, card.due]));
      return rows.map((row) => toEntry(row, due.get(row.id) ?? null));
    },

    // Adds the word (and queues its card, due now) or, when the id is the
    // owner's, edits only its reading and meaning.
    async save(
      ownerId: string,
      input: VocabularyInput,
    ): Promise<VocabularyEntry> {
      const at = now();
      try {
        const row = await db().$transaction(async (tx) => {
          const existing = await tx.vocabularyEntry.findUnique({
            where: { id: input.id },
            select: { ownerId: true },
          });
          const decision = decideSave(existing?.ownerId ?? null, ownerId);
          if (decision === "not-found") throw new VocabularyNotFoundError();
          if (decision === "update") {
            return tx.vocabularyEntry.update({
              where: { id: input.id },
              data: {
                pinyin: input.pinyin,
                meaning: input.meaning,
                updatedAt: at,
              },
            });
          }
          const created = await tx.vocabularyEntry.create({
            data: {
              id: input.id,
              ownerId,
              language: LANGUAGE,
              word: input.word,
              pinyin: input.pinyin,
              meaning: input.meaning,
              sourceEntryId: input.sourceEntryId || null,
              createdAt: at,
              updatedAt: at,
            },
          });
          await tx.reviewItem.createMany({
            data: [
              {
                id: newId(),
                ownerId,
                language: LANGUAGE,
                kind: REVIEW_KIND,
                targetId: created.id,
                due: at,
                state: 0,
                createdAt: at,
                updatedAt: at,
              },
            ],
            skipDuplicates: true,
          });
          return created;
        });
        return toEntry(row, null);
      } catch (error) {
        if (isUniqueViolation(error)) throw new VocabularyExistsError();
        throw error;
      }
    },

    // Deletes the word and its review card; the card's log goes with it
    // through the schema's cascade.
    async remove(ownerId: string, id: string): Promise<void> {
      await db().$transaction(async (tx) => {
        const { count } = await tx.vocabularyEntry.deleteMany({
          where: { id, ownerId },
        });
        if (count === 0) throw new VocabularyNotFoundError();
        await tx.reviewItem.deleteMany({
          where: { ownerId, kind: REVIEW_KIND, targetId: id },
        });
      });
    },
  };
}
