import {
  goApiAuthed,
  goUploadAuthed,
  type GoApiCall,
  type GoUploadCall,
} from "./authed";
import { GoApiError } from "./client";

// The parts of learning notes that still go through Go: the review queue and
// the CSV import. Reads, the trash and sharing are in
// src/application/learning/learning-notes.ts.
export function createLearningGateway(
  call: GoApiCall = goApiAuthed,
  upload: GoUploadCall = goUploadAuthed,
) {
  return {
    // Whether the signed-in user's note is in their review queue; null when
    // the note is not theirs or is in the trash.
    async isInReview(id: string): Promise<boolean | null> {
      try {
        const json = await call<{ inReview: boolean }>(
          `/v1/entries/${encodeURIComponent(id)}/review`,
          { method: "GET" },
        );
        return json.inReview;
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },

    // Go keeps the note's card when it is put in again, and removes the card
    // with its answers when it is taken out. False when Go answers 404: the
    // user has no such live note.
    setInReview(id: string, inReview: boolean): Promise<boolean> {
      return found(
        call<unknown>(`/v1/entries/${encodeURIComponent(id)}/review`, {
          method: inReview ? "PUT" : "DELETE",
        }),
      );
    },

    // Go checks and stores the CSV in the signed-in user's own notes and
    // answers how many notes it added.
    async importCsv(file: File): Promise<number> {
      const form = new FormData();
      form.set("csvFile", file, file.name);
      const json = await upload<{ count: number }>("/v1/imports/csv", form);
      return json.count;
    },
  };
}

async function found(request: Promise<unknown>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch (error) {
    if (error instanceof GoApiError && error.status === 404) return false;
    throw error;
  }
}

export type LearningGateway = ReturnType<typeof createLearningGateway>;
