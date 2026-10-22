"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningNotes } from "@/composition/learning-container";
import { socialNetwork } from "@/composition/social-container";
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
    // Go follows as the token's owner; the follower checked here is not sent.
    run: (_followerId, followeeId) => socialNetwork.follow(followeeId),
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
    run: (_followerId, followeeId) => socialNetwork.unfollow(followeeId),
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
    // Go shares the token owner's note; the owner checked here is not sent.
    run: (_ownerId, id, shared) => learningNotes.setShared(id, shared),
  });
  if (state.status === "success") {
    revalidateNotes();
    revalidatePath("/follow");
  }
  return state;
}
