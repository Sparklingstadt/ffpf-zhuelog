import {
  CircleUserRound,
  Eye,
  FlaskConical,
  KeyRound,
  Languages,
  LockKeyhole,
  UserRoundCheck,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  demoAvailable,
  getCurrentViewerUser,
} from "@/composition/identity-container";
import {
  ffpfIdConfig,
  isAuthConfigured,
} from "@/infrastructure/config/environment";
import {
  signInAsDemoAction,
  signInAsGuestAction,
  signInWithFfpfAction,
  signInWithGitHubAction,
  signInWithPasswordAction,
} from "@/presentation/actions/auth-actions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";
import { AppHeader } from "@/presentation/components/layout/app-header";

const errorMessages: Record<string, string> = {
  CredentialsSignin: "IDまたはパスワードが違うか、一時的にロックされています。",
  AccessDenied:
    "このGitHubアカウントには利用権限がありません。管理者に確認してください。",
  Configuration: "認証設定が完了していません。管理者に確認してください。",
  OAuthCallbackError:
    "認証サービスからの結果を確認できませんでした。もう一度お試しください。",
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
    error?: string;
    notice?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentViewerUser();
  if (user) redirect("/");

  const params = await searchParams;
  const callbackPath = getSafeCallbackPath(params.callbackUrl);
  const isConfigured = isAuthConfigured();
  const showFfpfId = Boolean(ffpfIdConfig());
  const showDemo = await demoAvailable();
  const errorMessage = params.error
    ? (errorMessages[params.error] ??
      "認証中にエラーが発生しました。もう一度お試しください。")
    : null;
  const showPasswordChangedNotice = params.notice === "password-changed";

  return (
    <>
      <AppHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Languages className="size-6" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl">
                <h1>学习録にログイン</h1>
              </CardTitle>
              <CardDescription className="leading-6">
                添削してもらった中国語を、ピンインとヒントと一緒に残し、忘れかけたころに復習します。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
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
                <form action={signInAsGuestAction.bind(null, callbackPath)}>
                  <Button type="submit" className="w-full" variant="outline">
                    <Eye /> ゲストとして使う
                  </Button>
                </form>
                <p className="text-xs leading-5 text-muted-foreground">
                  ゲストは練習だけを試せます。学習ノート・CSVインポートは利用できません。
                </p>
              </div>
            </section>

            <section aria-labelledby="signin-member" className="space-y-3">
              <h2 id="signin-member" className="text-sm font-semibold">
                会員の方
              </h2>
              {!isConfigured ? (
                <Alert>
                  <LockKeyhole />
                  <AlertTitle>OAuth設定が必要です</AlertTitle>
                  <AlertDescription>
                    GitHubでのログインは現在利用できません。READMEに従ってGitHub
                    OAuth Appと許可ユーザーを設定してください。
                  </AlertDescription>
                </Alert>
              ) : null}
              <form
                action={signInWithPasswordAction.bind(null, callbackPath)}
                className="space-y-3"
              >
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
                  variant={showDemo ? "secondary" : "default"}
                >
                  <KeyRound /> IDとパスワードでログイン
                </Button>
              </form>
              <div
                className={
                  showFfpfId ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"
                }
              >
                {showFfpfId ? (
                  <form action={signInWithFfpfAction.bind(null, callbackPath)}>
                    <Button type="submit" className="w-full" variant="outline">
                      <UserRoundCheck /> FFPF IDでログイン
                    </Button>
                  </form>
                ) : null}
                <form action={signInWithGitHubAction.bind(null, callbackPath)}>
                  <Button
                    type="submit"
                    className="w-full"
                    variant="outline"
                    disabled={!isConfigured}
                  >
                    <CircleUserRound /> GitHubでログイン
                  </Button>
                </form>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                IDとパスワードのアカウントは管理者が発行します。
                {showFfpfId
                  ? "FFPF IDではメールアドレスと表示名が利用されます。"
                  : null}
                GitHub認証ではユーザー名・表示名・メールアドレス・プロフィール画像が利用されます。
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
