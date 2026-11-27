// The nightly demo reset's writes.
//
// It is one transaction so a visitor never sees the demo half emptied, and a
// second reset running at the same time waits on the user row (the
// SELECT ... FOR UPDATE) instead of inserting the seed twice. A missing demo
// user is made with the given loginId as its username and its member mail
// address; a user already there keeps its row. Either way its credential
// account is made, or its password put back, with the hash of DEMO_PASSWORD,
// so the demo button signs in whatever happened during the day.
//
// The same daily run deletes the guests (anonymous users) made more than 24
// hours ago; their sessions go with them by the foreign key.

import { memberEmail } from "../auth/better-auth-rules";
import type { DemoSeed, DemoCardHistory } from "../../domain/demo/demo-seed";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { newId } from "./new-id";

// 5 s to start plus 20 s to run: 25 s in all, under the route's maxDuration
// of 30 s.
export const DEMO_RESET_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 20_000,
};

// Owner-scoped tables the reset empties. ImportBatch and Follow go too:
// batches by the demo's notes, follows in both directions.
export const DEMO_OWNED_TABLES: readonly string[] = [
  "LearningEntry",
  "ReviewItem",
  "ReviewLog",
  "VocabularyEntry",
  "ChatConversation",
  "QuickQuestion",
  "PrepositionPracticeRecord",
  "ComplementPracticeRecord",
  "LineLink",
  "LineLinkCode",
  "LineMessage",
];

// Owner-scoped tables the reset keeps on purpose, with the reason.
export const DEMO_KEPT_TABLES: Readonly<Record<string, string>> = {
  Session: "the demo's sessions survive the nightly reset",
  Account: "the demo's sign-in",
  AiUsage: "the admin's record of OpenAI spend; the demo cannot call OpenAI",
};

// The language of the seed's words and review items: Chinese.
const LANGUAGE = "zh" as const;

