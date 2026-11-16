import type { PrismaClient } from "../../generated/prisma/client";
import type {
  VocabularyEntry,
  VocabularyInput,
} from "../../domain/vocabulary/vocabulary-entry";
import { newId } from "./new-id";

const LANGUAGE = "zh";
const REVIEW_KIND = "vocabulary";
const LIST_LIMIT = 1000;

export class VocabularyNotFoundError extends Error {
  override name = "VocabularyNotFoundError";
}
export class VocabularyExistsError extends Error {
  override name = "VocabularyExistsError";
}

// What to do with a save, given who owns the row already stored under the id
// (null when there is none).
export function decideSave(
  existingOwnerId: string | null,
  ownerId: string,
): "create" | "update" | "not-found" {
  if (existingOwnerId === null) return "create";
  return existingOwnerId === ownerId ? "update" : "not-found";
}

// Which unique constraint a Prisma P2002 error broke: the owner's word, the
// id (primary key), or another one; null when it is not a P2002. The shape of
// meta varies with the driver adapter, so every place a name can sit is read.
export function uniqueViolationOn(
  error: unknown,
): "word" | "id" | "other" | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code !== "P2002") return null;
  const tokens: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") tokens.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === "object" && value !== null) {
      const { fields, name, index } = value as Record<string, unknown>;
      collect(fields);
      collect(name);
      collect(index);
    }
  };
  const m = (meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: unknown } };
  };
  collect(m.target);
  collect(m.driverAdapterError?.cause?.constraint);
  if (tokens.some((t) => t === "word" || t.endsWith("_word_key")))
    return "word";
  if (tokens.some((t) => t === "id" || t.endsWith("_pkey"))) return "id";
  return "other";
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
      // A retried or doubled submit can lose the race to create the same id;
      // the second pass then sees the row and edits it (or finds it is not
      // the owner's), so a client retry applies once.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.saveOnce(ownerId, input, at);
        } catch (error) {
          const kind = uniqueViolationOn(error);
          if (kind === "id" && attempt === 0) continue;
          if (kind === "word") throw new VocabularyExistsError();
          throw error;
        }
      }
    },

    async saveOnce(
      ownerId: string,
      input: VocabularyInput,
      at: Date,
    ): Promise<VocabularyEntry> {
      {
        const row = await db().$transaction(async (tx) => {
          const existing = await tx.vocabularyEntry.findUnique({
            where: { id: input.id },
            select: { ownerId: true },
          });
          const decision = decideSave(existing?.ownerId ?? null, ownerId);
          if (decision === "not-found") throw new VocabularyNotFoundError();
          if (decision === "update") {
            // Scoped by owner: the row may have been deleted or recreated
            // by someone else since the check above.
            const { count } = await tx.vocabularyEntry.updateMany({
              where: { id: input.id, ownerId },
              data: {
                pinyin: input.pinyin,
                meaning: input.meaning,
                updatedAt: at,
              },
            });
            if (count === 0) throw new VocabularyNotFoundError();
            return tx.vocabularyEntry.findUniqueOrThrow({
              where: { id: input.id },
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
