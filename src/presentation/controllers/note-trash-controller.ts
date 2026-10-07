import { z } from "zod";

export type NoteActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

type Member = () => Promise<{ githubId?: string } | null>;

const success: NoteActionState = { status: "success", message: "" };
const unauthorized: NoteActionState = {
  status: "error",
  message: "ログインし直してください。",
};
const notFound: NoteActionState = {
  status: "error",
  message: "このノートは見つかりませんでした。画面を更新してください。",
};
const failed: NoteActionState = {
  status: "error",
  message: "処理できませんでした。時間をおいてもう一度お試しください。",
};

// Learning note ids are Prisma cuids (seeded test notes use other lowercase
// alphanumerics); conversations use the browser's UUIDs.
const idSchemas = {
  learning: z.string().regex(/^[a-z0-9]{1,64}$/),
  conversation: z.uuid(),
};

// Owner of the signed-in user's notes. The form never names the owner, so an
// admin viewing someone else (or a crafted POST) still acts on their own.
async function ownerOf(getMember: Member) {
  const user = await getMember();
  return user?.githubId ?? null;
}

async function attempt(run: () => Promise<NoteActionState>) {
  try {
    return await run();
  } catch {
    // Fixed code only: never the note's text or title.
    console.error("NOTE_TRASH_FAILED");
    return failed;
  }
}

// Moves one note to the trash, restores it, or deletes it for good.
export async function handleNoteAction(
  formData: FormData,
  dependencies: {
    getMember: Member;
    kind: keyof typeof idSchemas;
    run: (ownerId: string, id: string) => Promise<boolean>;
  },
): Promise<NoteActionState> {
  const ownerId = await ownerOf(dependencies.getMember);
  if (!ownerId) return unauthorized;
  const id = idSchemas[dependencies.kind].safeParse(formData.get("id"));
  if (!id.success) return notFound;
  return attempt(async () =>
    (await dependencies.run(ownerId, id.data)) ? success : notFound,
  );
}

export async function handleEmptyTrash(dependencies: {
  getMember: Member;
  run: (ownerId: string) => Promise<number>;
}): Promise<NoteActionState> {
  const ownerId = await ownerOf(dependencies.getMember);
  if (!ownerId) return unauthorized;
  return attempt(async () => {
    await dependencies.run(ownerId);
    return success;
  });
}
