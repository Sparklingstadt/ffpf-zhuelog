"use server";

import { revalidatePath } from "next/cache";

import { LineLinkForbiddenError } from "@/application/line/line-link";
import { lineLink } from "@/composition/line-container";
import { attemptGo } from "@/presentation/controllers/action-state";

export type LineLinkState =
  | { status: "idle" }
  | { status: "issued"; code: string; expiresAt: string }
  | { status: "error"; message: string };

// The signed-in member's or admin's own LINE link, read and written in the
// database by the lineLink use case, which refuses guests, the demo account
// and an admin acting as a member (LineLinkForbiddenError, shown as
// accountForbiddenMessage by attemptGo).

// Takes no arguments: the state and the form data are both unused, and a
// function with fewer parameters still works as a useActionState action.
export async function issueLineLinkCodeAction(): Promise<LineLinkState> {
  const issued = await attemptGo("LINE_LINK_CODE_FAILED", () =>
    lineLink.issueCode(),
  );
  if (!issued.ok) return { status: "error", message: issued.message };
  return {
    status: "issued",
    code: issued.value.code,
    expiresAt: issued.value.expiresAt.toISOString(),
  };
}

// A refused user changes nothing and sees the page as it was.
export async function unlinkLineAction(): Promise<void> {
  try {
    await lineLink.unlink();
  } catch (error) {
    if (error instanceof LineLinkForbiddenError) return;
    throw error;
  }
  revalidatePath("/account/line");
}

export type LineReviewNotifyState =
  | { status: "idle" }
  | { status: "saved"; on: boolean }
  | { status: "error"; message: string };

// Turns the morning LINE message about due reviews on or off. The form sends
// on=1 to turn it on and anything else to turn it off.
export async function setLineReviewNotifyAction(
  _previous: LineReviewNotifyState,
  formData: FormData,
): Promise<LineReviewNotifyState> {
  const on = formData.get("on") === "1";
  const saved = await attemptGo("LINE_REVIEW_NOTIFY_FAILED", () =>
    lineLink.setReviewNotify(on),
  );
  if (!saved.ok) return { status: "error", message: saved.message };
  if (!saved.value)
    return {
      status: "error",
      message:
        "お知らせを切り替えられませんでした。LINE と連携しているか、ページを読み込み直して確かめてください。",
    };
  revalidatePath("/account/line");
  return { status: "saved", on };
}
