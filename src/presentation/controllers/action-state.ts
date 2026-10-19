import { z } from "zod";

// What a one-button Server Action reports back to its form.
export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const actionSuccess: ActionState = { status: "success", message: "" };
export const actionUnauthorized: ActionState = {
  status: "error",
  message: "ログインし直してください。",
};
const actionFailed: ActionState = {
  status: "error",
  message: "処理できませんでした。時間をおいてもう一度お試しください。",
};

// Learning note ids are Prisma cuids (seeded test notes use other lowercase
// alphanumerics).
export const noteIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

// Runs the action, turning any thrown error into the generic failure. Logs
// a fixed code only: never a member's name or a note's text.
export async function attemptAction(
  code: string,
  run: () => Promise<ActionState>,
): Promise<ActionState> {
  try {
    return await run();
  } catch {
    console.error(code);
    return actionFailed;
  }
}
