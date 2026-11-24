import { z } from "zod";

// One answered question of a practice round. The shape only; the practice
// records check the limits. The id is left out by anything that does not
// send it; absent or null misses are none.
export const practiceAnswerInput = z.object({
  id: z.string().optional(),
  answer: z.string(),
  noun: z.string(),
  prompt: z.string(),
  misses: z
    .array(z.string())
    .nullish()
    .transform((misses) => misses ?? []),
});
