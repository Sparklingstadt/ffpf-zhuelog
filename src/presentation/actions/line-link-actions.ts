"use server";

import { revalidatePath } from "next/cache";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { lineLink } from "@/composition/line-container";
import { attemptGo } from "@/presentation/controllers/action-state";
import { accountForbiddenMessage } from "@/presentation/presenters/account-action-errors";

export type LineLinkState =
  | { status: "idle" }
  | { status: "issued"; code: string; expiresAt: string }
  | { status: "error"; message: string };

// Members and admins only: guests can read the app but have no LINE link.
async function getLinkOwner() {
  const user = await getCurrentViewerUser();
  return user && user.role !== "guest" ? user : null;
}

// Takes no arguments: the state and the form data are both unused, and a
// function with fewer parameters still works as a useActionState action.
export async function issueLineLinkCodeAction(): Promise<LineLinkState> {
  if (!(await getLinkOwner()))
    return { status: "error", message: accountForbiddenMessage };
  const issued = await attemptGo("LINE_LINK_CODE_FAILED", () =>
    lineLink.issueLineLinkCode(),
  );
  if (!issued.ok) return { status: "error", message: issued.message };
  return {
    status: "issued",
    code: issued.value.code,
    expiresAt: issued.value.expiresAt.toISOString(),
  };
}

export async function unlinkLineAction(): Promise<void> {
  if (!(await getLinkOwner())) return;
  await lineLink.unlinkLine();
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
  if (!(await getLinkOwner()))
    return { status: "error", message: accountForbiddenMessage };
  const on = formData.get("on") === "1";
  const saved = await attemptGo("LINE_REVIEW_NOTIFY_FAILED", () =>
    lineLink.setLineReviewNotify(on),
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
