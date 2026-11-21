import { unstable_rethrow } from "next/navigation";

// Loads part of a page. When the load fails, the page shows `fallback` (an
// empty list, or null to leave a card out) and the failure is logged under
// `code` with the error's name only. Next's own errors (the redirect to
// /signin, notFound) are rethrown.
export async function loadOr<T, F>(
  code: string,
  load: () => Promise<T>,
  fallback: F,
): Promise<T | F> {
  try {
    return await load();
  } catch (error) {
    unstable_rethrow(error);
    console.error(code, errorName(error));
    return fallback;
  }
}

// What is logged of a failure: its name, never its message.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
