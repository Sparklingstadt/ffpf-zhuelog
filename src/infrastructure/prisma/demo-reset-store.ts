// The nightly demo reset's writes, as Go's store.ResetDemo did them
// (services/api/store/demo.go: ResetDemo, deleteDemoData, insertDemoSeed,
// queueDemoReview; reference §13).
//
// It is one transaction so a visitor never sees the demo half emptied, and a
// second reset running at the same time waits on the account row (the
// SELECT ... FOR UPDATE) instead of inserting the seed twice. The account
// row stays exactly as Go's sign-in read it before stage 11: the same
// loginId, DEMO_PASSWORD_HASH, session version 0 and, when the account is
// already there, no change at all.

import { DEMO_PASSWORD_HASH } from "../../domain/identity/demo-account";
import type { DemoSeed, DemoCardHistory } from "../../domain/demo/demo-seed";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { newId } from "./new-id";

// 5 s to start plus 20 s to run: 25 s in all, Go's demoResetTimeout, and
// under the route's maxDuration of 30 s.
export const DEMO_RESET_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 20_000,
};

// Owner-scoped tables the reset empties (Go: demoOwnedTables with
// LearningEntry and ReviewLog). ImportBatch and Follow go too: batches by
// the demo's notes, follows in both directions.
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

// Owner-scoped tables the reset keeps on purpose, with the reason
// (Go: demoKeptTables in store/review_orphans_test.go).
export const DEMO_KEPT_TABLES: Readonly<Record<string, string>> = {
  Session: "the demo's sessions survive the nightly reset",
  AiUsage: "the admin's record of OpenAI spend; the demo cannot call OpenAI",
};

// Go: entryReviewLanguage.
const LANGUAGE = "zh" as const;

type ReviewItemRow = {
  id: string;
  ownerId: string;
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
  ownerId: string;
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
  ownerId: string;
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
    ownerId: string;
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
    ownerId: string;
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
    ownerId: string;
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

// Pure: every row the seed inserts for owner (Go: insertDemoSeed). Each note
// is its own import batch named after its time; a review item's updatedAt is
// its last review (or its creation), and each answer's log row holds the
// card from before that answer. Practice counts are taken from the
// questions, as Go's demoScore does when it writes.
export function demoSeedRows(
  ownerId: string,
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

  // Go: queueDemoReview.
  const review = (
    kind: "entry" | "vocabulary",
    targetId: string,
    createdAt: Date,
    { card, answers }: DemoCardHistory,
  ) => {
    const itemId = newRowId();
    rows.reviewItems.push({
      id: itemId,
      ownerId,
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
        ownerId,
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

  // Go: queueImportBatch with one draft, then queueHints.
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
      ownerId,
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
      ownerId,
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
      ownerId,
      title: c.title,
      modelName: c.modelName,
      ended: c.ended,
      messages: c.messages.map(({ id, role, text }) => ({ id, role, text })),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    });
  }

  // Go: practiceKind.insert with demoScore; PracticeQuestion's id is
  // `json:"id,omitempty"`.
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
      ownerId,
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

export function createDemoResetStore(
  db: () => PrismaClient,
  newRowId: () => string = newId,
) {
  return {
    // Go: ResetDemo. Makes the account if it is missing, deletes everything
    // its owner has (but its sessions and AI usage) and inserts the seed.
    // The demo account's id.
    async reset(loginId: string, seed: DemoSeed, now: Date): Promise<string> {
      const at = new Date(Math.trunc(now.getTime()));
      return db().$transaction(async (tx) => {
        // A concurrent reset waits on the row (or the unique key) here.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "PasswordAccount" ("id", "loginId", "displayName", "passwordHash", "sessionVersion", "createdAt", "updatedAt")
          VALUES (${newRowId()}, ${loginId}, ${seed.displayName}, ${DEMO_PASSWORD_HASH}, 0, CAST(${at} AS TIMESTAMP(3)), CAST(${at} AS TIMESTAMP(3)))
          ON CONFLICT ("loginId") DO NOTHING`);
        const accounts = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "PasswordAccount" WHERE "loginId" = ${loginId} FOR UPDATE`);
        if (accounts.length === 0)
          throw new Error("demo reset: the demo account is missing");
        const accountId = accounts[0].id;
        const ownerId = `password:${accountId}`;
        const where = { where: { ownerId } };

        // Each batch belongs to one owner; deleting it deletes its notes and
        // their hints.
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM "ImportBatch" WHERE "id" IN (SELECT "batchId" FROM "LearningEntry" WHERE "ownerId" = ${ownerId})`);
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
          where: { OR: [{ followerId: ownerId }, { followeeId: ownerId }] },
        });

        const rows = demoSeedRows(ownerId, seed, newRowId);
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
        return accountId;
      }, DEMO_RESET_TRANSACTION_OPTIONS);
    },
  };
}
