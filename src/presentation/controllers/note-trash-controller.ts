import {
  actionSuccess,
  actionUnauthorized,
  attemptGoAction,
  noteIdSchema,
  type ActionState,
} from "@/presentation/controllers/action-state";

type Member = () => Promise<{ githubId?: string } | null>;

const notFound: ActionState = {
  status: "error",
  message: "このノートは見つかりませんでした。画面を更新してください。",
};

// Owner of the signed-in user's notes. The form never names the owner, so an
// admin viewing someone else (or a crafted POST) still acts on their own.
async function ownerOf(getMember: Member) {
  const user = await getMember();
  return user?.githubId ?? null;
}

// Moves one note to the trash, restores it, or deletes it for good.
export async function handleNoteAction(
  formData: FormData,
  dependencies: {
    getMember: Member;
    run: (ownerId: string, id: string) => Promise<boolean>;
  },
): Promise<ActionState> {
  const ownerId = await ownerOf(dependencies.getMember);
  if (!ownerId) return actionUnauthorized;
  const id = noteIdSchema.safeParse(formData.get("id"));
  if (!id.success) return notFound;
  return attemptGoAction("NOTE_TRASH_FAILED", async () =>
    (await dependencies.run(ownerId, id.data)) ? actionSuccess : notFound,
  );
}

export async function handleEmptyTrash(dependencies: {
  getMember: Member;
  run: (ownerId: string) => Promise<number>;
}): Promise<ActionState> {
  const ownerId = await ownerOf(dependencies.getMember);
  if (!ownerId) return actionUnauthorized;
  return attemptGoAction("NOTE_TRASH_FAILED", async () => {
    await dependencies.run(ownerId);
    return actionSuccess;
  });
}
