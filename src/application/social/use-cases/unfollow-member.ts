import type { FollowRepository } from "../../../domain/social/repositories/follow-repository";

export class UnfollowMember {
  constructor(private readonly follows: FollowRepository) {}

  execute(followerId: string, followeeId: string) {
    return this.follows.unfollow(followerId, followeeId);
  }
}
