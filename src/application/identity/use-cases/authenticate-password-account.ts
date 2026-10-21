import { z } from "zod";
import {
  loginIdSchema,
  MAX_ATTEMPTS_PER_CLIENT,
  MAX_FAILURES_PER_LOGIN,
  THROTTLE_WINDOW_MS,
  type PasswordAccount,
} from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { PasswordHasher } from "../ports/password-hasher";
import type { SignInThrottle } from "../ports/sign-in-throttle";

// Login accepts any non-empty password up to the cap so that accounts keep
// working if the minimum length rule ever changes; it only bounds hashing cost.
const credentialsSchema = z.object({
  loginId: loginIdSchema,
  password: z.string().min(1).max(128),
});

export class AuthenticatePasswordAccount {
  constructor(
    private readonly accounts: PasswordAccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly throttle: SignInThrottle,
  ) {}

  // client is the caller's normalised address. Attempts are throttled per
  // client, so another client's failures never block a member's sign-in.
  async execute(
    input: { loginId: unknown; password: unknown; client: string },
    now = new Date(),
  ): Promise<PasswordAccount | null> {
    // Checked before any hashing: the point is to cap that cost.
    if (
      !(await this.throttle.consume(
        `client:${input.client}`,
        MAX_ATTEMPTS_PER_CLIENT,
        THROTTLE_WINDOW_MS,
        now,
      ))
    )
      return null;

    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) {
      await this.hasher.simulateVerify(
        typeof input.password === "string" ? input.password.slice(0, 128) : "",
      );
      return null;
    }
    const { loginId, password } = parsed.data;

    // Counted whether or not the ID exists, so pausing reveals nothing.
    const loginKey = `login:${input.client}:${loginId}`;
    if (
      !(await this.throttle.consume(
        loginKey,
        MAX_FAILURES_PER_LOGIN,
        THROTTLE_WINDOW_MS,
        now,
      ))
    )
      return null;

    const account = await this.accounts.findByLoginId(loginId);
    // Every remaining failure path spends hashing time, so an unknown ID is
    // indistinguishable from a wrong password by timing.
    if (!account) {
      await this.hasher.simulateVerify(password);
      return null;
    }
    if (!(await this.hasher.verify(password, account.passwordHash)))
      return null;

    await this.throttle.reset(loginKey);
    return account;
  }
}
