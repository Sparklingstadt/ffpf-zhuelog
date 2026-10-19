"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { socialUseCases } from "@/composition/social-container";
import { revalidateNotes } from "@/presentation/actions/revalidate-notes";
import type { ActionState } from "@/presentation/controllers/action-state";
import {
  handleFollow,
  handleShare,
  handleUnfollow,
} from "@/presentation/controllers/follow-controller";

export async function followMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await handleFollow(formData, {
    getMember: getCurrentMemberUser,
    run: (followerId, followeeId) =>
      socialUseCases.followMember.execute(followerId, followeeId),
  });
  if (state.status === "success") revalidatePath("/follow");
  return state;
}

export async function unfollowMemberAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await handleUnfollow(formData, {
    getMember: getCurrentMemberUser,
    run: (followerId, followeeId) =>
      socialUseCases.unfollowMember.execute(followerId, followeeId),
  });
  if (state.status === "success") revalidatePath("/follow");
  return state;
}

export async function shareLearningEntryAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const state = await handleShare(formData, {
    getMember: getCurrentMemberUser,
    run: (ownerId, id, shared) =>
      learningUseCases.shareLearningEntry.execute(ownerId, id, shared),
  });
  if (state.status === "success") {
    revalidateNotes();
    revalidatePath("/follow");
  }
  return state;
}
