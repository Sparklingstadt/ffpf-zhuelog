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

// What following someone came to. Go: 204, 400 self_follow, 404.
export type FollowResult = "followed" | "self" | "not-found";

// The follow page shows one page of shared notes: the newest 100. Go served
// ?limit=100 and the web never asked for a second page.
export const FOLLOW_TIMELINE_LIMIT = 100;

const MEMBER_OWNER_ID = /^(password|ffpf):[a-z0-9]{1,64}$/;

// A member's owner id, password or FFPF ID. Go: memberOwnerIDPattern.
export function isMemberOwnerId(value: string): boolean {
  return MEMBER_OWNER_ID.test(value);
}
