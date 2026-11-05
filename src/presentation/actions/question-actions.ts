"use server";

import { z } from "zod";
import { questionNotes } from "@/composition/question-container";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { isMemberRole } from "@/domain/identity/entities/authenticated-user";
import {
  MAX_QUESTION_CHARS,
  type SaveQuestionInput,
} from "@/domain/chat/question";
import { GoApiError } from "@/infrastructure/go-api/client";

const inputSchema = z.object({
  id: z.uuid(),
  question: z
    .string()
    .trim()
    .min(1)
    .refine((s) => [...s].length <= MAX_QUESTION_CHARS),
  answer: z
    .string()
    .trim()
    .min(1)
    .refine((s) => [...s].length <= 20000),
});

export async function saveQuestionAction(
  input: SaveQuestionInput,
): Promise<{ ok: boolean }> {
  const user = await getCurrentViewerUser();
  if (!user || !isMemberRole(user.role)) return { ok: false };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  try {
    await questionNotes.save(parsed.data);
    // Dynamic note pages read fresh data; avoid replacing the live answer.
    return { ok: true };
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    return { ok: false };
  }
}
