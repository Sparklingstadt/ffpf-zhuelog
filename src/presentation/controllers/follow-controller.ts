import type { AppRole } from "@/domain/identity/entities/authenticated-user";
import type { FollowResult } from "@/infrastructure/go-api/social-gateway";
import { z } from "zod";

import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  noteIdSchema,
  type ActionState,
} from "@/presentation/controllers/action-state";

type Member = () => Promise<{ githubId?: string; role: AppRole } | null>;

const notFound: ActionState = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};
const selfFollow: ActionState = {
  status: "error",
  message: "自分はフォローできません。",
};

// Members are password accounts and FFPF ID accounts.
const followeeIdSchema = z.string().regex(/^(password|ffpf):[a-z0-9]{1,64}$/);
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
  if (!user?.githubId) return actionUnauthorized;
  const followerId = user.githubId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attemptGoAction("FOLLOW_FAILED", async () => {
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
  if (!user?.githubId) return actionUnauthorized;
  const followerId = user.githubId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attemptGoAction("FOLLOW_FAILED", async () => {
    await dependencies.run(followerId, followeeId.data);
    return actionSuccess;
  });
}

// Only members can be followed, so only members have notes to share.
export async function handleShare(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (ownerId: string, id: string, shared: boolean) => Promise<boolean>;
  },
): Promise<ActionState> {
  const user = await dependencies.getMember();
  if (!user?.githubId || user.role !== "member") return actionUnauthorized;
  const ownerId = user.githubId;
  const id = noteIdSchema.safeParse(formData.get("id"));
  const shared = sharedSchema.safeParse(formData.get("shared"));
  if (!id.success || !shared.success) return notFound;
  return attemptGoAction("SHARE_FAILED", async () =>
    (await dependencies.run(ownerId, id.data, shared.data === "true"))
      ? actionSuccess
      : notFound,
  );
}
