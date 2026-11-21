// Go: aiusage recordTimeout. A usage write may take at most this long.
export const RECORD_TIMEOUT_MS = 5_000;

class TimeoutError extends Error {
  override name = "TimeoutError";
}

// Runs a usage write, giving up after ms. A failed or late write is only
// logged (by a fixed code and the error's name), so it never changes or
// holds up what the user gets. Never throws. The timer is cleared once the
// write settles.
export async function recordWithin(
  write: () => Promise<void>,
  ms: number,
  log: (code: string, name: string) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  try {
    await Promise.race([write(), late]);
  } catch (error) {
    log("AI_USAGE_NOT_RECORDED", errorName(error));
  } finally {
    clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
