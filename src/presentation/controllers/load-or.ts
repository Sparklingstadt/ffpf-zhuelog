import { GoApiError } from "@/infrastructure/go-api/client";

// Loads part of a page from Go. When Go fails, the page shows `fallback`
// (an empty list, or null to leave a card out) and the failure is logged
// under `code` with Go's status and error code only. Anything else,
// including Next's redirect to /signin, is rethrown.
export async function loadOr<T, F>(
  code: string,
  load: () => Promise<T>,
  fallback: F,
): Promise<T | F> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof GoApiError)) throw error;
    console.error(code, error.status, error.code);
    return fallback;
  }
}
