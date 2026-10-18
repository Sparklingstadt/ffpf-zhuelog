import { ownerIdForAccount } from "../../../domain/identity/entities/password-account";
import type { PasswordAccountRepository } from "../../../domain/identity/repositories/password-account-repository";
import type { FollowRepository } from "../../../domain/social/repositories/follow-repository";

export type FollowDirectoryMember = {
  ownerId: string;
  displayName: string;
  loginId: string;
  following: boolean;
  followsMe: boolean;
};

export type FollowDirectory = {
  members: FollowDirectoryMember[];
  // Only members who still exist.
  followingCount: number;
  // Administrators who follow the viewer are counted too.
  followerCount: number;
};

export class ListFollowDirectory {
  constructor(
    private readonly follows: FollowRepository,
    private readonly accounts: PasswordAccountRepository,
  ) {}

  async execute(viewerId: string): Promise<FollowDirectory> {
    const [accounts, following, followers] = await Promise.all([
      this.accounts.list(),
      this.follows.listFollowing(viewerId),
      this.follows.listFollowers(viewerId),
    ]);
    const followingIds = new Set(following);
    const followerIds = new Set(followers);
    const members = accounts
      .map((account) => ({
        ownerId: ownerIdForAccount(account.id),
        displayName: account.displayName,
        loginId: account.loginId,
      }))
      .filter((member) => member.ownerId !== viewerId)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
      .map((member) => ({
        ...member,
        following: followingIds.has(member.ownerId),
        followsMe: followerIds.has(member.ownerId),
      }));
    return {
      members,
      followingCount: members.filter((member) => member.following).length,
      followerCount: followers.length,
    };
  }
}
