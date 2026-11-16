import type { PrismaClient } from "../../generated/prisma/client";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";
import { newId } from "./new-id";

// Records one OpenAI call at `now`, as the Go API's RecordAIUsage does.
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
