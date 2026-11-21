import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";
import { toDate } from "./learning-json";

// A member's LINE link, through the Go API as the signed-in user until LINE
// moves (stage 10).
export function createLineLinkGateway(call: GoApiCall = goApiAuthed) {
  return {
    // Go registers the link routes only when LINE is configured, so a 404
    // means "not available here", not "not linked". The LINE user id never
    // reaches the web: Go answers with the flag only.
    // reviewNotify is the morning review message on LINE; an older Go API
    // does not report it, which reads as off.
    async getLineLink(): Promise<{
      linked: boolean;
      available: boolean;
      reviewNotify: boolean;
    }> {
      try {
        const json = await call<{ linked: boolean; reviewNotify?: boolean }>(
          "/v1/line/link",
          { method: "GET" },
        );
        return {
          linked: json.linked,
          available: true,
          reviewNotify: json.reviewNotify === true,
        };
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404)
          return { linked: false, available: false, reviewNotify: false };
        throw error;
      }
    },

    // Turns the morning review message on or off. false when Go has no such
    // setting for the caller: LINE is not linked, or the API is older (both
    // answer 404).
    async setLineReviewNotify(on: boolean): Promise<boolean> {
      try {
        await call<unknown>("/v1/line/review-notify", {
          method: on ? "PUT" : "DELETE",
        });
        return true;
      } catch (error) {
        if (error instanceof GoApiError && error.status === 404) return false;
        throw error;
      }
    },

    // Each call invalidates the member's previous code.
    async issueLineLinkCode(): Promise<{ code: string; expiresAt: Date }> {
      const json = await call<{ code: string; expiresAt: string }>(
        "/v1/line/link-code",
        { method: "POST" },
      );
      return { code: json.code, expiresAt: toDate(json.expiresAt) };
    },

    // Go answers 204 even when nothing was linked.
    async unlinkLine(): Promise<void> {
      await call<unknown>("/v1/line/link", { method: "DELETE" });
    },
  };
}
