import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

import { goApiAuthed, type GoApiCall } from "./authed";
import { GoApiError } from "./client";
import { toLearningEntry, type GoEntryJson } from "./learning-json";

// No login ID: it is half of a member's credentials, so other members only
// see display names.
export type FollowDirectoryMember = {
  ownerId: string;
  displayName: string;
  following: boolean;
  followsMe: boolean;
};

export type FollowDirectory = {
  members: FollowDirectoryMember[];
  followingCount: number;
  followerCount: number;
};

export type SharedLearningEntry = LearningEntry & { ownerId: string };

export type FollowTimelineItem = {
  entry: SharedLearningEntry;
  ownerName: string;
};

export type FollowResult = "followed" | "self" | "not-found";

type TimelineJson = {
  items: { entry: GoEntryJson; ownerId: string; ownerName: string }[];
};

// The follow page shows one page of shared notes.
const FOLLOW_TIMELINE_LIMIT = 100;

// Follows and the timeline are always the signed-in user's own (the token's
// owner in Go). Members and notes come in Go's order.
export function createSocialGateway(call: GoApiCall = goApiAuthed) {
  const followPath = (ownerId: string) =>
    `/v1/follows/${encodeURIComponent(ownerId)}`;

  return {
    async listMembers(): Promise<FollowDirectory> {
      const json = await call<FollowDirectory>("/v1/members", {
        method: "GET",
      });
      return {
        members: json.members.map(
          ({ ownerId, displayName, following, followsMe }) => ({
            ownerId,
            displayName,
            following,
            followsMe,
          }),
        ),
        followingCount: json.followingCount,
        followerCount: json.followerCount,
      };
    },

    async listTimeline(): Promise<FollowTimelineItem[]> {
      const json = await call<TimelineJson>(
        `/v1/timeline?limit=${FOLLOW_TIMELINE_LIMIT}`,
        { method: "GET" },
      );
      return json.items.map(({ entry, ownerId, ownerName }) => ({
        entry: { ...toLearningEntry(entry), ownerId },
        ownerName,
      }));
    },

    // Go answers 404 when the followee is not a member and 400 self_follow
    // when it is the user.
    async follow(ownerId: string): Promise<FollowResult> {
      try {
        await call<unknown>(followPath(ownerId), { method: "PUT" });
        return "followed";
      } catch (error) {
        if (error instanceof GoApiError) {
          if (error.status === 404) return "not-found";
          if (error.status === 400 && error.code === "self_follow")
            return "self";
        }
        throw error;
      }
    },

    // Not following is not an error in Go either.
    async unfollow(ownerId: string): Promise<void> {
      await call<unknown>(followPath(ownerId), { method: "DELETE" });
    },
  };
}

export type SocialGateway = ReturnType<typeof createSocialGateway>;
