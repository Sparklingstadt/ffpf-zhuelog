import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { AiUsageTotal } from "../../domain/ai-usage/monthly-usage";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";
import { IS_MEMBER_USER } from "./member-users";
import { newId } from "./new-id";

// Records one OpenAI call at `now`.
export async function recordAiUsage(
  db: () => PrismaClient,
  entry: OpenAiUsage & { userId: string; feature: string },
  now: Date = new Date(),
): Promise<void> {
  await db().aiUsage.create({
    data: {
      id: newId(),
      userId: entry.userId,
      feature: entry.feature,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      createdAt: now,
    },
  });
}

// Pure: the month's usage as one raw query. Prisma's query API cannot order
// people by a window sum, and sorting in JS could disagree with the
// database's collation. Every user's calls in [from, to) by user, feature
// and model, with the member's name ("" for an admin or a guest); the users
// with the most tokens (input + output) in the range first, ties by userId,
// then each user's rows by feature and model.
export function aiUsageMonthSql(from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`SELECT a."userId" AS "userId",
    CASE WHEN ${IS_MEMBER_USER} THEN u."name" ELSE '' END AS "displayName",
    a."feature" AS "feature", a."model" AS "model",
    count(*) AS "requests", sum(a."inputTokens") AS "inputTokens",
    sum(a."outputTokens") AS "outputTokens"
  FROM "AiUsage" a
  JOIN "user" u ON u."id" = a."userId"
  WHERE a."createdAt" >= ${from} AND a."createdAt" < ${to}
  GROUP BY a."userId", u."name", u."role", u."isAnonymous", a."feature", a."model"
  ORDER BY sum(sum(a."inputTokens" + a."outputTokens")) OVER (PARTITION BY a."userId") DESC,
    a."userId", a."feature", a."model"`;
}

// count and sum come back as bigint.
export type AiUsageTotalRow = {
  userId: string;
  displayName: string;
  feature: string;
  model: string;
  requests: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
};

// Pure: a row as the domain's AiUsageTotal.
export function aiUsageTotalFromRow(row: AiUsageTotalRow): AiUsageTotal {
  return {
    ownerId: row.userId,
    displayName: row.displayName,
    feature: row.feature,
    model: row.model,
    requests: Number(row.requests),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
  };
}

export function createAiUsageStore(db: () => PrismaClient) {
  return {
    // Every user's totals of the calls in [from, to), most tokens first.
    async monthTotals(from: Date, to: Date): Promise<AiUsageTotal[]> {
      const rows = await db().$queryRaw<AiUsageTotalRow[]>(
        aiUsageMonthSql(from, to),
      );
      return rows.map(aiUsageTotalFromRow);
    },
  };
}
