"use client";

import { BellOff, BellRing, LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import {
  setLineReviewNotifyAction,
  type LineReviewNotifyState,
} from "@/presentation/actions/line-link-actions";
import { Button } from "@/presentation/components/ui/button";

const initialState: LineReviewNotifyState = { status: "idle" };

// The switch for the morning LINE message about due reviews.
export function LineReviewNotifyForm({ on }: { on: boolean }) {
  const [state, formAction, pending] = useActionState(
    setLineReviewNotifyAction,
    initialState,
  );
  // The saved state wins until the page reloads with Go's value.
  const current = state.status === "saved" ? state.on : on;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-sm">
        いまは
        <strong>
          {current ? "お知らせしています" : "お知らせしていません"}
        </strong>
        。
      </p>
      <input type="hidden" name="on" value={current ? "0" : "1"} />
      <div>
        <Button
          type="submit"
          variant={current ? "outline" : "default"}
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : current ? (
            <BellOff />
          ) : (
            <BellRing />
          )}
          {current ? "お知らせを止める" : "お知らせを受け取る"}
        </Button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
