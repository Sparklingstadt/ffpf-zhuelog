import { z } from "zod";

// Lowercase only, like the retired Go API's validUUID (z.uuid() alone accepts capitals).
export const lowercaseUuid = z
  .uuid()
  .refine((value) => value === value.toLowerCase());
