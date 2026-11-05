import type { StudyDay } from "@/domain/study-log/study-log";

import { goApiAuthed, type GoApiCall } from "./authed";

// The signed-in user's own study log (the token's owner in Go, or the member
// an admin acts as).
export function createStudyLogGateway(call: GoApiCall = goApiAuthed) {
  return {
    // Each Japan date from `from` to `to` ("YYYY-MM-DD", both included, at
    // most 93 days) that has anything, oldest first.
    async list(from: string, to: string): Promise<StudyDay[]> {
      const query = new URLSearchParams({ from, to });
      const json = await call<{ days: StudyDay[] }>(`/v1/study-log?${query}`, {
        method: "GET",
      });
      return json.days;
    },
  };
}

export type StudyLogGateway = ReturnType<typeof createStudyLogGateway>;
