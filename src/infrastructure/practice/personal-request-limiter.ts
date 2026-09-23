import { createHmac, randomBytes } from "node:crypto";
import { PersonalCorrectionError } from "../../domain/practice/personal-correction";

// Best-effort per-process protection, not a distributed quota or billing cap.
// Only key digests and counters are held in volatile memory; never raw keys.
export class PersonalRequestLimiter {
  // This is an ephemeral lookup fingerprint, not a password verifier.
  // A random process-local secret also prevents correlation across instances.
  private readonly fingerprintSecret = randomBytes(32);
  private readonly windows = new Map<
    string,
    { until: number; count: number; active: boolean }
  >();
  private active = 0;

  acquire(apiKey: string, now = Date.now()) {
    for (const [key, value] of this.windows) {
      if (value.until <= now && !value.active) this.windows.delete(key);
    }
    const digest = createHmac("sha256", this.fingerprintSecret)
      .update(apiKey)
      .digest("hex");
    const previous = this.windows.get(digest);
    if (
      this.active >= 16 ||
      previous?.active ||
      (previous && previous.count >= 10) ||
      (!previous && this.windows.size >= 1000)
    ) {
      throw new PersonalCorrectionError("limited");
    }
    const window = previous ?? { until: now + 60_000, count: 0, active: false };
    window.count += 1;
    window.active = true;
    this.windows.set(digest, window);
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      window.active = false;
      this.active -= 1;
    };
  }
}
