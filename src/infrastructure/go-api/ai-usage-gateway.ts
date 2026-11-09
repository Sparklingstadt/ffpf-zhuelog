import type { AiUsageMonth } from "@/domain/ai-usage/monthly-usage";

import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";

// The admin's monthly summary of OpenAI usage.
export function createAiUsageGateway(call: GoApiCall = goApiAuthed) {
  return {
    // month is "YYYY-MM" (Japan time); without it, Go answers for this
    // month. null when the Go API has no summary (an older deployment, or no
    // database), which answers 404.
    async month(month?: string): Promise<AiUsageMonth | null> {
      const query = month ? `?${new URLSearchParams({ month })}` : "";
      try {
        return await call<AiUsageMonth>(`/v1/admin/ai-usage${query}`, {
          method: "GET",
        });
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

export type AiUsageGateway = ReturnType<typeof createAiUsageGateway>;
