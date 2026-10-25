"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, MessageCircle, Unlink } from "lucide-react";

import {
  issueLineLinkCodeAction,
  unlinkLineAction,
  type LineLinkState,
} from "@/presentation/actions/line-link-actions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";

const initialState: LineLinkState = { status: "idle" };

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

// 「9時5分」: the hour and minute of the expiry in Japan time.
function expiryLabel(expiresAt: string) {
  const parts = timeFormat.formatToParts(new Date(expiresAt));
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}時${part("minute")}分`;
}

function UnlinkButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <LoaderCircle className="animate-spin" /> : <Unlink />}
      連携を解除
    </Button>
  );
}

export function LineLinkPanel({
  linked,
  addFriendUrl,
}: {
  linked: boolean;
  addFriendUrl?: string;
}) {
  const [state, formAction, pending] = useActionState(
    issueLineLinkCodeAction,
    initialState,
  );

  if (linked) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle className="size-4 text-muted-foreground" />
          LINE と連携しています
        </p>
        <form action={unlinkLineAction}>
          <UnlinkButton />
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={formAction}>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <MessageCircle />
          )}
          {pending ? "発行中…" : "連携コードを出す"}
        </Button>
      </form>
      {state.status === "issued" ? (
        <output className="block space-y-2 rounded-lg border bg-muted/50 p-4 text-sm leading-6">
          <span className="block font-mono text-2xl font-semibold tracking-widest">
            {state.code}
          </span>
          <span className="block text-muted-foreground">
            {expiryLabel(state.expiresAt)}まで有効（10分）。このコードを LINE
            公式アカウントに送ると連携できます。連携できたら、この画面を開き直してください。
          </span>
        </output>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>コードを出せませんでした</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {addFriendUrl ? (
        <p className="text-sm leading-6">
          <a
            href={addFriendUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            LINE 公式アカウントを友だち追加
          </a>
        </p>
      ) : null}
    </div>
  );
}
