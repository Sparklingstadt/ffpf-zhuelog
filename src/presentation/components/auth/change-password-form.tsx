"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";

import {
  changePasswordFailure,
  checkNewPassword,
  type ChangePasswordFailure,
} from "@/application/identity/own-password";
import { signOutAfterPasswordChangeAction } from "@/presentation/actions/password-account-actions";
import { authClient } from "@/presentation/lib/auth-client";
import { changePasswordMessage } from "@/presentation/presenters/account-action-errors";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// The change goes from the browser to Better Auth's /change-password, so its
// rate limit counts every attempt. It ends every other session of the
// member; this one is then signed out too, and the member signs in again with
// the new password.
export function ChangePasswordForm() {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ChangePasswordFailure | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = text(form, "currentPassword");
    const newPassword = text(form, "newPassword");
    const refused = checkNewPassword({
      newPassword,
      confirmPassword: text(form, "confirmPassword"),
    });
    if (refused) {
      setFailure(refused);
      return;
    }
    setPending(true);
    let outcome: ChangePasswordFailure | null;
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      outcome = error ? changePasswordFailure(error) : null;
    } catch {
      outcome = "error";
    }
    if (outcome) {
      setFailure(outcome);
      setPending(false);
      return;
    }
    // Goes to /signin?notice=password-changed.
    await signOutAfterPasswordChangeAction();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="current-password">現在のパスワード</Label>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">新しいパスワード</Label>
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
        />
        <p className="text-xs leading-5 text-muted-foreground">12〜128文字。</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">新しいパスワード（確認）</Label>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
        {pending ? "変更中…" : "パスワードを変更"}
      </Button>
      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>変更できませんでした</AlertTitle>
          <AlertDescription>{changePasswordMessage(failure)}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
