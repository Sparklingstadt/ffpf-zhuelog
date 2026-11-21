import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import {
  FOLLOW_TIMELINE_LIMIT,
  isMemberOwnerId,
  type FollowDirectory,
  type FollowResult,
  type FollowTimelineItem,
} from "../../domain/social/follow";

// The signed-in user has no follows: signed out, a guest, revoked, without
// an owner id, or the demo account (shared by strangers).
export class SocialForbiddenError extends Error {
  override name = "SocialForbiddenError";
}

export type SocialNetworkDeps = {
  currentUser: () => Promise<AuthenticatedUser | null>;
  // Every call names the viewer or follower it reads or writes for.
  store: {
    members(viewerId: string): Promise<FollowDirectory>;
    timeline(viewerId: string, limit: number): Promise<FollowTimelineItem[]>;
    // false: the followee has no account, so nothing was added.
    follow(followerId: string, followeeId: string, now: Date): Promise<boolean>;
    unfollow(followerId: string, followeeId: string): Promise<void>;
  };
  now: () => Date;
};

// Follows, the member list and the shared-notes timeline, always the
// signed-in user's own (the member an admin acts as), never an owner from a
// form. The user is decided first, so a refused user is refused before the
// followee is checked, as Go answered 403 before 400 and 404.
export function createSocialNetwork(deps: SocialNetworkDeps) {
  async function me(): Promise<string> {
    const user = await deps.currentUser();
    if (
      !user ||
      !isMemberRole(user.role) ||
      !user.githubId ||
      user.demo === true
    )
      throw new SocialForbiddenError();
    return user.githubId;
  }

  return {
    async listMembers(): Promise<FollowDirectory> {
      return deps.store.members(await me());
    },

    async listTimeline(): Promise<FollowTimelineItem[]> {
      return deps.store.timeline(await me(), FOLLOW_TIMELINE_LIMIT);
    },

    async follow(followeeId: string): Promise<FollowResult> {
      const followerId = await me();
      if (!isMemberOwnerId(followeeId)) return "not-found";
      if (followeeId === followerId) return "self";
      return (await deps.store.follow(followerId, followeeId, deps.now()))
        ? "followed"
        : "not-found";
    },

    // A malformed id matches no follow, so nothing is removed (the controller
    // refuses it before calling). Your own id is passed on like any other
    // and succeeds, as Go answered 204.
    async unfollow(followeeId: string): Promise<void> {
      const followerId = await me();
      if (!isMemberOwnerId(followeeId)) return;
      await deps.store.unfollow(followerId, followeeId);
    },
  };
}
