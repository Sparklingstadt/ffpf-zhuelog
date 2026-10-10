"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMemberUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { socialUseCases } from "@/composition/social-container";
import {
  handleFollow,
  handleShare,
  handleUnfollow,
} from "@/presentation/controllers/follow-controller";
import type { NoteActionState } from "@/presentation/controllers/note-trash-controller";

export async function followMemberAction(
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const state = await handleFollow(formData, {
    getMember: getCurrentMemberUser,
    run: (followerId, followeeId) =>
      socialUseCases.followMember.execute(followerId, followeeId),
  });
  if (state.status === "success") revalidatePath("/follow");
  return state;
}

export async function unfollowMemberAction(
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const state = await handleUnfollow(formData, {
    getMember: getCurrentMemberUser,
    run: (followerId, followeeId) =>
      socialUseCases.unfollowMember.execute(followerId, followeeId),
  });
  if (state.status === "success") revalidatePath("/follow");
  return state;
}

export async function shareLearningEntryAction(
  _previous: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const state = await handleShare(formData, {
    getMember: getCurrentMemberUser,
    run: (ownerId, id, shared) =>
      learningUseCases.shareLearningEntry.execute(ownerId, id, shared),
  });
  if (state.status === "success") {
    revalidatePath("/");
    revalidatePath("/logs", "layout");
    revalidatePath("/follow");
  }
  return state;
}
