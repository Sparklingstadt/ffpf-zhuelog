import { z } from "zod";

// One answered question of a practice round. The shape only; Go checks the
// limits. The id is left out by anything that does not send it.
export const practiceAnswerInput = z.object({
  id: z.string().optional(),
  answer: z.string(),
  noun: z.string(),
  prompt: z.string(),
  misses: z.array(z.string()),
});
