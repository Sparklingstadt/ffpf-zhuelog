// One-way follows between owner ids. Admins have no account row, so a pair is
// only a pair of strings: the use cases check that a followee is a member.
export interface FollowRepository {
  // Already following is not an error: the pair stays as it was.
  follow(followerId: string, followeeId: string): Promise<void>;
  // Returns false when there was nothing to remove.
  unfollow(followerId: string, followeeId: string): Promise<boolean>;
  listFollowing(followerId: string): Promise<string[]>;
  listFollowers(followeeId: string): Promise<string[]>;
}
