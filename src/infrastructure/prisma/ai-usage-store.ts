import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { AiUsageTotal } from "../../domain/ai-usage/monthly-usage";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";
import { newId } from "./new-id";

// Records one OpenAI call at `now`, as the retired Go API's RecordAIUsage did.
export async function recordAiUsage(
  db: () => PrismaClient,
  entry: OpenAiUsage & { ownerId: string; feature: string },
  now: Date = new Date(),
): Promise<void> {
  await db().aiUsage.create({
    data: {
      id: newId(),
      ownerId: entry.ownerId,
      feature: entry.feature,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      createdAt: now,
    },
  });
}

// Pure: Go's AIUsageMonth statement (store/ai_usage.go:51-60), run as one
// raw query. Prisma's query API cannot join the usage to the two member
// account tables (there is no relation) nor order people by a window sum, and
// sorting in JS could disagree with the database's collation, which Go's
// order follows. Every owner's calls in [from, to) by owner, feature and
// model, with the member's name ("" for an admin or a deleted account); the
// owners with the most tokens (input + output) in the range first, ties by
// ownerId, then each owner's rows by feature and model. The member prefixes
// are written in the SQL (Go passed them as values; the result is the same).
export function aiUsageMonthSql(from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`SELECT u."ownerId" AS "ownerId",
    coalesce(m."displayName", '') AS "displayName",
    u."feature" AS "feature", u."model" AS "model",
    count(*) AS "requests", sum(u."inputTokens") AS "inputTokens",
    sum(u."outputTokens") AS "outputTokens"
  FROM "AiUsage" u
  LEFT JOIN (SELECT 'password:' || p."id" AS "ownerId", p."displayName" FROM "PasswordAccount" p
             UNION ALL
             SELECT 'ffpf:' || f."id", f."displayName" FROM "FfpfAccount" f) m
         ON m."ownerId" = u."ownerId"
  WHERE u."createdAt" >= ${from} AND u."createdAt" < ${to}
  GROUP BY u."ownerId", m."displayName", u."feature", u."model"
  ORDER BY sum(sum(u."inputTokens" + u."outputTokens")) OVER (PARTITION BY u."ownerId") DESC,
    u."ownerId", u."feature", u."model"`;
}

// count and sum come back as bigint.
export type AiUsageTotalRow = {
  ownerId: string;
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
    ownerId: row.ownerId,
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
    // Every owner's totals of the calls in [from, to), most tokens first.
    async monthTotals(from: Date, to: Date): Promise<AiUsageTotal[]> {
      const rows = await db().$queryRaw<AiUsageTotalRow[]>(
        aiUsageMonthSql(from, to),
      );
      return rows.map(aiUsageTotalFromRow);
    },
  };
}
