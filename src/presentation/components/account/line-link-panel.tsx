"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { lineLinkMessageUrl } from "@/domain/line/official-account";
import { LineLinkQr } from "./line-link-qr";

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
  officialAccountId,
  preview = false,
}: {
  linked: boolean;
  addFriendUrl?: string;
  officialAccountId?: string;
  preview?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    issueLineLinkCodeAction,
    initialState,
  );
  const router = useRouter();
  const expiresAt = state.status === "issued" ? state.expiresAt : undefined;
  const messageUrl =
    state.status === "issued" && officialAccountId
      ? lineLinkMessageUrl(officialAccountId, state.code)
      : undefined;

  useEffect(() => {
    if (linked) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    // Linking happens in LINE, outside this page. Poll only while a code is
    // valid, and stop once the refreshed server props report the link.
    const interval = expiresAt ? window.setInterval(refresh, 5000) : undefined;
    const expiryTimer = expiresAt
      ? window.setTimeout(
          () => window.clearInterval(interval),
          Math.max(0, Date.parse(expiresAt) - Date.now()),
        )
      : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
      window.clearTimeout(expiryTimer);
    };
  }, [linked, expiresAt, router]);

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
      {preview ? (
        <Alert>
          <AlertTitle>LINE連携の表示確認用です</AlertTitle>
          <AlertDescription>
            <p>
              ここで発行するコードは本番のLINEボットでは使えません。実際に連携する場合は、本番画面で新しいコードを発行してください。
            </p>
            <a
              href="https://ffpf-zhuelog.vercel.app/account/line"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              本番のLINE連携画面を開く
            </a>
          </AlertDescription>
        </Alert>
      ) : null}
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
            {expiryLabel(state.expiresAt)}まで有効（10分）。
            {preview
              ? "表示確認用のコードです。LINEには送信しないでください。"
              : "このコードをLINE公式アカウントに送ると連携できます。連携状態は自動で確認します。"}
          </span>
        </output>
      ) : null}
      {state.status === "issued" && messageUrl && !preview ? (
        <LineLinkQr
          key={`${state.code}:${state.expiresAt}`}
          url={messageUrl}
          expiresAt={state.expiresAt}
        />
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
