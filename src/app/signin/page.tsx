import {
  CircleUserRound,
  Eye,
  Languages,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { redirect } from "next/navigation";

import { getCurrentViewerUser } from "@/composition/identity-container";
import { isAuthConfigured } from "@/infrastructure/config/environment";
import {
  signInAsGuestAction,
  signInWithGitHubAction,
} from "@/presentation/actions/auth-actions";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/presentation/components/ui/alert";
import { Badge } from "@/presentation/components/ui/badge";
import { Button } from "@/presentation/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/presentation/components/ui/card";
import { Separator } from "@/presentation/components/ui/separator";
import { PracticeNotice } from "@/presentation/components/practice/practice-notice";
import { getSafeCallbackPath } from "@/presentation/http/safe-callback-path";

const errorMessages: Record<string, string> = {
  AccessDenied:
    "このGitHubアカウントには利用権限がありません。管理者に確認してください。",
  Configuration: "認証設定が完了していません。管理者に確認してください。",
  OAuthCallbackError:
    "GitHubからの認証結果を確認できませんでした。もう一度お試しください。",
};

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getCurrentViewerUser();
  if (user) redirect("/");

  const params = await searchParams;
  const callbackPath = getSafeCallbackPath(params.callbackUrl);
  const isConfigured = isAuthConfigured();
  const errorMessage = params.error
    ? (errorMessages[params.error] ??
      "認証中にエラーが発生しました。もう一度お試しください。")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Languages className="size-6" />
          </div>
          <div className="space-y-2">
            <Badge variant="secondary" className="gap-1.5">
              <ShieldCheck className="size-3.5" /> 管理者 / ゲスト
            </Badge>
            <CardTitle className="text-2xl">学习録にログイン</CardTitle>
            <CardDescription>
              ゲストも共有ノートの閲覧と、自分のAPIキーでの添削を利用できます。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <LockKeyhole />
              <AlertTitle>ログインできませんでした</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {!isConfigured ? (
            <Alert>
              <LockKeyhole />
              <AlertTitle>OAuth設定が必要です</AlertTitle>
              <AlertDescription>
                管理者ログインには、READMEに従ってGitHub OAuth
                Appと許可ユーザーを設定してください。ゲスト閲覧は利用できます。
              </AlertDescription>
            </Alert>
          ) : null}

          <form action={signInWithGitHubAction.bind(null, callbackPath)}>
            <Button type="submit" className="w-full" disabled={!isConfigured}>
              <CircleUserRound /> GitHubでログイン
            </Button>
          </form>
          <div className="flex items-center gap-3" aria-hidden="true">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">または</span>
            <Separator className="flex-1" />
          </div>
          <form action={signInAsGuestAction.bind(null, callbackPath)}>
            <Button type="submit" className="w-full" variant="outline">
              <Eye /> ゲストとして閲覧
            </Button>
          </form>
          <form action={signInAsGuestAction.bind(null, "/practice")}>
            <Button type="submit" className="w-full" variant="outline">
              自分のAPIキーで添削
            </Button>
          </form>
          <div className="rounded-lg border bg-muted/30 p-4">
            <PracticeNotice />
          </div>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            ゲストは共有ノートへの投稿・CSVインポート・管理者用ChatGPT・LINE添削を利用できません。
            GitHub認証ではユーザー名・表示名・メールアドレス・プロフィール画像が利用されます。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
