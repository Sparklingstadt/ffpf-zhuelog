import { z } from "zod";

// Lowercase only (z.uuid() alone accepts capitals).
export const lowercaseUuid = z
  .uuid()
  .refine((value) => value === value.toLowerCase());
