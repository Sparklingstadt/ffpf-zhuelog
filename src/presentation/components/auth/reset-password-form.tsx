"use client";

import { useActionState, useEffect, useRef } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";

import {
  resetPasswordAccountPasswordAction,
  type AccountActionState,
} from "@/presentation/actions/password-account-actions";
import { AccountResult } from "@/presentation/components/auth/account-result";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

const initialState: AccountActionState = { status: "idle" };

export function ResetPasswordForm({
  accountId,
  loginId,
}: {
  accountId: string;
  loginId: string;
}) {
  const [state, formAction, pending] = useActionState(
    resetPasswordAccountPasswordAction.bind(null, accountId),
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = `reset-password-${accountId}`;

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={inputId} className="text-xs">
            {loginId} の新しいパスワード
          </Label>
          <Input
            id={inputId}
            name="password"
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          {pending ? "再設定中…" : "パスワードを再設定"}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        空欄にすると自動生成します。
      </p>
      <AccountResult state={state} errorTitle="再設定できませんでした" />
    </form>
  );
}
