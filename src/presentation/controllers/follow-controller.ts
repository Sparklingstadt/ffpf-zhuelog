import type { AppRole } from "@/domain/identity/entities/authenticated-user";
import { isUserId } from "@/domain/identity/user-id";
import type { FollowResult } from "@/domain/social/follow";
import { z } from "zod";

import {
  actionSuccess,
  actionUnauthorized,
  attemptAction,
  noteIdSchema,
  type ActionState,
} from "@/presentation/controllers/action-state";

type Member = () => Promise<{ userId: string; role: AppRole } | null>;

const notFound: ActionState = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};
const selfFollow: ActionState = {
  status: "error",
  message: "自分はフォローできません。",
};

// A well-formed user id; the store checks that it is a member.
const followeeIdSchema = z.string().refine(isUserId);
const sharedSchema = z.enum(["true", "false"]);

// The follower is always the signed-in user; the form never names one.
export async function handleFollow(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (followerId: string, followeeId: string) => Promise<FollowResult>;
  },
): Promise<ActionState> {
  const user = await dependencies.getMember();
  if (!user) return actionUnauthorized;
  const followerId = user.userId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attemptAction("FOLLOW_FAILED", async () => {
    const result = await dependencies.run(followerId, followeeId.data);
    if (result === "followed") return actionSuccess;
    return result === "self" ? selfFollow : notFound;
  });
}

// Not following any more is what the user asked for, so unfollowing someone
// not followed is a success too.
export async function handleUnfollow(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (followerId: string, followeeId: string) => Promise<void>;
  },
): Promise<ActionState> {
  const user = await dependencies.getMember();
  if (!user) return actionUnauthorized;
  const followerId = user.userId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attemptAction("FOLLOW_FAILED", async () => {
    await dependencies.run(followerId, followeeId.data);
    return actionSuccess;
  });
}

// Only members can be followed, so only members have notes to share. The
// note is always the signed-in member's own: run (learningNotes) decides the
// owner and refuses the demo with LearningForbiddenError.
export async function handleShare(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (id: string, shared: boolean) => Promise<boolean>;
  },
): Promise<ActionState> {
  const user = await dependencies.getMember();
  if (user?.role !== "member") return actionUnauthorized;
  const id = noteIdSchema.safeParse(formData.get("id"));
  const shared = sharedSchema.safeParse(formData.get("shared"));
  if (!id.success || !shared.success) return notFound;
  return attemptAction("SHARE_FAILED", async () =>
    (await dependencies.run(id.data, shared.data === "true"))
      ? actionSuccess
      : notFound,
  );
}
