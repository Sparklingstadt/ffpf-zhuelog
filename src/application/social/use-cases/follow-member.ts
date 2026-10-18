import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { FollowRepository } from "../../../domain/social/repositories/follow-repository";

export type FollowResult = "followed" | "self" | "not-found";

const OWNER_PREFIX = "password:";

export class FollowMember {
  constructor(
    private readonly follows: FollowRepository,
    private readonly accounts: PasswordAccountRepository,
  ) {}

  async execute(followerId: string, followeeId: string): Promise<FollowResult> {
    if (followeeId === followerId) return "self";
    if (!followeeId.startsWith(OWNER_PREFIX)) return "not-found";
    const account = await this.accounts.findById(
      followeeId.slice(OWNER_PREFIX.length),
    );
    if (account === null) return "not-found";
    await this.follows.follow(followerId, followeeId);
    return "followed";
  }
}
