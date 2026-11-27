import { FlaskConical, KeyRound, Languages, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  demoAvailable,
  getCurrentViewerUser,
} from "@/composition/identity-container";
import { sidConfig } from "@/infrastructure/config/environment";
import { signInAsDemoAction } from "@/presentation/actions/auth-actions";
import {
  GuestSignInButton,
  PasswordSignInForm,
  SidSignInButton,
} from "@/presentation/components/auth/sign-in-forms";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Card, CardContent } from "@/presentation/components/ui/card";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";
import { AppHeader } from "@/presentation/components/layout/app-header";

// The errors the demo sign-in sends back. Any other ?error= (such as Better
// Auth's code after a refused Sparklingstadt ID callback) is the generic
// message: Better Auth's own words are never shown.
const errorMessages: Record<string, string> = {
  DemoUnavailable: "デモは今は利用できません。",
};

// The only page a crawler can read: every other page sends it here with a
// callbackUrl, so the canonical folds those variants into one.
export const metadata: Metadata = {
  title: "ログイン",
  alternates: { canonical: "/signin" },
};

type SignInPageProps = {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string | string[];
    notice?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentViewerUser();
  if (user) redirect("/");

  const params = await searchParams;
  const callbackPath = getSafeCallbackPath(params.callbackUrl);
  const showSid = Boolean(sidConfig());
  const showDemo = await demoAvailable();
  const error = [params.error ?? []].flat()[0];
  const errorMessage = error
    ? (errorMessages[error] ??
      "認証中にエラーが発生しました。もう一度お試しください。")
    : null;
  const showPasswordChangedNotice = params.notice === "password-changed";

  return (
    <>
      <AppHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        {/* Wide screens: what the app does and the ways to try it on the
            left, members on the right. Narrow ones stack them in that order. */}
        <div className="grid w-full max-w-md gap-6 lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-12">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Languages className="size-6" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                学习録にログイン
              </h1>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground lg:text-lg lg:leading-8 lg:text-foreground">
                添削してもらった中国語を、ピンインとヒントと一緒に残し、忘れかけたころに復習します。
              </p>
            </div>
            {errorMessage ? (
              <Alert variant="destructive">
                <LockKeyhole />
                <AlertTitle>ログインできませんでした</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            {showPasswordChangedNotice ? (
              <Alert>
                <KeyRound />
                <AlertDescription>
                  パスワードを変更しました。新しいパスワードでログインしてください。
                </AlertDescription>
              </Alert>
            ) : null}

            {/* First-time visitors try it without an account: the demo first,
                as the one primary button, then the guest. */}
            <section
              aria-labelledby="signin-try"
              className="space-y-3 rounded-xl border bg-muted/40 p-4"
            >
              <h2 id="signin-try" className="text-sm font-semibold">
                ログインせずに試す
              </h2>
              {showDemo ? (
                <div className="space-y-2">
                  <form action={signInAsDemoAction.bind(null, callbackPath)}>
                    <Button type="submit" size="lg" className="w-full">
                      <FlaskConical /> デモで試す
                    </Button>
                  </form>
                  <p className="text-xs leading-5 text-muted-foreground">
                    例のデータが入った会員の画面で、学習ノート・復習・単語帳まで試せます。データは試している全員で共有され、毎晩元に戻ります。AIの機能は使えません。
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <GuestSignInButton callbackPath={callbackPath} />
                <p className="text-xs leading-5 text-muted-foreground">
                  ゲストは練習だけを試せます。学習ノート・CSVインポートは利用できません。
                </p>
              </div>
            </section>
          </div>

          <Card className="shadow-lg">
            <CardContent className="space-y-6">
              <section aria-labelledby="signin-member" className="space-y-3">
                <h2 id="signin-member" className="text-sm font-semibold">
                  会員の方
                </h2>
                <PasswordSignInForm
                  callbackPath={callbackPath}
                  primary={!showDemo}
                />
                {showSid ? (
                  <SidSignInButton callbackPath={callbackPath} />
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  IDとパスワードのアカウントは管理者が発行します。
                  {showSid
                    ? "Sparklingstadt ID ではメールアドレスと表示名が利用されます。管理者は Sparklingstadt ID でログインします。"
                    : null}
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
