import type { LearningEntry } from "@/domain/learning/entities/learning-entry";

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