type ReviewItemRow = {
  id: string;
  userId: string;
  language: "zh";
  kind: "entry" | "vocabulary";
  targetId: string;
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  remainingSteps: number;
  lastReview: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReviewLogRow = {
  id: string;
  userId: string;
  itemId: string;
  rating: number;
  state: number;
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reviewedAt: Date;
};

type PracticeRow = {
  id: string;
  userId: string;
  questionCount: number;
  firstTryCount: number;
  missCount: number;
  elapsedMs: number;
  questions: object[];
  startedAt: Date;
  createdAt: Date;
};

export type DemoSeedRows = {
  importBatches: {
    id: string;
    fileName: string;
    rowCount: number;
    importedAt: Date;
  }[];
  learningEntries: {
    id: string;
    kind: string;
    originalText: string;
    correctedText: string;
    pinyin: string;
    createdAt: Date;
    userId: string;
    batchId: string;
  }[];
  hints: {
    id: string;
    content: string;
    position: number;
    learningEntryId: string;
  }[];
  vocabularyEntries: {
    id: string;
    userId: string;
    language: "zh";
    word: string;
    pinyin: string;
    meaning: string;
    sourceEntryId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  reviewItems: ReviewItemRow[];
  reviewLogs: ReviewLogRow[];
  conversations: {
    id: string;
    userId: string;
    title: string;
    modelName: string;
    ended: boolean;
    messages: { id: string; role: string; text: string }[];
    createdAt: Date;
    updatedAt: Date;
  }[];
  prepositionRecords: PracticeRow[];
  complementRecords: (PracticeRow & { mode: string })[];
};

// Pure: every row the seed inserts for the user userId. Each note is its own import
// batch named after its time; a review item's updatedAt is its last review
// (or its creation), and each answer's log row holds the card from before
// that answer. Practice counts are taken from the questions.
export function demoSeedRows(
  userId: string,
  seed: DemoSeed,
  newRowId: () => string,
): DemoSeedRows {
  const rows: DemoSeedRows = {
    importBatches: [],
    learningEntries: [],
    hints: [],
    vocabularyEntries: [],
    reviewItems: [],
    reviewLogs: [],
    conversations: [],
    prepositionRecords: [],
    complementRecords: [],
  };

  // One review item with its card, and a log row for each answer.
  const review = (
    kind: "entry" | "vocabulary",
    targetId: string,
    createdAt: Date,
    { card, answers }: DemoCardHistory,
  ) => {
    const itemId = newRowId();
    rows.reviewItems.push({
      id: itemId,
      userId,
      language: LANGUAGE,
      kind,
      targetId,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      remainingSteps: card.remainingSteps,
      lastReview: card.lastReview,
      createdAt,
      updatedAt: card.lastReview ?? createdAt,
    });
    for (const answer of answers) {
      const before = answer.before;
      rows.reviewLogs.push({
        id: newRowId(),
        userId,
        itemId,
        rating: answer.rating,
        state: before.state,
        due: before.due,
        stability: before.stability,
        difficulty: before.difficulty,
        scheduledDays: before.scheduledDays,
        reviewedAt: answer.at,
      });
    }
  };

  // Each note: its batch, the note, its hints and, if any, its review item.
  const noteIds = seed.notes.map((note) => {
    const batchId = newRowId();
    const entryId = newRowId();
    rows.importBatches.push({
      id: batchId,
      fileName: `demo:${note.createdAt.toISOString()}`,
      rowCount: 1,
      importedAt: note.createdAt,
    });
    rows.learningEntries.push({
      id: entryId,
      kind: note.kind,
      originalText: note.originalText,
      correctedText: note.correctedText,
      pinyin: note.pinyin,
      createdAt: note.createdAt,
      userId,
      batchId,
    });
    note.hints.forEach((content, position) =>
      rows.hints.push({
        id: newRowId(),
        content,
        position,
        learningEntryId: entryId,
      }),
    );
    if (note.review) review("entry", entryId, note.createdAt, note.review);
    return entryId;
  });

  for (const word of seed.words) {
    rows.vocabularyEntries.push({
      id: word.id,
      userId,
      language: LANGUAGE,
      word: word.word,
      pinyin: word.pinyin,
      meaning: word.meaning,
      sourceEntryId: noteIds[word.sourceNote] ?? null,
      createdAt: word.createdAt,
      updatedAt: word.createdAt,
    });
    review("vocabulary", word.id, word.createdAt, word.review);
  }

  for (const c of seed.conversations) {
    rows.conversations.push({
      id: c.id,
      userId,
      title: c.title,
      modelName: c.modelName,
      ended: c.ended,
      messages: c.messages.map(({ id, role, text }) => ({ id, role, text })),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
  }

  // One practice round with its counts. A question without an id is stored
  // without the key.
  const practice = (round: DemoSeed["prepositionRecords"][number]) => {
    const questions = round.questions.map(
      ({ id, answer, noun, prompt, misses }) => ({
        ...(id ? { id } : {}),
        answer,
        noun,
        prompt,
        misses,
      }),
    );
    return {
      id: round.id,
      userId,
      questionCount: questions.length,
      firstTryCount: questions.filter((q) => q.misses.length === 0).length,
      missCount: questions.reduce((sum, q) => sum + q.misses.length, 0),
      elapsedMs: round.elapsedMs,
      questions,
      startedAt: round.startedAt,
      createdAt: round.createdAt,
    };
  };
  for (const round of seed.prepositionRecords)
    rows.prepositionRecords.push(practice(round));
  for (const round of seed.complementRecords)
    rows.complementRecords.push({ ...practice(round), mode: round.mode });

  return rows;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

// The guests (users with isAnonymous) made more than 24 hours before now.
export function deleteStaleGuestsSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM "user" WHERE "isAnonymous" = true AND "createdAt" < CAST(${now} AS TIMESTAMP(3)) - INTERVAL '24 hours'`;
}

export function createDemoResetStore(
  db: () => PrismaClient,
  hashPassword: (password: string) => Promise<string>,
  newRowId: () => string = newId,
) {
  return {
    // Makes the demo user if it is missing, sets its credential account's
    // password to the hash of password, deletes everything it owns (but its
    // sessions, its account and its AI usage) and inserts the seed. The demo
    // user's id.
    async reset(
      loginId: string,
      password: string,
      seed: DemoSeed,
      now: Date,
    ): Promise<string> {
      const at = new Date(Math.trunc(now.getTime()));
      // scrypt takes a while: outside the transaction.
      const passwordHash = await hashPassword(password);
      return db().$transaction(async (tx) => {
        // A concurrent reset waits on the row (or the unique key) here.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "user" ("id", "name", "email", "emailVerified", "username", "displayUsername", "isAnonymous", "role", "banned", "createdAt", "updatedAt")
          VALUES (${newRowId()}, ${seed.displayName}, ${memberEmail(loginId)}, false, ${loginId}, ${loginId}, false, 'user', false, CAST(${at} AS TIMESTAMP(3)), CAST(${at} AS TIMESTAMP(3)))
          ON CONFLICT ("username") DO NOTHING`);
        const users = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "user" WHERE "username" = ${loginId} FOR UPDATE`);
        if (users.length === 0)
          throw new Error("demo reset: the demo user is missing");
        const userId = users[0].id;
        const where = { where: { userId } };

        // The credential account, made if it is missing (a user made by
        // someone else, or an account deleted), with DEMO_PASSWORD. The row
        // lock above keeps two resets from both inserting it.
        await tx.$executeRaw(Prisma.sql`
          WITH "updated" AS (
            UPDATE "account" SET "password" = ${passwordHash}, "updatedAt" = CAST(${at} AS TIMESTAMP(3))
            WHERE "userId" = ${userId} AND "providerId" = 'credential'
            RETURNING "id")
          INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
          SELECT ${newRowId()}, ${userId}, 'credential', ${userId}, ${passwordHash}, CAST(${at} AS TIMESTAMP(3)), CAST(${at} AS TIMESTAMP(3))
          WHERE NOT EXISTS (SELECT 1 FROM "updated")`);

        // Each batch belongs to one owner; deleting it deletes its notes and
        // their hints.
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM "ImportBatch" WHERE "id" IN (SELECT "batchId" FROM "LearningEntry" WHERE "userId" = ${userId})`);
        // DEMO_OWNED_TABLES, in its order.
        await tx.learningEntry.deleteMany(where);
        await tx.reviewItem.deleteMany(where);
        await tx.reviewLog.deleteMany(where);
        await tx.vocabularyEntry.deleteMany(where);
        await tx.chatConversation.deleteMany(where);
        await tx.quickQuestion.deleteMany(where);
        await tx.prepositionPracticeRecord.deleteMany(where);
        await tx.complementPracticeRecord.deleteMany(where);
        await tx.lineLink.deleteMany(where);
        await tx.lineLinkCode.deleteMany(where);
        await tx.lineMessage.deleteMany(where);
        await tx.follow.deleteMany({
          where: { OR: [{ followerId: userId }, { followeeId: userId }] },
        });

        const rows = demoSeedRows(userId, seed, newRowId);
        // Parents before children.
        if (rows.importBatches.length > 0)
          await tx.importBatch.createMany({ data: rows.importBatches });
        if (rows.learningEntries.length > 0)
          await tx.learningEntry.createMany({ data: rows.learningEntries });
        if (rows.hints.length > 0)
          await tx.hint.createMany({ data: rows.hints });
        if (rows.vocabularyEntries.length > 0)
          await tx.vocabularyEntry.createMany({
            data: rows.vocabularyEntries,
          });
        if (rows.reviewItems.length > 0)
          await tx.reviewItem.createMany({ data: rows.reviewItems });
        if (rows.reviewLogs.length > 0)
          await tx.reviewLog.createMany({ data: rows.reviewLogs });
        if (rows.conversations.length > 0)
          await tx.chatConversation.createMany({
            data: rows.conversations.map((c) => ({
              ...c,
              messages: json(c.messages),
            })),
          });
        if (rows.prepositionRecords.length > 0)
          await tx.prepositionPracticeRecord.createMany({
            data: rows.prepositionRecords.map((r) => ({
              ...r,
              questions: json(r.questions),
            })),
          });
        if (rows.complementRecords.length > 0)
          await tx.complementPracticeRecord.createMany({
            data: rows.complementRecords.map((r) => ({
              ...r,
              questions: json(r.questions),
            })),
          });
        return userId;
      }, DEMO_RESET_TRANSACTION_OPTIONS);
    },

    // Deletes the guests made more than 24 hours before now (their sessions
    // go with them). The number deleted.
    async deleteStaleGuests(now: Date): Promise<number> {
      return db().$executeRaw(deleteStaleGuestsSql(now));
    },
  };
}
