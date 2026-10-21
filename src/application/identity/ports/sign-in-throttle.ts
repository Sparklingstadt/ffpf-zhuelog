// Fixed-window attempt counters shared by every server instance.
export interface SignInThrottle {
  // Atomically counts one attempt for key and reports whether the count is
  // still within limit. A window starts at the first attempt and lasts
  // windowMs; the next attempt after it starts a new one at 1.
  consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<boolean>;
  reset(key: string): Promise<void>;
}
