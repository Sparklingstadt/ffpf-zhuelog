"use client";

import { useActionState, useEffect, useRef } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";

import {
  createPasswordAccountAction,
  type AccountActionState,
} from "@/presentation/actions/password-account-actions";
import { AccountResult } from "@/presentation/components/auth/account-result";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

const initialState: AccountActionState = { status: "idle" };

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(
    createPasswordAccountAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="create-login-id">ログインID</Label>
        <Input
          id="create-login-id"
          name="loginId"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={pending}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          英小文字・数字・. _ - の3〜32文字。
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="create-display-name">表示名</Label>
        <Input
          id="create-display-name"
          name="displayName"
          autoComplete="off"
          maxLength={50}
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="create-password">パスワード</Label>
        <Input
          id="create-password"
          name="password"
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          空欄にすると自動生成します。
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
        {pending ? "作成中…" : "アカウントを作成"}
      </Button>
      <AccountResult state={state} errorTitle="作成できませんでした" />
    </form>
  );
}
