"use client";

import { useState, type FormEvent } from "react";
import { Eye, KeyRound, LockKeyhole, UserRoundCheck } from "lucide-react";

import { authClient } from "@/presentation/lib/auth-client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

// Sign-in from the browser through Better Auth's client, so every attempt is
// an HTTP request to /api/auth/* that Better Auth's rate limit counts. Better
// Auth's own (English) error messages are never shown: a refused password is
// one message whatever the reason (wrong id or password, too many attempts),
// and anything else is the generic one.

const CREDENTIALS_MESSAGE =
  "IDまたはパスワードが違うか、一時的にロックされています。";
const GENERIC_MESSAGE =
  "認証中にエラーが発生しました。もう一度お試しください。";

type Failure = { status?: number } | null | undefined;

// 4xx answers (401 wrong credentials, 429 too many attempts, 400 a login id
// of the wrong shape) are the credentials message; a server or network error
// is the generic one.
function passwordFailureMessage(error: Failure): string {
  const status = error?.status ?? 0;
  return status >= 400 && status < 500 ? CREDENTIALS_MESSAGE : GENERIC_MESSAGE;
}

function FailureAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <LockKeyhole />
      <AlertTitle>ログインできませんでした</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// A full page load to the page to come back to, so every server component
// reads the new session cookie.
function goTo(callbackPath: string) {
  window.location.assign(callbackPath);
}

export function PasswordSignInForm({
  callbackPath,
  primary,
}: {
  callbackPath: string;
  primary: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const loginId = form.get("loginId");
    const password = form.get("password");
    setPending(true);
    try {
      const { error } = await authClient.signIn.username({
        username: typeof loginId === "string" ? loginId : "",
        password: typeof password === "string" ? password : "",
      });
      if (!error) {
        goTo(callbackPath);
        return;
      }
      setMessage(passwordFailureMessage(error));
    } catch {
      setMessage(GENERIC_MESSAGE);
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FailureAlert message={message} />
      <div className="space-y-2">
        <Label htmlFor="loginId">ログインID</Label>
        <Input
          id="loginId"
          name="loginId"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">パスワード</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        variant={primary ? "default" : "secondary"}
        disabled={pending}
      >
        <KeyRound /> IDとパスワードでログイン
      </Button>
    </form>
  );
}

// Better Auth sends the browser to the Sparklingstadt ID server and, after its
// callback (/api/auth/callback/sid), to callbackPath. A refused callback comes
// back to the sign-in page with an error, which shows the generic message.
export function SidSignInButton({ callbackPath }: { callbackPath: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    try {
      const { error } = await authClient.signIn.social({
        provider: "sid",
        callbackURL: callbackPath,
        errorCallbackURL: `/signin?callbackUrl=${encodeURIComponent(callbackPath)}`,
      });
      // Without an error the client is already on its way to the ID server.
      if (!error) return;
    } catch {
      // The generic message below.
    }
    setMessage(GENERIC_MESSAGE);
    setPending(false);
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full"
        variant="outline"
        disabled={pending}
        onClick={onClick}
      >
        <UserRoundCheck /> Sparklingstadt ID でログイン
      </Button>
      <FailureAlert message={message} />
    </div>
  );
}

// A guest is an anonymous Better Auth user: practice only, no notes.
export function GuestSignInButton({ callbackPath }: { callbackPath: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    try {
      const { error } = await authClient.signIn.anonymous();
      if (!error) {
        goTo(callbackPath);
        return;
      }
    } catch {
      // The generic message below.
    }
    setMessage(GENERIC_MESSAGE);
    setPending(false);
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full"
        variant="outline"
        disabled={pending}
        onClick={onClick}
      >
        <Eye /> ゲストとして使う
      </Button>
      <FailureAlert message={message} />
    </div>
  );
}
