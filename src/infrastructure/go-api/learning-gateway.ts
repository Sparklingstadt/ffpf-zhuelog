import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";

// The part of learning notes that still goes through Go: the review queue.
// Reads, the trash, sharing and the CSV import are in
// src/application/learning/learning-notes.ts.
export function createLearningGateway(call: GoApiCall = goApiAuthed) {
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
