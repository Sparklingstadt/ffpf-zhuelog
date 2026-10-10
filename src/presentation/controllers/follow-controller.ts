import type { FollowResult } from "@ffpf-zhuelog/core/application/social/use-cases/follow-member";
import type { AppRole } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";
import { z } from "zod";

import type { NoteActionState } from "@/presentation/controllers/note-trash-controller";

type Member = () => Promise<{ githubId?: string; role: AppRole } | null>;

const success: NoteActionState = { status: "success", message: "" };
const unauthorized: NoteActionState = {
  status: "error",
  message: "ログインし直してください。",
};
const notFound: NoteActionState = {
  status: "error",
  message: "見つかりませんでした。画面を更新してください。",
};
const selfFollow: NoteActionState = {
  status: "error",
  message: "自分はフォローできません。",
};
const failed: NoteActionState = {
  status: "error",
  message: "処理できませんでした。時間をおいてもう一度お試しください。",
};

// Members are password accounts; learning note ids are Prisma cuids (seeded
// test notes use other lowercase alphanumerics).
const followeeIdSchema = z.string().regex(/^password:[a-z0-9]{1,64}$/);
const noteIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);
const sharedSchema = z.enum(["true", "false"]);

async function attempt(
  code: "FOLLOW_FAILED" | "SHARE_FAILED",
  run: () => Promise<NoteActionState>,
) {
  try {
    return await run();
  } catch {
    // Fixed code only: never a member's name or a note's text.
    console.error(code);
    return failed;
  }
}

// The follower is always the signed-in user; the form never names one.
export async function handleFollow(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (followerId: string, followeeId: string) => Promise<FollowResult>;
  },
): Promise<NoteActionState> {
  const user = await dependencies.getMember();
  if (!user?.githubId) return unauthorized;
  const followerId = user.githubId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attempt("FOLLOW_FAILED", async () => {
    const result = await dependencies.run(followerId, followeeId.data);
    if (result === "followed") return success;
    return result === "self" ? selfFollow : notFound;
  });
}

// Not following any more is what the user asked for, so `false` is a success.
export async function handleUnfollow(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (followerId: string, followeeId: string) => Promise<boolean>;
  },
): Promise<NoteActionState> {
  const user = await dependencies.getMember();
  if (!user?.githubId) return unauthorized;
  const followerId = user.githubId;
  const followeeId = followeeIdSchema.safeParse(formData.get("followeeId"));
  if (!followeeId.success) return notFound;
  return attempt("FOLLOW_FAILED", async () => {
    await dependencies.run(followerId, followeeId.data);
    return success;
  });
}

// Only members can be followed, so only members have notes to share.
export async function handleShare(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (ownerId: string, id: string, shared: boolean) => Promise<boolean>;
  },
): Promise<NoteActionState> {
  const user = await dependencies.getMember();
  if (!user?.githubId || user.role !== "member") return unauthorized;
  const ownerId = user.githubId;
  const id = noteIdSchema.safeParse(formData.get("id"));
  const shared = sharedSchema.safeParse(formData.get("shared"));
  if (!id.success || !shared.success) return notFound;
  return attempt("SHARE_FAILED", async () =>
    (await dependencies.run(ownerId, id.data, shared.data === "true"))
      ? success
      : notFound,
  );
}
