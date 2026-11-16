import { unstable_rethrow } from "next/navigation";

import { GoApiError } from "@/infrastructure/go-api/client";

// Loads part of a page. When the load fails, the page shows `fallback` (an
// empty list, or null to leave a card out) and the failure is logged under
// `code`: Go's status and error code for a Go failure, otherwise only the
// error's name. Next's own errors (the redirect to /signin, notFound) are
// rethrown.
export async function loadOr<T, F>(
  code: string,
  load: () => Promise<T>,
  fallback: F,
): Promise<T | F> {
  try {
    return await load();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof GoApiError)
      console.error(code, error.status, error.code);
    else console.error(code, errorName(error));
    return fallback;
  }
}

// What is logged of a failure that is not Go's: its name, never its message.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
